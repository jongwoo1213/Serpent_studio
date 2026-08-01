import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_SUMMARY_META,
  checksum,
  detectCalculationTypes,
  detectLibraries,
  geometryImageFileName,
  renderSpectrumSvg,
  renderSummaryMarkdown,
  spectrumImageFileName,
  summarizeGeometry,
  summaryFileName,
} from "../lib/summary.ts";
import { parseSerpentInput, SAMPLE_INPUT } from "../lib/serpent.ts";
import { buildResultCase } from "../lib/results.ts";

function resultFixture({ keff = "1.05000E+00", betaEff = "7.30000E-03" } = {}) {
  return [
    `VERSION                   (idx, [1: 14])  = 'Serpent 2.1.32' ;`,
    `INPUT_FILE_NAME           (idx, [1:  4])  = 'case' ;`,
    `SIMULATION_COMPLETED      (idx, 1)        = 1 ;`,
    `LOST_PARTICLES            (idx, 1)        = 0 ;`,
    `POP                       (idx, 1)        = 100000 ;`,
    `CYCLES                    (idx, 1)        = 500 ;`,
    `SKIP                      (idx, 1)        = 100 ;`,
    `ANA_KEFF                  (idx, [1:  6])  = [  ${keff} 5.0E-05  1.0E+00 5.0E-05  0.0E+00 0.0 ];`,
    `BETA_EFF                  (idx, [1:  2])  = [  ${betaEff} 0.001 ];`,
    `ADJ_PERT_GEN_TIME         (idx, [1:  2])  = [  3.0000E-05 0.001 ];`,
    ``,
  ].join("\n");
}

function spectrumFixture() {
  return [
    resultFixture(),
    `MICRO_NG (idx, 1)       = 2 ;`,
    `MICRO_E  (idx, [1:  3]) = [  1.00000E-01  1.00000E+00  1.00000E+01 ];`,
    `INF_MICRO_FLX (idx, [1: 4]) = [  5.0E+04 0.01  6.0E+04 0.01 ];`,
    ``,
  ].join("\n");
}

const cards = parseSerpentInput(SAMPLE_INPUT);

const geometryImageFixture = {
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  width: 512,
  height: 512,
  basis: "XY",
};

function baseSources(overrides = {}) {
  return {
    meta: EMPTY_SUMMARY_META,
    inputName: "pwr_pin.inp",
    inputText: SAMPLE_INPUT,
    cards,
    cases: [],
    referenceId: "",
    resultFiles: [],
    now: new Date(2026, 6, 30, 14, 5),
    ...overrides,
  };
}

/** 대부분의 테스트는 마크다운 텍스트만 보면 되므로 반환값에서 바로 꺼내 준다. */
function render(overrides = {}) {
  return renderSummaryMarkdown(baseSources(overrides)).markdown;
}

test("checksum is stable for the same text and differs when the text changes", () => {
  assert.equal(checksum("abc"), checksum("abc"));
  assert.notEqual(checksum("abc"), checksum("abd"));
  // 알고리즘 이름을 붙여 md5sum 결과와 헷갈리지 않게 한다.
  assert.match(checksum("abc"), /^fnv1a-32:[0-9a-f]{8}$/);
});

test("the input file is embedded verbatim, not summarized", () => {
  const md = render();
  assert.ok(md.includes(SAMPLE_INPUT.trimEnd()));
  assert.ok(md.includes("## 4. 입력문 전문"));
});

test("a code fence inside the input does not break out of the embedded block", () => {
  const tricky = "set title \"x\"\n```\nsurf a cyl 0 0 1\n";
  const md = render({ inputText: tricky, cards: parseSerpentInput(tricky) });
  // 본문에 ``` 가 있으므로 더 긴 펜스로 감싸야 한다.
  assert.ok(md.includes("````"));
  assert.ok(md.includes("surf a cyl 0 0 1"));
});

test("file metadata carries folder, modified time and checksum", () => {
  const md = render({
    inputFile: {
      name: "pwr_pin.inp",
      dir: "calc/v2c22",
      text: SAMPLE_INPUT,
      lastModified: Date.UTC(2026, 0, 2, 3, 4),
    },
  });
  assert.ok(md.includes("calc/v2c22"));
  assert.ok(md.includes("2026-01-02"));
  assert.ok(md.includes(checksum(SAMPLE_INPUT)));
});

test("a missing file location is called out rather than silently left blank", () => {
  const md = render();
  assert.ok(md.includes("파일 위치가 비어 있습니다"));
});

test("a supplied file location replaces the warning", () => {
  const md = render({ meta: { ...EMPTY_SUMMARY_META, location: "/home/user/calc" } });
  assert.ok(md.includes("/home/user/calc"));
  assert.ok(!md.includes("파일 위치가 비어 있습니다"));
});

test("k_eff is always reported with its statistical error", () => {
  const item = buildResultCase("case_res.m", resultFixture(), "one");
  const md = render({
    cases: [item],
    referenceId: "one",
    resultFiles: [{ name: "case_res.m", dir: "", text: resultFixture() }],
  });
  assert.ok(/k_eff.*1\.050000 ± /.test(md));
  assert.ok(md.includes("Serpent 2.1.32"));
});

test("several result files each get a section plus a shared Δρ comparison", () => {
  const a = buildResultCase("a_res.m", resultFixture({ keff: "1.05000E+00" }), "a");
  const b = buildResultCase("b_res.m", resultFixture({ keff: "1.02000E+00", betaEff: "8.0E-03" }), "b");
  const md = render({
    cases: [a, b],
    referenceId: "a",
    resultFiles: [
      { name: "a_res.m", dir: "", text: resultFixture() },
      { name: "b_res.m", dir: "", text: resultFixture() },
    ],
  });

  assert.ok(md.includes("### 3.1 "));
  assert.ok(md.includes("### 3.2 "));
  assert.ok(md.includes("반응도 비교"));
  assert.ok(md.includes("Δρ ($)"));
  // 기준 케이스의 β_eff 하나로 통일한다는 사실을 문서에 남겨야 한다.
  assert.ok(md.includes("β_eff 로 나눈 값"));
});

test("a single result file gets no comparison table", () => {
  const item = buildResultCase("case_res.m", resultFixture(), "one");
  const md = render({ cases: [item], referenceId: "one" });
  assert.ok(!md.includes("반응도 비교"));
});

test("detectLibraries prefers an explicit acelib over nuclide suffixes", () => {
  const withLib = parseSerpentInput('set acelib "/xs/sss_endfb7u.xsdata"\nmat f 1 92235.09c 1\n');
  assert.deepEqual(detectLibraries(withLib), ["`set acelib /xs/sss_endfb7u.xsdata`"]);

  const suffixOnly = parseSerpentInput("mat fuel -10.0 92235.09c 1.0 8016.06c 2.0\n");
  const inferred = detectLibraries(suffixOnly);
  assert.equal(inferred.length, 1);
  assert.ok(inferred[0].includes("06c"));
  assert.ok(inferred[0].includes("09c"));
});

test("detectCalculationTypes reports depletion and detectors when present", () => {
  const plain = detectCalculationTypes(parseSerpentInput("set pop 1000 100 20\n"));
  assert.deepEqual(plain, ["임계도 계산 (k-eigenvalue)"]);

  const rich = detectCalculationTypes(parseSerpentInput("dep butot 1 2 3\ndet flux de eg\n"));
  assert.ok(rich.includes("연소 계산 (depletion)"));
  assert.ok(rich.includes("검출기 tally"));
});

test("summarizeGeometry drops card kinds the model does not use", () => {
  const rows = summarizeGeometry(cards);
  const labels = rows.map((row) => row.label);
  assert.ok(labels.includes("표면 (surf)"));
  assert.ok(labels.includes("셀 (cell)"));
  // 샘플 입력은 격자를 쓰지 않으므로 0짜리 행이 남으면 안 된다.
  assert.ok(!labels.includes("격자 (lat)"));
  assert.ok(rows.every((row) => row.value > 0));
});

test("summaryFileName keeps the input's base name and stamps the date", () => {
  assert.equal(summaryFileName("temp_allout.txt", new Date(2026, 6, 30)), "temp_allout_정리_20260730.md");
  assert.equal(summaryFileName("", new Date(2026, 6, 30)), "serpent_정리_20260730.md");
});

test("pipes in a value cannot break the markdown table layout", () => {
  const md = render({ meta: { ...EMPTY_SUMMARY_META, analyst: "a | b" } });
  assert.ok(md.includes("a \\| b"));
});

/* ------------------------------------------------------- 스펙트럼 SVG (순수 함수) */

test("renderSpectrumSvg draws a self-contained svg with axis labels", () => {
  const c = buildResultCase("case_res.m", spectrumFixture(), "one");
  const svg = renderSpectrumSvg(c.spectrum);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("</svg>"));
  // 에너지 축은 eV 단위 log10 눈금이어야 한다 (0.1~10 MeV 구간 → 10^5~10^7 eV).
  assert.ok(svg.includes("10⁵") || svg.includes("10⁶") || svg.includes("10⁷"));
});

test("renderSpectrumSvg returns null when there is not enough data to plot", () => {
  assert.equal(renderSpectrumSvg([]), null);
  assert.equal(renderSpectrumSvg([{ low: 1, high: 2, perLethargy: 5 }]), null);
});

/* --------------------------------------------------- 이미지: 마크다운이 아니라 별도 PNG */

test("images are never embedded as data: URIs — the markdown only ever references file names", () => {
  const c = buildResultCase("case_res.m", spectrumFixture(), "one");
  const md = render({ cases: [c], referenceId: "one", geometryImage: geometryImageFixture });
  assert.ok(!md.includes("data:image"));
  assert.ok(!/!\[[^\]]*\]\(data:/.test(md));
});

test("the geometry image references a companion PNG file name with a same-folder note", () => {
  const { markdown, images } = renderSummaryMarkdown(baseSources({ geometryImage: geometryImageFixture }));
  assert.equal(images.geometry, geometryImageFileName("pwr_pin.inp", new Date(2026, 6, 30, 14, 5)));
  assert.ok(markdown.includes(`![형상 미리보기 (XY 단면)](${images.geometry})`));
  assert.ok(markdown.includes(`같은 폴더에 \`${images.geometry}\``));
  assert.ok(markdown.includes("XY 단면"));
  assert.ok(markdown.includes("512"));
});

test("a hint appears when includeImages is on but no snapshot has been captured yet", () => {
  const { markdown, images } = renderSummaryMarkdown(baseSources());
  assert.equal(images.geometry, null);
  assert.ok(markdown.includes("형상 이미지가 아직 캡처되지 않았습니다"));
});

test("turning images off drops the geometry section and the image plan entirely", () => {
  const { markdown, images } = renderSummaryMarkdown(baseSources({
    meta: { ...EMPTY_SUMMARY_META, includeImages: false },
    geometryImage: geometryImageFixture,
  }));
  assert.ok(!markdown.includes("### 2.4 형상 스냅샷"));
  assert.equal(images.geometry, null);
});

test("each case with a plottable spectrum gets its own PNG reference, named per case only when there are several", () => {
  const now = new Date(2026, 6, 30, 14, 5);
  const a = buildResultCase("a_res.m", spectrumFixture(), "a");
  const b = buildResultCase("b_res.m", spectrumFixture(), "b");

  const single = renderSummaryMarkdown(baseSources({ cases: [a], referenceId: "a", now }));
  assert.equal(single.images.spectra.length, 1);
  assert.equal(single.images.spectra[0].fileName, spectrumImageFileName("pwr_pin.inp", a.label, false, now));
  assert.ok(single.markdown.includes(`![${a.label} 중성자속 스펙트럼](${single.images.spectra[0].fileName})`));

  const multi = renderSummaryMarkdown(baseSources({ cases: [a, b], referenceId: "a", now }));
  assert.equal(multi.images.spectra.length, 2);
  assert.equal(multi.images.spectra[0].fileName, spectrumImageFileName("pwr_pin.inp", a.label, true, now));
  assert.equal(multi.images.spectra[1].fileName, spectrumImageFileName("pwr_pin.inp", b.label, true, now));
  // 여러 건일 때는 파일 이름 자체로 구분되어야 한다.
  assert.notEqual(multi.images.spectra[0].fileName, multi.images.spectra[1].fileName);
});

test("a case with no usable spectrum data gets no PNG reference and no dangling file promise", () => {
  const bare = buildResultCase("bare_res.m", resultFixture(), "one");
  const { markdown, images } = renderSummaryMarkdown(baseSources({ cases: [bare], referenceId: "one" }));
  assert.equal(images.spectra.length, 0);
  assert.ok(!/!\[[^\]]*스펙트럼/.test(markdown));
});

test("images off skips every PNG reference including per-case spectra", () => {
  const c = buildResultCase("case_res.m", spectrumFixture(), "one");
  const { markdown, images } = renderSummaryMarkdown(baseSources({
    meta: { ...EMPTY_SUMMARY_META, includeImages: false },
    cases: [c],
    referenceId: "one",
  }));
  assert.equal(images.spectra.length, 0);
  assert.ok(!markdown.includes(".png"));
  // 끄면 그림 참조만 빠지고 스펙트럼 요약 문장 자체는 남아야 한다.
  assert.ok(markdown.includes("중성자속 스펙트럼"));
});

test("geometryImageFileName and spectrumImageFileName sanitize labels and stamp the date", () => {
  const now = new Date(2026, 6, 30);
  assert.equal(geometryImageFileName("temp_allout.txt", now), "temp_allout_형상_20260730.png");
  assert.equal(spectrumImageFileName("temp_allout.txt", "case A/B", true, now), "temp_allout_스펙트럼_case_A_B_20260730.png");
  assert.equal(spectrumImageFileName("temp_allout.txt", "case A/B", false, now), "temp_allout_스펙트럼_20260730.png");
});

/* ------------------------------------------------------------------ 영문판 */

function richFixture({ keff = "1.05000E+00", betaEff = "7.30000E-03", lost = 3 } = {}) {
  return [
    `VERSION                   (idx, [1: 14])  = 'Serpent 2.1.32' ;`,
    `INPUT_FILE_NAME           (idx, [1:  4])  = 'case' ;`,
    `SIMULATION_COMPLETED      (idx, 1)        = 1 ;`,
    `LOST_PARTICLES            (idx, 1)        = ${lost} ;`,
    `POP                       (idx, 1)        = 100000 ;`,
    `CYCLES                    (idx, 1)        = 500 ;`,
    `SKIP                      (idx, 1)        = 100 ;`,
    `BALA_NEUTRON_DIFF         (idx, [1:  2])  = [ 0.4 0.0 ];`,
    `ANA_KEFF                  (idx, [1:  6])  = [  ${keff} 5.0E-05  1.0E+00 5.0E-05  0.0E+00 0.0 ];`,
    `BETA_EFF                  (idx, [1:  2])  = [  ${betaEff} 0.001 ];`,
    `ADJ_PERT_GEN_TIME         (idx, [1:  2])  = [  3.0000E-05 0.001 ];`,
    `TOT_LEAKRATE              (idx, [1:  2])  = [  1.0E+04 0.01 ];`,
    `TOT_SRCRATE               (idx, [1:  2])  = [  1.0E+06 0.01 ];`,
    `ANA_EALF                  (idx, [1:  2])  = [  0.6543 0.01 ];`,
    `ANA_AFGE                  (idx, [1:  2])  = [  0.4 0.01 ];`,
    `ANA_THERM_FRAC            (idx, [1:  2])  = [  0.18 0.01 ];`,
    `CONVERSION_RATIO          (idx, [1:  2])  = [  0.55 0.01 ];`,
    // stat(entries, name, 2) reads index [2,3], so the group-2 pair is what buildPhysics uses.
    `U235_FISS                 (idx, [1:  4])  = [  0.0 0.0  0.9 0.01 ];`,
    `U238_FISS                 (idx, [1:  4])  = [  0.0 0.0  0.1 0.01 ];`,
    `NUBAR                     (idx, [1:  2])  = [  2.43 0.01 ];`,
    `FISSE                     (idx, [1:  2])  = [  202.0 0.01 ];`,
    `INF_KINF                  (idx, [1:  2])  = [  1.08 0.01 ];`,
    `TOT_FMASS                 (idx, 1)        = 21000.0 ;`,
    `TOT_POWDENS               (idx, [1:  2])  = [  0.005 0.01 ];`,
    `PRECURSOR_GROUPS          (idx, 1)        = 1 ;`,
    `BETA_EFF                  (idx, [1: 4])   = [  7.3E-03 0.01  7.3E-03 0.01 ];`,
    `LAMBDA                    (idx, [1: 4])   = [  0.5 0.01  0.5 0.01 ];`,
    `MICRO_NG (idx, 1)       = 2 ;`,
    `MICRO_E  (idx, [1:  3]) = [  1.00000E-01  1.00000E+00  1.00000E+01 ];`,
    `INF_MICRO_FLX (idx, [1: 4]) = [  5.0E+04 0.01  6.0E+04 0.01 ];`,
    ``,
  ].join("\n");
}

const HANGUL = /[가-힣]/;

test("English locale leaves no Korean text behind for a case with checks, physics, delayed groups and a spectrum", () => {
  const c = buildResultCase("case_res.m", richFixture(), "one");
  const { markdown } = renderSummaryMarkdown(baseSources({
    meta: { ...EMPTY_SUMMARY_META, locale: "en", analyst: "J. Lee", location: "/home/user/calc", notes: "note" },
    cases: [c],
    referenceId: "one",
    geometryImage: geometryImageFixture,
  }));

  const hit = markdown.match(HANGUL);
  assert.equal(hit, null, `unexpected Korean text: ...${markdown.slice(Math.max(0, (hit?.index ?? 0) - 20), (hit?.index ?? 0) + 20)}...`);

  for (const heading of [
    "## 1. Overview", "## 2. Reproduction Info", "### 2.4 Geometry Snapshot",
    "## 3. Results", "### 3.1 Key Metrics", "**Run Conditions**", "**Physics Parameters**",
    "**Delayed Neutron Precursor Groups**", "**Health Checks**", "## 4. Full Input File",
  ]) {
    assert.ok(markdown.includes(heading), `missing heading: ${heading}`);
  }
});

test("English locale translates the known check-detail templates exactly, not just loosely", () => {
  const c = buildResultCase("case_res.m", richFixture({ lost: 7 }), "one");
  const { markdown } = renderSummaryMarkdown(baseSources({
    meta: { ...EMPTY_SUMMARY_META, locale: "en" },
    cases: [c],
    referenceId: "one",
  }));

  assert.ok(markdown.includes("| Simulation completed | OK | Completed normally |"));
  assert.ok(markdown.includes("7 — there are gaps in the geometry definition"));
  assert.ok(/Residual 0\.4/.test(markdown));
  assert.ok(/σ\(k\) = [\d.]+ pcm · ±[\d.]+ pcm for a two-case difference/.test(markdown));
});

test("English locale translates physics labels while leaving numeric values untouched", () => {
  const c = buildResultCase("case_res.m", richFixture(), "one");
  const { markdown } = renderSummaryMarkdown(baseSources({
    meta: { ...EMPTY_SUMMARY_META, locale: "en" },
    cases: [c],
    referenceId: "one",
  }));
  assert.ok(markdown.includes("Leakage fraction"));
  assert.ok(markdown.includes("Mean fission energy"));
  assert.ok(markdown.includes("Thermal fraction"));
  assert.ok(markdown.includes("Conversion ratio"));
  assert.ok(markdown.includes("Fission share"));
  assert.ok(markdown.includes("Energy per fission"));
  assert.ok(markdown.includes("Fuel mass"));
  assert.ok(markdown.includes("Power density"));
  // U235/U238 라벨 자체는 원소 기호라 두 언어 모두 그대로 남아야 한다.
  assert.ok(markdown.includes("U235 90.0% / U238 10.0%"));
});

test("English locale translates a parse failure message", () => {
  // entries 가 비어야(즉 NAME (idx, ...) = ... 형태가 하나도 안 잡혀야) error 가 채워진다.
  const broken = buildResultCase("bad_res.m", "this is not a Serpent result file at all\n", "one");
  assert.equal(broken.error, "Serpent 결과 형식(_res.m)으로 읽을 수 없습니다.");
  const { markdown } = renderSummaryMarkdown(baseSources({
    meta: { ...EMPTY_SUMMARY_META, locale: "en" },
    cases: [broken],
    referenceId: "one",
  }));
  assert.ok(markdown.includes("> Parse failed: Not readable as a Serpent result file (_res.m)."));
});

test("English locale headings for the multi-case comparison section", () => {
  const a = buildResultCase("a_res.m", richFixture({ keff: "1.05000E+00" }), "a");
  const b = buildResultCase("b_res.m", richFixture({ keff: "1.02000E+00", betaEff: "8.0E-03" }), "b");
  const { markdown } = renderSummaryMarkdown(baseSources({
    meta: { ...EMPTY_SUMMARY_META, locale: "en" },
    cases: [a, b],
    referenceId: "a",
  }));
  assert.ok(markdown.includes("### 3.1 a"));
  assert.ok(markdown.includes(`### 3.1 a  *(reference)*`));
  assert.ok(markdown.includes("### 3.3 Reactivity Comparison"));
  assert.ok(markdown.includes("a *(reference)*"));
  assert.ok(/Δρ\(\$\) for every row is divided by the reference case's \(a\) β_eff\./.test(markdown));
});

test("file naming switches suffix by locale, keeping the rest of the scheme identical", () => {
  const now = new Date(2026, 6, 30);
  assert.equal(summaryFileName("temp_allout.txt", now, "en"), "temp_allout_summary_20260730.md");
  assert.equal(geometryImageFileName("temp_allout.txt", now, "en"), "temp_allout_geometry_20260730.png");
  assert.equal(spectrumImageFileName("temp_allout.txt", "Case A", true, now, "en"), "temp_allout_spectrum_Case_A_20260730.png");
});

test("English overview and file-list labels replace the Korean ones", () => {
  const md = render({
    meta: {
      ...EMPTY_SUMMARY_META, locale: "en", analyst: "Jane", location: "/home/user/calc",
    },
    inputFile: { name: "pwr_pin.inp", dir: "calc", text: SAMPLE_INPUT, lastModified: Date.UTC(2026, 0, 2) },
  });
  assert.ok(md.includes("| Analyst | Jane |"));
  assert.ok(md.includes("| Input file | `pwr_pin.inp` |"));
  assert.ok(md.includes("| Calculation type | Criticality calculation (k-eigenvalue) |"));
  assert.ok(md.includes("| File | Role | Folder | Modified | Size (bytes) | Checksum |"));
  assert.ok(md.includes("Input file"));
  assert.ok(!md.includes("작성자"));
  assert.ok(!md.includes("입력문"));
});
