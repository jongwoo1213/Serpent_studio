import assert from "node:assert/strict";
import test from "node:test";
import {
  detectorBaseName,
  detectorToSpectrumBins,
  isDetectorFileName,
  looksLikeDetectorFile,
  parseDetectorFile,
} from "../lib/detectors.ts";

/**
 * VTT 공식 문서("2.3.4. Detector output")에 적힌 열 배치를 그대로 따른 합성
 * 픽스처. 시간 구간 없는 검출기는 12열: idx EBI UBI CBI MBI LBI RBI XBI YBI ZBI MEAN ERR.
 * 실제 Serpent 가 만든 det 파일로는 검증하지 못했다 — 라이선스가 있어야 실행되는
 * 코드라 이 저장소에 진짜 예시가 없다.
 */
const FIXTURE = `
% 순수 스펙트럼 검출기 (에너지만 바뀌고 나머지 구간은 전부 0)
DETspectrum = [
   1  1  0  0  0  0  0  0  0  0   9.78571E+06  8.9E-04
   2  2  0  0  0  0  0  0  0  0   5.03661E+07  1.8E-04
   3  3  0  0  0  0  0  0  0  0   1.51677E+08  1.3E-04
];

DETspectrumE = [
  1.00000E-11  5.00000E-09  2.50000E-09
  5.00000E-09  1.00000E-08  7.50000E-09
  1.00000E-08  1.50000E-08  1.25000E-08
];

% 공간 격자까지 함께 있는 검출기 — 행 개수(3)가 에너지 군 개수(1)와 안 맞으므로
% 단순 스펙트럼으로 취급하지 않고 건너뛰어야 한다.
DETxymesh = [
   1  1  1  0  0  0  1  1  0  0   1.0E+05  1.0E-03
   2  1  1  0  0  0  2  1  0  0   1.1E+05  1.0E-03
   3  1  1  0  0  0  1  2  0  0   1.2E+05  1.0E-03
];

DETxymeshE = [
  1.00000E-11  2.00000E+01  1.00000E+01
];
`;

test("parseDetectorFile keeps a pure energy-binned detector and skips a mixed-bin one", () => {
  const detectors = parseDetectorFile(FIXTURE);
  assert.deepEqual(detectors.map((d) => d.name), ["spectrum"]);
  assert.equal(detectors[0].bins.length, 3);
});

test("parseDetectorFile reads energy bounds and mean/error columns correctly", () => {
  const [spectrum] = parseDetectorFile(FIXTURE);
  assert.deepEqual(spectrum.bins[0], { low: 1e-11, high: 5e-9, mid: 2.5e-9, mean: 9785710, rel: 0.00089 });
  assert.deepEqual(spectrum.bins[2], { low: 1e-8, high: 1.5e-8, mid: 1.25e-8, mean: 151677000, rel: 0.00013 });
});

test("detectorToSpectrumBins matches the res.m per-lethargy formula (value / ln(high/low))", () => {
  const [spectrum] = parseDetectorFile(FIXTURE);
  const bins = detectorToSpectrumBins(spectrum);
  const expected = 9785710 / Math.log(5e-9 / 1e-11);
  assert.ok(Math.abs(bins[0].perLethargy - expected) < 1e-6);
});

test("looksLikeDetectorFile distinguishes det output from res.m content", () => {
  assert.equal(looksLikeDetectorFile(FIXTURE), true);
  assert.equal(looksLikeDetectorFile("IMP_KEFF (idx, [1: 2]) = [ 1.0 0.0 ];"), false);
});

test("detectorBaseName / isDetectorFileName follow the [input]_det[idx](b[n]).m convention", () => {
  assert.equal(isDetectorFileName("case_det0.m"), true);
  assert.equal(isDetectorFileName("case_det12b3.m"), true);
  assert.equal(isDetectorFileName("case_res.m"), false);
  assert.equal(detectorBaseName("case_det0.m"), "case");
  assert.equal(detectorBaseName("case_det12b3.m"), "case");
});
