/**
 * 계산 정리(Markdown) 내보내기.
 *
 * 정식 설계노트를 쓰기 전 단계에서, 나중에 같은 계산을 다시 돌릴 수 있도록
 * "무엇을 · 어디서 · 언제 · 어떤 조건으로 돌렸고 결과가 무엇이었는지"를 한 파일에 모은다.
 * 재현에 필요한 정보가 최우선이므로 입력문은 요약하지 않고 전문을 그대로 싣는다.
 *
 * 이 파일은 문서 형식만 알고 React 나 DOM 은 모른다. 덕분에 노드에서 그대로 테스트된다.
 */

import type { HealthCheck, ResultCase, SpectrumBin } from "./results.ts";
import { buildWorthTable } from "./results.ts";
import type { IngestedFile } from "./pairing.ts";
import type { SerpentCard } from "./serpent.ts";

/** 문서 언어. lib/results.ts 가 만드는 값(체크·물리 특성 라벨 등)은 항상 한국어라, 그쪽은
 * 건드리지 않고 이 모듈 안에서 알려진 어휘만 번역한다(아래 TRANSLATE_* 참고). */
export type Locale = "ko" | "en";

/** 사용자가 직접 채우는 항목. 브라우저가 알 수 없거나 판단이 필요한 것들만 둔다. */
export type SummaryMeta = {
  title: string;
  analyst: string;
  /**
   * 입력문이 실제로 보관된 위치. 브라우저는 보안상 절대 경로를 주지 않으므로
   * 재현하려면 이 값만큼은 사람이 적어야 한다.
   */
  location: string;
  notes: string;
  /** 형상·스펙트럼을 별도 PNG 파일로 함께 받을지. 끄면 마크다운만 받는다. */
  includeImages: boolean;
  /** 문서 언어. 파일 이름 접미사에도 그대로 반영된다. */
  locale: Locale;
};

export const EMPTY_SUMMARY_META: SummaryMeta = {
  title: "",
  analyst: "",
  location: "",
  notes: "",
  includeImages: true,
  locale: "ko",
};

/** 형상 미리보기 캔버스를 찍은 스냅샷. DOM 을 아는 쪽(app/page.tsx)에서 만들어 넘겨준다. */
export type SummaryGeometryImage = {
  /** `data:image/png;base64,...` 그대로. */
  dataUrl: string;
  width: number;
  height: number;
  /** "XY" 처럼 화면에 보이던 단면. */
  basis: string;
};

export type SummaryFile = {
  name: string;
  /** 브라우저가 준 상대 폴더. 없으면 빈 문자열. */
  dir: string;
  role: string;
  size: number;
  modified: string;
  checksum: string;
};

export type SummarySources = {
  meta: SummaryMeta;
  inputName: string;
  inputText: string;
  /** 입력문을 파일로 연 경우의 원본 정보. 샘플/직접 편집 상태면 undefined. */
  inputFile?: IngestedFile;
  cards: SerpentCard[];
  cases: ResultCase[];
  referenceId: string;
  resultFiles: IngestedFile[];
  /** 형상 미리보기 캔버스 스냅샷. 캔버스라 이 모듈 스스로는 만들 수 없다. */
  geometryImage?: SummaryGeometryImage;
  now?: Date;
};

/* --------------------------------------------------------------- 다국어 문구 */

/**
 * 문서 자체가 쓰는 고정 문구(제목, 표 머리글, 안내 문장 등)의 두 언어 버전.
 * lib/results.ts 가 만드는 값(체크·물리 특성 라벨, 상태, 오류 메시지)은 이 모듈이
 * 관여하지 않는 별도 어휘라 TRANSLATE_* 테이블로 따로 옮긴다 — 그쪽은 항상 한국어로
 * 생성되므로, 사전에 없는 새 문구가 추가되면 번역이 아니라 원문이 그대로 나온다.
 */
type Strings = {
  titleFallback: string;
  generatedBy: (stamp: string) => string;
  disclaimer: string;
  overviewHeading: string;
  itemCol: string;
  valueCol: string;
  analyst: string;
  inputFile: string;
  calcType: string;
  serpentVersion: string;
  library: string;
  libraryMissing: string;
  resultFiles: string;
  resultFilesCount: (n: number) => string;
  resultFilesNone: string;
  notes: string;
  reproHeading: string;
  locationHeading: string;
  locationMissing: string[];
  fileListHeading: string;
  fileCols: string[];
  checksumNote: string[];
  roleInput: string;
  roleInputUnsaved: string;
  roleResult: string;
  roleResultFor: (label: string) => string;
  geometrySizeHeading: string;
  countCol: string;
  geoSurf: string; geoCell: string; geoMat: string; geoLat: string; geoPin: string;
  calcCrit: string; calcDep: string; calcDet: string; calcSrc: string; calcGcu: string;
  libNuclideSuffix: (list: string) => string;
  snapshotHeading: string;
  snapshotCaption: (basis: string) => string;
  snapshotNote: (basis: string, w: number, h: number) => string;
  companionNote: (file: string) => string;
  snapshotMissing: string;
  resultsHeading: string;
  resultsNone: string;
  referenceTag: string;
  singleCaseHeading: string;
  caseHeading: (n: number) => string;
  parseFailed: (msg: string) => string;
  metricCols: string[];
  rhoLabel: string;
  genTimeLabel: (estimator: string) => string;
  dollarsLabel: string;
  runConditionsHeading: string;
  popLabel: string; cyclesLabel: string; skipLabel: string; activeLabel: string; powerLabel: string; runTimeLabel: string;
  physicsHeading: string;
  delayedHeading: (source: string) => string;
  groupCols: string[];
  healthHeading: (status: string) => string;
  checkCols: string[];
  spectrumSummary: (n: number, low: string, high: string) => string;
  spectrumCaption: (label: string) => string;
  comparisonHeading: (n: number) => string;
  worthCols: string[];
  worthNote: (label: string) => string[];
  inputHeading: string;
  inputFileLine: (name: string, lines: number, bytes: string) => string;
};

const STRINGS: Record<Locale, Strings> = {
  ko: {
    titleFallback: "Serpent 계산 정리",
    generatedBy: (stamp) => `> SERPENT Studio 자동 정리 · ${stamp} 생성`,
    disclaimer: "> 이 문서는 계산 재현을 위한 기록이며, 정식 설계노트를 대신하지 않습니다.",
    overviewHeading: "## 1. 개요",
    itemCol: "항목",
    valueCol: "내용",
    analyst: "작성자",
    inputFile: "입력문",
    calcType: "계산 유형",
    serpentVersion: "Serpent 버전",
    library: "단면적 라이브러리",
    libraryMissing: "확인 필요 — 입력문에 지정 없음",
    resultFiles: "결과문",
    resultFilesCount: (n) => `${n}건`,
    resultFilesNone: "없음",
    notes: "**비고**",
    reproHeading: "## 2. 재현 정보",
    locationHeading: "### 2.1 파일 위치",
    locationMissing: [
      "> ⚠ 파일 위치가 비어 있습니다. 브라우저는 보안상 실제 경로를 알려주지 않으므로,",
      "> 재현하려면 계산을 돌린 디렉터리를 직접 적어야 합니다.",
    ],
    fileListHeading: "### 2.2 파일 목록",
    fileCols: ["파일", "역할", "폴더", "수정 시각", "크기 (bytes)", "체크섬"],
    checksumNote: [
      "> 체크섬은 FNV-1a 32비트 해시입니다. `md5sum` 결과와는 다른 값이므로,",
      "> 대조할 때는 같은 방식으로 계산한 값끼리 비교해야 합니다.",
    ],
    roleInput: "입력문",
    roleInputUnsaved: "입력문 (앱에서 편집 중 — 원본 파일 아님)",
    roleResult: "결과문",
    roleResultFor: (label) => `결과문 — ${label}`,
    geometrySizeHeading: "### 2.3 형상 규모",
    countCol: "수",
    geoSurf: "표면 (surf)", geoCell: "셀 (cell)", geoMat: "물질 (mat)", geoLat: "격자 (lat)", geoPin: "핀 (pin)",
    calcCrit: "임계도 계산 (k-eigenvalue)",
    calcDep: "연소 계산 (depletion)",
    calcDet: "검출기 tally",
    calcSrc: "외부 선원 계산",
    calcGcu: "군정수 생성",
    libNuclideSuffix: (list) => `핵종 접미사 \`${list}\` 만 확인됨 (라이브러리 경로 미지정)`,
    snapshotHeading: "### 2.4 형상 스냅샷",
    snapshotCaption: (basis) => `형상 미리보기 (${basis} 단면)`,
    snapshotNote: (basis, w, h) => `> ${basis} 단면 · ${w}×${h}px · 화면에 보이던 형상 미리보기를 그대로 찍은 것입니다.`,
    companionNote: (file) => `> 같은 폴더에 \`${file}\` 파일을 함께 두어야 그림이 보입니다.`,
    snapshotMissing: "> ⚠ 형상 이미지가 아직 캡처되지 않았습니다. 앱에서 \"계산 정리\" 탭을 열면 자동으로 채워집니다.",
    resultsHeading: "## 3. 결과",
    resultsNone: "결과문이 열려 있지 않습니다.",
    referenceTag: "*(기준)*",
    singleCaseHeading: "### 3.1 주요 지표",
    caseHeading: (n) => `### 3.${n}`,
    parseFailed: (msg) => `> 파싱 실패: ${msg}`,
    metricCols: ["항목", "값"],
    rhoLabel: "반응도 ρ",
    genTimeLabel: (estimator) => `세대시간 Λ${estimator ? ` (${estimator})` : ""}`,
    dollarsLabel: "반응도",
    runConditionsHeading: "**실행 조건**",
    popLabel: "중성자 이력 (POP)",
    cyclesLabel: "전체 세대 (CYCLES)",
    skipLabel: "비활성 세대 (SKIP)",
    activeLabel: "활성 세대",
    powerLabel: "출력",
    runTimeLabel: "실행 시간",
    physicsHeading: "**물리 특성**",
    delayedHeading: (source) => `**지연중성자 전구체군** (${source})`,
    groupCols: ["군", "β_eff", "비율", "λ (s⁻¹)"],
    healthHeading: (status) => `**건전성 검사** — 종합: ${status}`,
    checkCols: ["검사", "상태", "내용"],
    spectrumSummary: (n, low, high) => `**중성자속 스펙트럼** — ${n}군, ${low} eV ~ ${high} eV`,
    spectrumCaption: (label) => `${label} 중성자속 스펙트럼`,
    comparisonHeading: (n) => `### 3.${n} 반응도 비교`,
    worthCols: ["케이스", "k_eff", "ρ", "Δρ", "Δρ ($)"],
    worthNote: (label) => [
      `> Δρ($) 는 모든 행을 기준 케이스(${label})의 β_eff 로 나눈 값입니다.`,
      "> 행마다 자기 β_eff 를 쓰면 같은 표 안에서 기준이 달라져 비교할 수 없게 됩니다.",
    ],
    inputHeading: "## 4. 입력문 전문",
    inputFileLine: (name, lines, bytes) => `파일명 \`${name}\` · ${lines}줄 · ${bytes} bytes`,
  },
  en: {
    titleFallback: "Serpent Calculation Summary",
    generatedBy: (stamp) => `> Generated automatically by SERPENT Studio · ${stamp}`,
    disclaimer: "> This document is a record for reproducing the calculation — it is not a substitute for a formal calculation note.",
    overviewHeading: "## 1. Overview",
    itemCol: "Item",
    valueCol: "Value",
    analyst: "Analyst",
    inputFile: "Input file",
    calcType: "Calculation type",
    serpentVersion: "Serpent version",
    library: "Cross-section library",
    libraryMissing: "Not found — not specified in the input",
    resultFiles: "Result files",
    resultFilesCount: (n) => `${n}`,
    resultFilesNone: "None",
    notes: "**Notes**",
    reproHeading: "## 2. Reproduction Info",
    locationHeading: "### 2.1 File Location",
    locationMissing: [
      "> ⚠ File location is empty. Browsers do not expose real file system paths for security reasons,",
      "> so you need to write in the directory the calculation was run from for this to be reproducible.",
    ],
    fileListHeading: "### 2.2 File List",
    fileCols: ["File", "Role", "Folder", "Modified", "Size (bytes)", "Checksum"],
    checksumNote: [
      "> The checksum is an FNV-1a 32-bit hash. It is not the same as `md5sum`,",
      "> so only compare values computed with the same algorithm.",
    ],
    roleInput: "Input file",
    roleInputUnsaved: "Input file (currently being edited in the app — not the original file)",
    roleResult: "Result file",
    roleResultFor: (label) => `Result file — ${label}`,
    geometrySizeHeading: "### 2.3 Geometry Size",
    countCol: "Count",
    geoSurf: "Surfaces (surf)", geoCell: "Cells (cell)", geoMat: "Materials (mat)", geoLat: "Lattices (lat)", geoPin: "Pins (pin)",
    calcCrit: "Criticality calculation (k-eigenvalue)",
    calcDep: "Depletion (burnup) calculation",
    calcDet: "Detector tally",
    calcSrc: "External source calculation",
    calcGcu: "Group constant generation",
    libNuclideSuffix: (list) => `Only nuclide suffixes \`${list}\` found (library path not specified)`,
    snapshotHeading: "### 2.4 Geometry Snapshot",
    snapshotCaption: (basis) => `Geometry preview (${basis} section)`,
    snapshotNote: (basis, w, h) => `> ${basis} section · ${w}×${h}px · captured directly from the geometry preview shown on screen.`,
    companionNote: (file) => `> Keep \`${file}\` in the same folder for the image to display.`,
    snapshotMissing: "> ⚠ No geometry image has been captured yet. Opening the \"Calculation Summary\" tab in the app fills this in automatically.",
    resultsHeading: "## 3. Results",
    resultsNone: "No result files are open.",
    referenceTag: "*(reference)*",
    singleCaseHeading: "### 3.1 Key Metrics",
    caseHeading: (n) => `### 3.${n}`,
    parseFailed: (msg) => `> Parse failed: ${msg}`,
    metricCols: ["Item", "Value"],
    rhoLabel: "Reactivity ρ",
    genTimeLabel: (estimator) => `Generation time Λ${estimator ? ` (${estimator})` : ""}`,
    dollarsLabel: "Reactivity ($)",
    runConditionsHeading: "**Run Conditions**",
    popLabel: "Neutron histories (POP)",
    cyclesLabel: "Total cycles (CYCLES)",
    skipLabel: "Inactive cycles (SKIP)",
    activeLabel: "Active cycles",
    powerLabel: "Power",
    runTimeLabel: "Running time",
    physicsHeading: "**Physics Parameters**",
    delayedHeading: (source) => `**Delayed Neutron Precursor Groups** (${source})`,
    groupCols: ["Group", "β_eff", "Share", "λ (s⁻¹)"],
    healthHeading: (status) => `**Health Checks** — Overall: ${status}`,
    checkCols: ["Check", "Status", "Detail"],
    spectrumSummary: (n, low, high) => `**Neutron Flux Spectrum** — ${n} groups, ${low} eV – ${high} eV`,
    spectrumCaption: (label) => `${label} neutron flux spectrum`,
    comparisonHeading: (n) => `### 3.${n} Reactivity Comparison`,
    worthCols: ["Case", "k_eff", "ρ", "Δρ", "Δρ ($)"],
    worthNote: (label) => [
      `> Δρ($) for every row is divided by the reference case's (${label}) β_eff.`,
      "> Using each row's own β_eff would put every row on a different scale within the same table, making them impossible to compare.",
    ],
    inputHeading: "## 4. Full Input File",
    inputFileLine: (name, lines, bytes) => `File \`${name}\` · ${lines} lines · ${bytes} bytes`,
  },
};

/** lib/results.ts 가 만드는 건전성 검사 라벨. 항상 한국어로 생성되므로 원문 기준으로 찾는다. */
const TRANSLATE_CHECK_LABEL: Record<string, string> = {
  "k_eff": "k_eff",
  "계산 완료": "Simulation completed",
  "입자 손실": "Particle loss",
  "중성자 균형": "Neutron balance",
  "통계 정밀도": "Statistical precision",
  "추정기 일치": "Estimator agreement",
};

/** lib/results.ts 의 buildPhysics 가 만드는 라벨. 값(value)은 숫자+단위뿐이라 번역이 필요 없다. */
const TRANSLATE_PHYSICS_LABEL: Record<string, string> = {
  "누설률": "Leakage fraction",
  "EALF": "EALF",
  "평균 분열 에너지": "Mean fission energy",
  "열중성자 비율": "Thermal fraction",
  "전환비": "Conversion ratio",
  "분열 분담": "Fission share",
  "ν̄": "ν̄",
  "분열당 에너지": "Energy per fission",
  "k∞": "k∞",
  "핵연료 질량": "Fuel mass",
  "출력밀도": "Power density",
};

const TRANSLATE_PHYSICS_HINT: Record<string, string> = {
  "전체 중성자 생성 대비 체계 밖으로 빠져나간 비율": "Share of generated neutrons that leaked out of the system",
  "핵분열을 일으킨 중성자의 평균 렙서지 대응 에너지 — 스펙트럼 경연도 지표":
    "Average lethargy-equivalent energy of neutrons causing fission — a spectrum hardness indicator",
  "핵분열을 유발한 중성자의 평균 에너지": "Average energy of neutrons that caused fission",
  "열영역에서 일어난 반응의 비중": "Share of reactions occurring in the thermal range",
  "핵분열성 물질 소모 대비 생성 비율": "Ratio of fissile material produced to consumed",
  "핵종별 분열 기여도": "Fission contribution by nuclide",
  "분열당 방출 중성자 수": "Neutrons emitted per fission",
  "핵분열 1회당 발생 에너지": "Energy released per fission event",
  "무한체계 증배계수 (누설 무시)": "Infinite-medium multiplication factor (leakage ignored)",
  "체계 내 중핵종 총 질량": "Total heavy-nuclide mass in the system",
  "핵연료 질량당 출력": "Power per unit fuel mass",
};

const TRANSLATE_STATUS: Record<HealthCheck["status"], string> = { ok: "OK", warn: "Warning", bad: "Bad" };
const STATUS_KO: Record<HealthCheck["status"], string> = { ok: "정상", warn: "주의", bad: "이상" };

/**
 * buildChecks() 의 detail 문구는 전부 우리 코드가 만든 고정 템플릿이라(사용자 입력이
 * 섞이지 않는다) 정규식으로 안전하게 옮길 수 있다. 새 템플릿이 추가돼 매칭에 실패하면
 * 원문(한국어)을 그대로 돌려준다 — 조용히 깨진 번역을 보여주는 것보다는 낫다.
 */
function translateCheckDetail(detail: string): string {
  const exact: Record<string, string> = {
    "IMP_KEFF/ABS_KEFF/COL_KEFF/ANA_KEFF 중 어느 것도 없습니다 — 임계도 계산 결과가 아니거나 파일이 잘렸습니다.":
      "None of IMP_KEFF/ABS_KEFF/COL_KEFF/ANA_KEFF are present — this may not be a criticality result, or the file is truncated.",
    "SIMULATION_COMPLETED 항목이 없습니다 — 정상 종료 여부를 확인할 수 없습니다.":
      "SIMULATION_COMPLETED is missing — normal completion cannot be confirmed.",
    "정상 종료": "Completed normally",
    "중간에 종료됨 — 결과 사용 불가": "Terminated early — results are not usable",
    "LOST_PARTICLES 항목이 없습니다 — 입자 손실 여부를 확인할 수 없습니다.":
      "LOST_PARTICLES is missing — particle loss cannot be confirmed.",
    "0개": "0",
  };
  if (exact[detail]) return exact[detail];

  const lostMatch = /^(\d+)개 — 기하 정의에 빈틈이 있습니다$/.exec(detail);
  if (lostMatch) return `${lostMatch[1]} — there are gaps in the geometry definition`;

  const residualMatch = /^잔차 (.+)$/.exec(detail);
  if (residualMatch) return `Residual ${residualMatch[1]}`;

  const precisionMatch = /^σ\(k\) = ([\d.]+) pcm · 두 케이스 차이 기준 ±([\d.]+) pcm$/.exec(detail);
  if (precisionMatch) return `σ(k) = ${precisionMatch[1]} pcm · ±${precisionMatch[2]} pcm for a two-case difference`;

  const agreementMatch = /^최대 편차 ([\d.]+)σ \((.+)\)$/.exec(detail);
  if (agreementMatch) return `Max deviation ${agreementMatch[1]}σ (${agreementMatch[2]})`;

  return detail;
}

const TRANSLATE_ERROR: Record<string, string> = {
  "Serpent 결과 형식(_res.m)으로 읽을 수 없습니다.": "Not readable as a Serpent result file (_res.m).",
  "결과를 읽을 수 없습니다.": "Could not read the results.",
};

/**
 * lib/results.ts 가 만드는 건전성 검사 라벨/상태/내용을 옮긴다. 문서 내보내기뿐 아니라
 * 화면의 결과 분석 탭도 같은 값을 그대로 보여주므로, 두 곳에서 쓸 수 있게 export 한다.
 */
export function tCheck(check: HealthCheck, locale: Locale) {
  if (locale === "ko") return { label: check.label, status: STATUS_KO[check.status], detail: check.detail };
  return {
    label: TRANSLATE_CHECK_LABEL[check.label] ?? check.label,
    status: TRANSLATE_STATUS[check.status],
    detail: translateCheckDetail(check.detail),
  };
}

export function tPhysicsLabel(label: string, locale: Locale) {
  return locale === "en" ? (TRANSLATE_PHYSICS_LABEL[label] ?? label) : label;
}

export function tPhysicsHint(hint: string, locale: Locale) {
  return locale === "en" ? (TRANSLATE_PHYSICS_HINT[hint] ?? hint) : hint;
}

export function tStatus(status: HealthCheck["status"], locale: Locale) {
  return locale === "en" ? TRANSLATE_STATUS[status] : STATUS_KO[status];
}

export function tError(message: string, locale: Locale) {
  return locale === "en" ? (TRANSLATE_ERROR[message] ?? message) : message;
}

/* ------------------------------------------------------------------ 유틸 */

function num(value: number, digits = 5) {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e6)) return value.toExponential(digits - 1);
  return value.toFixed(digits);
}

/** Monte Carlo 결과는 통계오차 없이 적으면 안 되므로 항상 붙여서 만든다. */
function withError(value: number, abs: number, digits = 6) {
  return `${num(value, digits)} ± ${num(abs, digits)}`;
}

function bytesOf(text: string) {
  return new TextEncoder().encode(text).length;
}

/** 로컬 시간대 기준 `YYYY-MM-DD HH:MM`. ISO 문자열은 UTC 라 실제 작업 시각과 어긋난다. */
export function formatStamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 파일 식별용 체크섬 (FNV-1a 32비트).
 *
 * md5sum 과 값이 다르므로 알고리즘 이름을 함께 표기한다. 목적은 암호학적 무결성이 아니라
 * "지금 이 파일이 그때 그 파일인지" 확인이며, 그 용도에는 충분하다.
 */
export function checksum(text: string) {
  const bytes = new TextEncoder().encode(text);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-32:${hash.toString(16).padStart(8, "0")}`;
}

function describeFile(file: IngestedFile, role: string): SummaryFile {
  return {
    name: file.name,
    dir: file.dir,
    role,
    size: bytesOf(file.text),
    modified: file.lastModified ? formatStamp(new Date(file.lastModified)) : "—",
    checksum: checksum(file.text),
  };
}

/* ------------------------------------------------------- 입력문에서 뽑는 정보 */

/**
 * 사용한 단면적 라이브러리. `set acelib` 이 있으면 그 경로를 그대로 쓰고,
 * 없으면 핵종 접미사만 모은다. 접미사는 라이브러리 이름이 아니라 온도 코드이므로
 * 추론이라는 사실을 함께 표시한다.
 */
export function detectLibraries(cards: SerpentCard[], locale: Locale = "ko") {
  const explicit: string[] = [];
  const suffixes = new Set<string>();

  for (const card of cards) {
    for (const line of card.lines) {
      const match = /^\s*set\s+(acelib|declib|nfylib)\s+(.+?)\s*$/.exec(line.replace(/%.*$/, ""));
      if (match) {
        const value = match[2].trim().replace(/^"|"$/g, "");
        if (value) explicit.push(`\`set ${match[1]} ${value}\``);
      }
    }
    if (card.kind !== "material") continue;
    for (const line of card.lines) {
      const scan = /\b\d{4,6}\.(\d{2}[a-z])\b/g;
      let hit: RegExpExecArray | null;
      while ((hit = scan.exec(line))) suffixes.add(hit[1]);
    }
  }

  if (explicit.length) return explicit;
  if (suffixes.size) return [STRINGS[locale].libNuclideSuffix([...suffixes].sort().join("`, `"))];
  return [];
}

/** 입력문에 어떤 계산이 켜져 있는지. 정리 문서 첫머리에 한 줄로 보여 준다. */
export function detectCalculationTypes(cards: SerpentCard[], locale: Locale = "ko") {
  const t = STRINGS[locale];
  const types = new Set<string>([t.calcCrit]);
  for (const card of cards) {
    if (card.keyword === "dep") types.add(t.calcDep);
    if (card.keyword === "det") types.add(t.calcDet);
    if (card.keyword === "src") types.add(t.calcSrc);
    if (card.keyword === "set" && /^\s*set\s+gcu\b/.test(card.lines[0] ?? "")) types.add(t.calcGcu);
  }
  return [...types];
}

/** 형상 규모 요약. 모델 크기를 한눈에 보기 위한 것. */
export function summarizeGeometry(cards: SerpentCard[], locale: Locale = "ko") {
  const t = STRINGS[locale];
  const rows: { label: string; value: number }[] = [
    { label: t.geoSurf, value: cards.filter((card) => card.kind === "surface").length },
    { label: t.geoCell, value: cards.filter((card) => card.kind === "cell").length },
    { label: t.geoMat, value: cards.filter((card) => card.kind === "material").length },
    { label: t.geoLat, value: cards.filter((card) => card.keyword === "lat").length },
    { label: t.geoPin, value: cards.filter((card) => card.keyword === "pin").length },
  ];
  return rows.filter((row) => row.value > 0);
}

/* ------------------------------------------------------------ 마크다운 조립 */

function table(headers: string[], rows: string[][]) {
  if (!rows.length) return "";
  // 표 안에서는 | 와 줄바꿈이 셀 경계를 깨뜨리므로 미리 없앤다.
  const clean = (cell: string) => cell.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(clean).join(" | ")} |`),
  ].join("\n");
}

function orDash(text: string) {
  return text.trim() || "—";
}

/** 입력문 전문을 감쌀 펜스. 본문에 ``` 가 들어 있으면 더 긴 펜스를 써야 깨지지 않는다. */
function fenceFor(text: string) {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

/* -------------------------------------------------------------- 스펙트럼 그림 */

/** app/page.tsx 가 이 SVG 를 캔버스에 그대로 얹어 PNG 로 래스터화할 때 같이 쓴다. */
export const SPECTRUM_SVG_WIDTH = 640;
export const SPECTRUM_SVG_HEIGHT = 300;
const SPECTRUM_SVG_PAD = { left: 60, right: 16, top: 14, bottom: 40 };
/** Serpent 의 MICRO_E 는 MeV 단위지만, 노심 스펙트럼 그림은 관례적으로 eV 축을 쓴다. */
const EV_PER_MEV = 1e6;
/** 봉우리 아래로 이만큼의 decade 까지만 보여준다. 화면 차트와 같은 값을 쓴다. */
const SPECTRUM_SVG_DECADES = 5;
const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

function exponentLabel(power: number) {
  return `10${String(power).split("").map((ch) => SUPERSCRIPT_DIGITS[ch] ?? ch).join("")}`;
}

function escapeXml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 중성자속 스펙트럼을 독립된 정적 SVG 로 그린다.
 *
 * 화면의 인터랙티브 차트(hover, 표)와는 완전히 별개다. 마크다운은 hover 를 가질 수
 * 없으니 그 로직을 그대로 재사용할 수 없고, 대신 같은 로그-로그 관례로 다시 그린다.
 * DOM 이나 canvas 를 전혀 쓰지 않는 순수 함수라 Node 테스트에서 그대로 검증된다.
 */
export function renderSpectrumSvg(bins: SpectrumBin[]): string | null {
  const usable = bins
    .filter((bin) => bin.perLethargy > 0)
    .slice()
    .sort((a, b) => a.low - b.low);
  if (usable.length < 2) return null;

  const width = SPECTRUM_SVG_WIDTH;
  const height = SPECTRUM_SVG_HEIGHT;
  const pad = SPECTRUM_SVG_PAD;
  const plotRight = width - pad.right;
  const plotBottom = height - pad.bottom;

  const eLow = Math.log10(usable[0].low * EV_PER_MEV);
  const eHigh = Math.log10(usable[usable.length - 1].high * EV_PER_MEV);
  if (!Number.isFinite(eLow) || !Number.isFinite(eHigh) || eHigh <= eLow) return null;

  const peak = Math.max(...usable.map((bin) => bin.perLethargy));
  const fluxHigh = Math.ceil(Math.log10(peak));
  const fluxLow = fluxHigh - SPECTRUM_SVG_DECADES;

  const x = (ev: number) => pad.left + ((Math.log10(ev) - eLow) / (eHigh - eLow)) * (plotRight - pad.left);
  const y = (flux: number) => {
    const clamped = Math.max(flux, 10 ** fluxLow);
    return pad.top + (1 - (Math.log10(clamped) - fluxLow) / (fluxHigh - fluxLow)) * (plotBottom - pad.top);
  };

  const xTicks: number[] = [];
  for (let d = Math.ceil(eLow); d <= Math.floor(eHigh); d += 1) xTicks.push(d);
  const yTicks: number[] = [];
  for (let d = fluxLow; d <= fluxHigh; d += 1) yTicks.push(d);

  let path = `M ${x(usable[0].low * EV_PER_MEV).toFixed(1)} ${plotBottom.toFixed(1)} `;
  for (const bin of usable) {
    const x1 = x(bin.low * EV_PER_MEV);
    const x2 = x(bin.high * EV_PER_MEV);
    const top = y(bin.perLethargy);
    path += `L ${x1.toFixed(1)} ${top.toFixed(1)} L ${x2.toFixed(1)} ${top.toFixed(1)} `;
  }
  path += `L ${plotRight.toFixed(1)} ${plotBottom.toFixed(1)} Z`;

  const gridX = xTicks.map((d) => {
    const px = x(10 ** d).toFixed(1);
    return `<line x1="${px}" y1="${pad.top}" x2="${px}" y2="${plotBottom}" stroke="#dbe4e0" stroke-width="1"/>`;
  }).join("");
  const gridY = yTicks.map((d) => {
    const py = y(10 ** d).toFixed(1);
    return `<line x1="${pad.left}" y1="${py}" x2="${plotRight}" y2="${py}" stroke="#dbe4e0" stroke-width="1"/>`;
  }).join("");
  const labelX = xTicks.map((d) =>
    `<text x="${x(10 ** d).toFixed(1)}" y="${plotBottom + 18}" font-size="11" text-anchor="middle" fill="#4b5b55">${escapeXml(exponentLabel(d))}</text>`,
  ).join("");
  const labelY = yTicks.map((d) =>
    `<text x="${pad.left - 8}" y="${(y(10 ** d) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="#4b5b55">${escapeXml(exponentLabel(d))}</text>`,
  ).join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    gridX, gridY,
    `<path d="${path}" fill="#2f7a5f22" stroke="#2f7a5f" stroke-width="1.5" stroke-linejoin="round"/>`,
    `<line x1="${pad.left}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#4b5b55" stroke-width="1"/>`,
    `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${plotBottom}" stroke="#4b5b55" stroke-width="1"/>`,
    labelX, labelY,
    `<text x="${(pad.left + plotRight) / 2}" y="${height - 6}" font-size="11" text-anchor="middle" fill="#4b5b55">Energy (eV)</text>`,
    `<text x="14" y="${(pad.top + plotBottom) / 2}" font-size="11" text-anchor="middle" fill="#4b5b55" `
    + `transform="rotate(-90 14 ${(pad.top + plotBottom) / 2})">Flux per unit lethargy (log)</text>`,
    `</svg>`,
  ].join("");
}

/** UTF-8 안전 base64. btoa 는 라틴-1 밖의 문자(±, 위 첨자 숫자 등)에서 그대로 깨진다. */
function base64Utf8(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** app/page.tsx 가 이 SVG 를 `<img>` 에 실어 캔버스로 래스터화(PNG 변환)할 때 쓴다. */
export function svgDataUri(svg: string) {
  return `data:image/svg+xml;base64,${base64Utf8(svg)}`;
}

/* ------------------------------------------------------------ 파일 이름 규칙 */

function baseNameOf(inputName: string) {
  return inputName.replace(/\.[^.]*$/, "") || "serpent";
}

function stampOf(now: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/** 파일 시스템에 안전하지 않은 문자(경로 구분자 등)를 밑줄로 바꾼다. */
function sanitizeForFileName(text: string) {
  return text.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "case";
}

const FILE_SUFFIX: Record<Locale, { geometry: string; spectrum: string }> = {
  ko: { geometry: "형상", spectrum: "스펙트럼" },
  en: { geometry: "geometry", spectrum: "spectrum" },
};

/** 형상 스냅샷 PNG 파일 이름. 마크다운의 이미지 참조와 실제 다운로드 파일이 반드시 같아야 한다. */
export function geometryImageFileName(inputName: string, now = new Date(), locale: Locale = "ko") {
  return `${baseNameOf(inputName)}_${FILE_SUFFIX[locale].geometry}_${stampOf(now)}.png`;
}

/**
 * 스펙트럼 PNG 파일 이름. 케이스가 하나뿐이면 라벨을 넣지 않아 이름을 짧게 유지하고,
 * 여러 개면 라벨을 붙여 어떤 결과문의 그림인지 파일 이름만 보고 구분할 수 있게 한다.
 */
export function spectrumImageFileName(
  inputName: string,
  caseLabel: string,
  multi: boolean,
  now = new Date(),
  locale: Locale = "ko",
) {
  const suffix = multi ? `_${sanitizeForFileName(caseLabel)}` : "";
  return `${baseNameOf(inputName)}_${FILE_SUFFIX[locale].spectrum}${suffix}_${stampOf(now)}.png`;
}

function caseSection(
  item: ResultCase,
  index: number,
  total: number,
  isReference: boolean,
  spectrumImageFile: string | null,
  locale: Locale,
) {
  const t = STRINGS[locale];
  const out: string[] = [];
  const heading = total > 1
    ? `${t.caseHeading(index + 1)} ${item.label}${isReference ? `  ${t.referenceTag}` : ""}`
    : t.singleCaseHeading;
  out.push(heading, "");

  if (item.error) {
    out.push(t.parseFailed(tError(item.error, locale)), "");
    return out;
  }

  const metrics: string[][] = [];
  if (item.keff) {
    metrics.push([`k_eff (${item.keffEstimator || "—"})`, withError(item.keff.value, item.keff.abs, 6)]);
  }
  if (item.rho) metrics.push([t.rhoLabel, `${withError(item.rho.value, item.rho.abs, 1)} pcm`]);
  if (item.betaEff !== undefined) metrics.push(["β_eff", num(item.betaEff, 5)]);
  if (item.lambdaEff) metrics.push(["λ_eff", `${num(item.lambdaEff.value, 5)} s⁻¹`]);
  if (item.genTime !== undefined) {
    metrics.push([t.genTimeLabel(item.genTimeEstimator), `${num(item.genTime, 4)} s`]);
  }
  if (item.dollars !== undefined) metrics.push([t.dollarsLabel, `${num(item.dollars, 4)} $`]);
  if (metrics.length) out.push(table(t.metricCols, metrics), "");

  const conditions: string[][] = [];
  if (item.pop) conditions.push([t.popLabel, item.pop.toLocaleString("en-US")]);
  if (item.cycles) conditions.push([t.cyclesLabel, String(item.cycles)]);
  if (item.skip !== undefined) conditions.push([t.skipLabel, String(item.skip)]);
  if (item.activeCycles) conditions.push([t.activeLabel, String(item.activeCycles)]);
  if (item.power) conditions.push([t.powerLabel, `${num(item.power, 4)} W`]);
  if (item.runningTime) conditions.push([t.runTimeLabel, `${num(item.runningTime, 3)} min`]);
  if (conditions.length) {
    out.push(t.runConditionsHeading, "", table(t.metricCols, conditions), "");
  }

  if (item.physics.length) {
    out.push(t.physicsHeading, "", table(
      t.metricCols,
      item.physics.map((row) => [tPhysicsLabel(row.label, locale), row.value]),
    ), "");
  }

  if (item.delayedGroups.length) {
    out.push(t.delayedHeading(item.delayedSource), "", table(
      t.groupCols,
      item.delayedGroups.map((group) => [
        String(group.group),
        num(group.betaEff.value, 5),
        `${(group.share * 100).toFixed(2)} %`,
        num(group.lambda.value, 5),
      ]),
    ), "");
  }

  out.push(t.healthHeading(tStatus(item.worstStatus, locale)), "", table(
    t.checkCols,
    item.checks.map((check) => {
      const translated = tCheck(check, locale);
      return [translated.label, translated.status, translated.detail];
    }),
  ), "");

  if (item.spectrum.length) {
    const low = Math.min(...item.spectrum.map((bin) => bin.low));
    const high = Math.max(...item.spectrum.map((bin) => bin.high));
    out.push(t.spectrumSummary(item.spectrum.length, num(low * 1e6, 4), num(high * 1e6, 4)), "");
    if (spectrumImageFile) {
      out.push(
        `![${escapeXml(t.spectrumCaption(item.label))}](${spectrumImageFile})`,
        "",
        t.companionNote(spectrumImageFile),
        "",
      );
    }
  }

  return out;
}

export type SummaryImagePlan = {
  /** 형상 스냅샷 PNG 파일 이름. 캡처된 적이 없으면 null. */
  geometry: string | null;
  /** 스펙트럼을 그릴 수 있었던 케이스마다 하나씩. */
  spectra: { caseId: string; label: string; fileName: string }[];
};

export type SummaryRenderResult = {
  markdown: string;
  /**
   * 마크다운 본문이 참조하는 PNG 파일 목록. 이미지는 마크다운 안에 박아 넣지 않고
   * 별도 파일로 받으므로, 실제로 그 파일들을 만들어 내려받는 쪽(app/page.tsx)이
   * 마크다운과 정확히 같은 이름을 쓰도록 여기서 이름까지 함께 돌려준다.
   */
  images: SummaryImagePlan;
};

export function renderSummaryMarkdown(sources: SummarySources): SummaryRenderResult {
  const {
    meta, inputName, inputText, inputFile, cards, cases, referenceId, resultFiles,
    now = new Date(),
  } = sources;
  const locale = meta.locale ?? "ko";
  const t = STRINGS[locale];

  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  const spectrumImages: SummaryImagePlan["spectra"] = [];

  const title = meta.title.trim() || inputName || t.titleFallback;
  push(`# ${title}`, "");
  push(t.generatedBy(formatStamp(now)), t.disclaimer, "");

  /* ---------------------------------------------------------- 1. 개요 */
  push(t.overviewHeading, "");
  const overview: string[][] = [
    [t.analyst, orDash(meta.analyst)],
    [t.inputFile, `\`${inputName}\``],
    [t.calcType, detectCalculationTypes(cards, locale).join(", ")],
  ];
  const version = cases.find((item) => item.version)?.version;
  if (version) overview.push([t.serpentVersion, version]);
  const libraries = detectLibraries(cards, locale);
  overview.push([t.library, libraries.length ? libraries.join("<br>") : t.libraryMissing]);
  overview.push([t.resultFiles, cases.length ? t.resultFilesCount(cases.length) : t.resultFilesNone]);
  push(table([t.itemCol, t.valueCol], overview), "");

  if (meta.notes.trim()) {
    push(t.notes, "", meta.notes.trim(), "");
  }

  /* ------------------------------------------------------ 2. 재현 정보 */
  push(t.reproHeading, "");

  push(t.locationHeading, "");
  if (meta.location.trim()) {
    push("```", meta.location.trim(), "```", "");
  } else {
    push(...t.locationMissing, "");
  }

  const files: SummaryFile[] = [];
  if (inputFile) files.push(describeFile(inputFile, t.roleInput));
  else {
    files.push({
      name: inputName,
      dir: "",
      role: t.roleInputUnsaved,
      size: bytesOf(inputText),
      modified: "—",
      checksum: checksum(inputText),
    });
  }
  for (const file of resultFiles) {
    const owner = cases.find((item) => item.fileName === file.name);
    files.push(describeFile(file, owner && cases.length > 1 ? t.roleResultFor(owner.label) : t.roleResult));
  }

  push(t.fileListHeading, "");
  push(table(
    t.fileCols,
    files.map((file) => [
      `\`${file.name}\``,
      file.role,
      file.dir ? `\`${file.dir}\`` : "—",
      file.modified,
      file.size.toLocaleString("en-US"),
      `\`${file.checksum}\``,
    ]),
  ), "");
  push(...t.checksumNote, "");

  const geometry = summarizeGeometry(cards, locale);
  if (geometry.length) {
    push(t.geometrySizeHeading, "");
    push(table([t.itemCol, t.countCol], geometry.map((row) => [row.label, String(row.value)])), "");
  }

  let geometryImageFile: string | null = null;
  if (meta.includeImages) {
    push(t.snapshotHeading, "");
    if (sources.geometryImage) {
      const img = sources.geometryImage;
      geometryImageFile = geometryImageFileName(inputName, now, locale);
      push(
        `![${escapeXml(t.snapshotCaption(img.basis))}](${geometryImageFile})`,
        "",
        t.snapshotNote(img.basis, img.width, img.height),
        t.companionNote(geometryImageFile),
        "",
      );
    } else {
      push(t.snapshotMissing, "");
    }
  }

  /* --------------------------------------------------------- 3. 결과 */
  push(t.resultsHeading, "");
  if (!cases.length) {
    push(t.resultsNone, "");
  } else {
    const reference = cases.find((item) => item.id === referenceId) ?? cases[0];
    const multiCase = cases.length > 1;
    cases.forEach((item, index) => {
      // renderSpectrumSvg 로 실제 그려지는지 먼저 확인한다 — 데이터가 부족해 그릴 수
      // 없는 케이스까지 "파일을 같이 두라"고 안내하면 존재하지 않는 파일을 찾게 만든다.
      const spectrumImageFile = meta.includeImages && renderSpectrumSvg(item.spectrum)
        ? spectrumImageFileName(inputName, item.label, multiCase, now, locale)
        : null;
      if (spectrumImageFile) spectrumImages.push({ caseId: item.id, label: item.label, fileName: spectrumImageFile });
      push(...caseSection(item, index, cases.length, item.id === reference.id, spectrumImageFile, locale));
    });

    if (cases.length > 1) {
      push(t.comparisonHeading(cases.length + 1), "");
      const rows = buildWorthTable(cases, reference.id).map((row) => [
        row.isReference ? `${row.case.label} ${t.referenceTag}` : row.case.label,
        row.case.keff ? withError(row.case.keff.value, row.case.keff.abs, 6) : "—",
        row.case.rho ? `${num(row.case.rho.value, 1)} pcm` : "—",
        row.isReference
          ? "—"
          : row.deltaRho !== undefined
            ? `${num(row.deltaRho, 1)} ± ${num(row.sigma ?? 0, 1)} pcm`
            : "—",
        row.isReference ? "—" : row.dollars !== undefined ? `${num(row.dollars, 4)} $` : "—",
      ]);
      push(table(t.worthCols, rows), "");
      push(...t.worthNote(reference.label), "");
    }
  }

  /* ----------------------------------------------------- 4. 입력문 전문 */
  push(t.inputHeading, "");
  push(t.inputFileLine(inputName, inputText.split("\n").length, bytesOf(inputText).toLocaleString("en-US")), "");
  const fence = fenceFor(inputText);
  push(fence, inputText.replace(/\s+$/, ""), fence, "");

  const markdown = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return { markdown, images: { geometry: geometryImageFile, spectra: spectrumImages } };
}

/** 내보낼 파일 이름. 입력문 이름을 따르되 확장자만 바꾼다. */
export function summaryFileName(inputName: string, now = new Date(), locale: Locale = "ko") {
  const suffix = locale === "en" ? "summary" : "정리";
  return `${baseNameOf(inputName)}_${suffix}_${stampOf(now)}.md`;
}
