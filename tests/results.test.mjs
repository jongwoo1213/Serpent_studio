import assert from "node:assert/strict";
import test from "node:test";
import { buildResultCase, buildWorthTable } from "../lib/results.ts";

/**
 * 실제 Serpent 2 결과 파일의 핵심 항목만 담은 최소 픽스처. 진짜 결과 파일이 200개
 * 넘는 변수를 갖는 것과 달리, 여기서는 건전성 판정과 Δρ 계산에 쓰이는 항목만 둔다.
 */
function fixture({ keff = "1.05000E+00", betaEff = "7.30000E-03", completed = 1, lost = 0 } = {}) {
  return [
    `VERSION                   (idx, [1: 14])  = 'Serpent 2.1.29' ;`,
    `INPUT_FILE_NAME           (idx, [1:  4])  = 'case' ;`,
    `SIMULATION_COMPLETED      (idx, 1)        = ${completed} ;`,
    `LOST_PARTICLES            (idx, 1)        = ${lost} ;`,
    `POP                       (idx, 1)        = 1000 ;`,
    `CYCLES                    (idx, 1)        = 100 ;`,
    `SKIP                      (idx, 1)        = 20 ;`,
    `BALA_NEUTRON_DIFF         (idx, [1:  2])  = [ 0 0.0 ];`,
    `IMP_KEFF                  (idx, [1:  2])  = [  ${keff} 5.0E-05 ];`,
    `ABS_KEFF                  (idx, [1:  2])  = [  ${keff} 5.0E-05 ];`,
    `COL_KEFF                  (idx, [1:  2])  = [  ${keff} 5.0E-05 ];`,
    `ANA_KEFF                  (idx, [1:  6])  = [  ${keff} 5.0E-05  1.0000E+00 5.0E-05  0.0000E+00 0.0 ];`,
    `BETA_EFF                  (idx, [1:  2])  = [  ${betaEff} 0.001 ];`,
    `ADJ_PERT_GEN_TIME         (idx, [1:  2])  = [  3.0000E-05 0.001 ];`,
    ``,
  ].join("\n");
}

test("a complete result file reports worstStatus ok with a keff value", () => {
  const c = buildResultCase("case_res.m", fixture(), "id-1");
  assert.equal(c.error, undefined);
  assert.ok(c.keff);
  assert.equal(c.keff.value, 1.05);
  assert.equal(c.worstStatus, "ok");
  assert.ok(c.checks.every((check) => check.status === "ok"));
});

test("a result file missing keff/completion/particle fields is not reported as ok", () => {
  const bare = "VERSION (idx, [1: 14]) = 'Serpent 2.1.29' ;\n";
  const c = buildResultCase("bare_res.m", bare, "id-2");
  assert.equal(c.keff, undefined);
  assert.equal(c.worstStatus, "bad");
  assert.ok(c.checks.some((check) => check.label === "k_eff" && check.status === "bad"));
});

test("a result file that ran to completion but lost particles is flagged bad, not ok", () => {
  const c = buildResultCase("lossy_res.m", fixture({ lost: 12 }), "id-3");
  assert.equal(c.worstStatus, "bad");
  assert.ok(c.checks.some((check) => check.label === "입자 손실" && check.status === "bad"));
});

test("buildWorthTable converts every row's Δρ to dollars using the reference case's β_eff, not its own", () => {
  const reference = buildResultCase("ref_res.m", fixture({ keff: "1.05000E+00", betaEff: "7.30000E-03" }), "ref");
  const other = buildResultCase("other_res.m", fixture({ keff: "1.02000E+00", betaEff: "8.00000E-03" }), "other");

  const table = buildWorthTable([reference, other], "ref");
  const otherRow = table.find((row) => row.case.id === "other");

  assert.ok(otherRow.dollars !== undefined);
  const usingReferenceBeta = otherRow.deltaRho / 1e5 / reference.betaEff;
  const usingOwnBeta = otherRow.deltaRho / 1e5 / other.betaEff;

  assert.ok(Math.abs(otherRow.dollars - usingReferenceBeta) < 1e-9);
  // 두 값이 실제로 다르다는 것까지 확인해, β_eff 를 안 쓰거나 우연히 같은 값을 써서
  // 통과하는 거짓 양성을 막는다.
  assert.notEqual(usingReferenceBeta, usingOwnBeta);
});

test("buildSpectrum handles a descending MICRO_E grid and drops Serpent's 1E+37 infinity bound", () => {
  // 회귀 방지: 기본 168군(누설 보정) 구조는 MICRO_E 가 1E+37 부터 0 까지 내림차순으로
  // 찍힌다. 예전에는 오름차순만 가정해 high > low 검사에서 전부 걸러져 스펙트럼이
  // 통째로 비었다. 아래는 그 구조를 축소한 4군 픽스처.
  const src = [
    `MICRO_NG (idx, 1)        = 4 ;`,
    `MICRO_E  (idx, [1:  5])  = [  1.00000E+37  1.00000E+01  1.00000E+00  1.00000E-01  0.00000E+00 ];`,
    `INF_MICRO_FLX (idx, [1: 8]) = [  1.0E+03 0.02  2.0E+05 0.01  3.0E+05 0.01  4.0E+04 0.03 ];`,
    ``,
  ].join("\n");
  const c = buildResultCase("desc_res.m", src, "id-desc");

  // 4군 중 1E+37 상한(첫 군)과 0 하한(마지막 군)은 로그축에 못 그리므로 2군만 남는다.
  assert.equal(c.spectrum.length, 2);
  assert.ok(c.spectrum.every((bin) => bin.low < bin.high));
  assert.ok(c.spectrum.every((bin) => bin.high < 1e10));
  // 두 번째 군 [1, 10] MeV: 2.0E+05 / ln(10) 이어야 한다.
  assert.ok(Math.abs(c.spectrum[0].perLethargy - 2.0e5 / Math.log(10)) < 1e-6);
});

test("buildSpectrum still reads an ascending MICRO_E grid unchanged", () => {
  const src = [
    `MICRO_NG (idx, 1)       = 2 ;`,
    `MICRO_E  (idx, [1:  3]) = [  1.00000E-01  1.00000E+00  1.00000E+01 ];`,
    `INF_MICRO_FLX (idx, [1: 4]) = [  5.0E+04 0.01  6.0E+04 0.01 ];`,
    ``,
  ].join("\n");
  const c = buildResultCase("asc_res.m", src, "id-asc");

  assert.equal(c.spectrum.length, 2);
  assert.equal(c.spectrum[0].low, 0.1);
  assert.equal(c.spectrum[0].high, 1);
  assert.ok(Math.abs(c.spectrum[0].perLethargy - 5.0e4 / Math.log(10)) < 1e-6);
});
