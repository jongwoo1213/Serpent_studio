/**
 * Serpent 2 결과 파일(_res.m) 파서와 노심계산 주요 지표 정리.
 *
 * res.m 은 MATLAB/Octave 스크립트 형식이라 한 줄이 하나의 변수 대입문이다.
 *
 *   IMP_KEFF (idx, [1:   2]) = [  1.04704E+00 7.0E-05 ];
 *   POP      (idx, 1)        = 1000000 ;
 *   VERSION  (idx, [1: 14])  = 'Serpent 2.1.29' ;
 *
 * 통계량은 [값, 상대오차] 쌍으로 저장된다. 두 번째 숫자가 절대오차라고
 * 착각하기 쉬운데 실제로는 상대 표준편차이므로 반드시 값과 곱해야 한다.
 */

export type ResultEntry = {
  name: string;
  numbers: number[];
  text?: string;
};

export type Stat = {
  value: number;
  /** 상대 표준편차 (res.m 원문 그대로). */
  rel: number;
  /** 절대 표준편차 = |값| × 상대오차. */
  abs: number;
};

export type HealthCheck = {
  label: string;
  status: "ok" | "warn" | "bad";
  detail: string;
};

export type SpectrumBin = {
  /** 에너지 구간 하한/상한 (MeV). */
  low: number;
  high: number;
  /** 단위 렙서지당 중성자속. */
  perLethargy: number;
};

export type ResultCase = {
  id: string;
  /** 화면에 쓸 짧은 이름. */
  label: string;
  fileName: string;
  entries: Map<string, ResultEntry>;

  version: string;
  inputName: string;
  completeDate: string;

  // 실행 조건
  pop?: number;
  cycles?: number;
  skip?: number;
  activeCycles?: number;
  runningTime?: number;
  power?: number;

  // 1티어 — 반응도
  keff?: Stat;
  keffEstimator: string;
  /** 반응도 (pcm). */
  rho?: Stat;
  betaEff?: number;
  /** 반응도 ($). */
  dollars?: number;
  /** 중성자 세대시간 (s). */
  genTime?: number;
  genTimeEstimator: string;

  // 2티어 — 건전성
  checks: HealthCheck[];
  worstStatus: "ok" | "warn" | "bad";

  // 3티어 — 물리 특성
  physics: { label: string; value: string; hint: string }[];

  spectrum: SpectrumBin[];
  /** 파싱 자체가 실패한 경우의 사유. */
  error?: string;
};

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** res.m 한 줄을 변수 이름과 값으로 분해한다. */
function parseLine(line: string): ResultEntry | null {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*idx\s*,[^)]*\)\s*=\s*(.*?);?\s*$/.exec(line);
  if (!match) return null;
  const [, name, rawValue] = match;

  const quoted = /^'([^']*)'/.exec(rawValue);
  if (quoted) return { name, numbers: [], text: quoted[1] };

  const numbers = (rawValue.match(NUMBER) ?? []).map(Number).filter((value) => Number.isFinite(value));
  if (!numbers.length) return null;
  return { name, numbers };
}

/**
 * res.m 전체를 읽어 변수 표를 만든다.
 *
 * 연소 계산은 같은 변수가 스텝마다 반복되는데, 여기서는 마지막(가장 최근)
 * 스텝만 남긴다. 현재 대상인 단일 임계도 계산에서는 차이가 없다.
 */
export function parseResultFile(text: string): Map<string, ResultEntry> {
  const entries = new Map<string, ResultEntry>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("idx")) continue;
    const entry = parseLine(line);
    if (entry) entries.set(entry.name, entry);
  }
  return entries;
}

function scalar(entries: Map<string, ResultEntry>, name: string): number | undefined {
  const entry = entries.get(name);
  return entry?.numbers.length ? entry.numbers[0] : undefined;
}

function text(entries: Map<string, ResultEntry>, name: string): string {
  return entries.get(name)?.text ?? "";
}

/** [값, 상대오차] 쌍을 읽어 절대오차까지 채운다. */
function stat(entries: Map<string, ResultEntry>, name: string, offset = 0): Stat | undefined {
  const numbers = entries.get(name)?.numbers;
  if (!numbers || numbers.length < offset + 2) return undefined;
  const value = numbers[offset];
  const rel = numbers[offset + 1];
  if (!Number.isFinite(value) || !Number.isFinite(rel)) return undefined;
  return { value, rel, abs: Math.abs(value) * rel };
}

/** 여러 후보 중 처음 존재하는 값을 고르고, 어떤 걸 썼는지 함께 돌려준다. */
function pick<T>(names: string[], read: (name: string) => T | undefined): { value?: T; source: string } {
  for (const name of names) {
    const value = read(name);
    if (value !== undefined) return { value, source: name };
  }
  return { source: "" };
}

/** k → 반응도(pcm). σ_ρ = σ_k / k² 로 전파한다. */
function toRho(keff: Stat): Stat {
  const value = ((keff.value - 1) / keff.value) * 1e5;
  const abs = (keff.abs / (keff.value * keff.value)) * 1e5;
  return { value, rel: Math.abs(value) > 0 ? abs / Math.abs(value) : 0, abs };
}

function fmt(value: number, digits = 5) {
  if (!Number.isFinite(value)) return "—";
  if (value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3)) return value.toExponential(3);
  return value.toFixed(digits);
}

/** 세 추정기가 통계오차 범위 안에서 서로 일치하는지 본다. */
function estimatorCheck(entries: Map<string, ResultEntry>): HealthCheck | null {
  const candidates = [
    { name: "ANA_KEFF", stat: stat(entries, "ANA_KEFF") },
    { name: "IMP_KEFF", stat: stat(entries, "IMP_KEFF") },
    { name: "COL_KEFF", stat: stat(entries, "COL_KEFF") },
  ].filter((item): item is { name: string; stat: Stat } => Boolean(item.stat));

  if (candidates.length < 2) return null;

  let worstSigma = 0;
  let worstPair = "";
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      const combined = Math.hypot(a.stat.abs, b.stat.abs);
      if (!combined) continue;
      const sigmas = Math.abs(a.stat.value - b.stat.value) / combined;
      if (sigmas > worstSigma) {
        worstSigma = sigmas;
        worstPair = `${a.name}↔${b.name}`;
      }
    }
  }

  const detail = `최대 편차 ${worstSigma.toFixed(1)}σ (${worstPair})`;
  return {
    label: "추정기 일치",
    status: worstSigma > 3 ? "bad" : worstSigma > 2 ? "warn" : "ok",
    detail,
  };
}

function buildChecks(entries: Map<string, ResultEntry>, keff?: Stat): HealthCheck[] {
  const checks: HealthCheck[] = [];

  const completed = scalar(entries, "SIMULATION_COMPLETED");
  if (completed !== undefined) {
    checks.push({
      label: "계산 완료",
      status: completed === 1 ? "ok" : "bad",
      detail: completed === 1 ? "정상 종료" : "중간에 종료됨 — 결과 사용 불가",
    });
  }

  const lost = scalar(entries, "LOST_PARTICLES");
  if (lost !== undefined) {
    checks.push({
      label: "입자 손실",
      status: lost === 0 ? "ok" : "bad",
      detail: lost === 0 ? "0개" : `${lost}개 — 기하 정의에 빈틈이 있습니다`,
    });
  }

  const balance = entries.get("BALA_NEUTRON_DIFF")?.numbers;
  if (balance?.length) {
    const worst = Math.max(...balance.map(Math.abs));
    checks.push({
      label: "중성자 균형",
      status: worst < 1 ? "ok" : "warn",
      detail: `잔차 ${fmt(worst, 2)}`,
    });
  }

  if (keff) {
    // 드럼가 연구에서는 두 케이스 차이를 보므로 오차가 √2배로 커진다.
    // 문헌의 허용 기준(100 pcm)을 고려해 50 pcm 을 양호 기준으로 둔다.
    const pcm = keff.abs * 1e5;
    checks.push({
      label: "통계 정밀도",
      status: pcm < 50 ? "ok" : pcm < 100 ? "warn" : "bad",
      detail: `σ(k) = ${pcm.toFixed(1)} pcm · 두 케이스 차이 기준 ±${(pcm * Math.SQRT2).toFixed(1)} pcm`,
    });
  }

  const consistency = estimatorCheck(entries);
  if (consistency) checks.push(consistency);

  return checks;
}

function buildPhysics(entries: Map<string, ResultEntry>) {
  const rows: { label: string; value: string; hint: string }[] = [];

  const add = (label: string, value: string | undefined, hint: string) => {
    if (value) rows.push({ label, value, hint });
  };

  const leakRate = stat(entries, "TOT_LEAKRATE");
  const srcRate = stat(entries, "TOT_SRCRATE");
  if (leakRate && srcRate && srcRate.value) {
    add("누설률", `${((leakRate.value / srcRate.value) * 100).toFixed(3)} %`, "전체 중성자 생성 대비 체계 밖으로 빠져나간 비율");
  }

  const ealf = stat(entries, "ANA_EALF");
  if (ealf) add("EALF", `${fmt(ealf.value, 4)} MeV`, "핵분열을 일으킨 중성자의 평균 렙서지 대응 에너지 — 스펙트럼 경연도 지표");

  const afge = stat(entries, "ANA_AFGE");
  if (afge) add("평균 분열 에너지", `${fmt(afge.value, 4)} MeV`, "핵분열을 유발한 중성자의 평균 에너지");

  const thermFrac = stat(entries, "ANA_THERM_FRAC");
  if (thermFrac) add("열중성자 비율", `${(thermFrac.value * 100).toFixed(2)} %`, "열영역에서 일어난 반응의 비중");

  const conversion = stat(entries, "CONVERSION_RATIO");
  if (conversion) add("전환비", fmt(conversion.value, 4), "핵분열성 물질 소모 대비 생성 비율");

  const u235 = stat(entries, "U235_FISS", 2);
  const u238 = stat(entries, "U238_FISS", 2);
  if (u235 && u238) {
    add("분열 분담", `U235 ${(u235.value * 100).toFixed(1)}% / U238 ${(u238.value * 100).toFixed(1)}%`, "핵종별 분열 기여도");
  }

  const nubar = stat(entries, "NUBAR");
  if (nubar) add("ν̄", fmt(nubar.value, 4), "분열당 방출 중성자 수");

  const fisse = stat(entries, "FISSE");
  if (fisse) add("분열당 에너지", `${fmt(fisse.value, 2)} MeV`, "핵분열 1회당 발생 에너지");

  const kinf = stat(entries, "INF_KINF");
  if (kinf) add("k∞", fmt(kinf.value, 5), "무한체계 증배계수 (누설 무시)");

  const fmass = scalar(entries, "TOT_FMASS");
  if (fmass !== undefined) add("핵연료 질량", `${fmt(fmass, 1)} g`, "체계 내 중핵종 총 질량");

  const powdens = stat(entries, "TOT_POWDENS");
  if (powdens) add("출력밀도", `${fmt(powdens.value, 5)} kW/g`, "핵연료 질량당 출력");

  return rows;
}

/** 70군 중성자속을 단위 렙서지당 값으로 환산한다. 스펙트럼 그림용. */
function buildSpectrum(entries: Map<string, ResultEntry>): SpectrumBin[] {
  const flux = entries.get("INF_MICRO_FLX")?.numbers;
  const grid = entries.get("MICRO_E")?.numbers;
  if (!flux || !grid || grid.length < 2) return [];

  const groups = grid.length - 1;
  if (flux.length < groups * 2) return [];

  const bins: SpectrumBin[] = [];
  for (let g = 0; g < groups; g += 1) {
    // MICRO_E 는 오름차순, INF_MICRO_FLX 도 같은 순서로 [값, 오차] 쌍이다.
    const low = grid[g];
    const high = grid[g + 1];
    const value = flux[g * 2];
    if (!(low > 0) || !(high > low) || !Number.isFinite(value)) continue;
    bins.push({ low, high, perLethargy: value / Math.log(high / low) });
  }
  return bins.some((bin) => bin.perLethargy > 0) ? bins : [];
}

/** 파일 이름에서 케이스를 구분할 만한 짧은 라벨을 뽑는다. */
function shortLabel(inputName: string, fileName: string) {
  const base = (inputName || fileName).replace(/_res\.m$/i, "").replace(/\.m$/i, "");
  // 캠페인 파일명은 접두사가 길게 겹치므로 뒤쪽 식별 구간이 더 유용하다.
  const parts = base.split("_");
  return parts.length > 5 ? parts.slice(-6).join("_") : base;
}

export function buildResultCase(fileName: string, text_: string, id: string): ResultCase {
  const entries = parseResultFile(text_);

  const base: ResultCase = {
    id,
    label: fileName,
    fileName,
    entries,
    version: "",
    inputName: "",
    completeDate: "",
    keffEstimator: "",
    genTimeEstimator: "",
    checks: [],
    worstStatus: "ok",
    physics: [],
    spectrum: [],
  };

  if (!entries.size) {
    return { ...base, error: "Serpent 결과 형식(_res.m)으로 읽을 수 없습니다." };
  }

  const inputName = text(entries, "INPUT_FILE_NAME");

  // keff 는 통계 품질이 가장 좋은 implicit 추정기를 우선 사용한다.
  const keffPick = pick(["IMP_KEFF", "ABS_KEFF", "COL_KEFF", "ANA_KEFF"], (name) => stat(entries, name));
  const keff = keffPick.value;

  // β_eff 는 Meulekamp 값을 기본으로, 없으면 ANA_KEFF 의 즉발 성분에서 되짚는다.
  let betaEff = scalar(entries, "BETA_EFF") ?? scalar(entries, "ADJ_MEULEKAMP_BETA_EFF") ?? scalar(entries, "ADJ_PERT_BETA_EFF");
  if (betaEff === undefined) {
    const ana = entries.get("ANA_KEFF")?.numbers;
    if (ana && ana.length >= 4 && ana[0]) betaEff = 1 - ana[2] / ana[0];
  }

  const genTimePick = pick(
    ["ADJ_PERT_GEN_TIME", "ADJ_NAUCHI_GEN_TIME", "ADJ_IFP_GEN_TIME"],
    (name) => scalar(entries, name),
  );

  const rho = keff ? toRho(keff) : undefined;
  const checks = buildChecks(entries, keff);
  const worstStatus: "ok" | "warn" | "bad" = checks.some((check) => check.status === "bad")
    ? "bad"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "ok";

  const cycles = scalar(entries, "CYCLES");
  const skip = scalar(entries, "SKIP");

  return {
    ...base,
    label: shortLabel(inputName, fileName),
    version: text(entries, "VERSION"),
    inputName,
    completeDate: text(entries, "COMPLETE_DATE"),

    pop: scalar(entries, "POP"),
    cycles,
    skip,
    activeCycles: cycles !== undefined && skip !== undefined ? cycles - skip : undefined,
    runningTime: scalar(entries, "RUNNING_TIME"),
    power: stat(entries, "TOT_POWER")?.value,

    keff,
    keffEstimator: keffPick.source,
    rho,
    betaEff,
    dollars: rho && betaEff ? rho.value / 1e5 / betaEff : undefined,
    genTime: genTimePick.value,
    genTimeEstimator: genTimePick.source,

    checks,
    worstStatus,
    physics: buildPhysics(entries),
    spectrum: buildSpectrum(entries),
  };
}

export type WorthRow = {
  case: ResultCase;
  isReference: boolean;
  /** 기준 케이스 대비 반응도 차이 (pcm). 삽입이면 음수. */
  deltaRho?: number;
  /** Δρ 의 1σ (pcm). 두 케이스 오차를 제곱합으로 전파. */
  sigma?: number;
  /** Δρ 를 달러로 환산한 값. */
  dollars?: number;
};

/**
 * 기준 케이스 대비 반응도가를 계산한다.
 *
 * 제어드럼 연구에서 최종 산출물은 개별 keff 가 아니라 기준 배치 대비 Δρ 이고,
 * 두 계산이 독립이므로 오차는 √(σ₁²+σ₂²) 로 커진다.
 */
export function buildWorthTable(cases: ResultCase[], referenceId: string): WorthRow[] {
  const reference = cases.find((item) => item.id === referenceId) ?? cases[0];
  return cases.map((item) => {
    if (!reference || !item.rho || !reference.rho) {
      return { case: item, isReference: item.id === reference?.id };
    }
    const deltaRho = item.rho.value - reference.rho.value;
    const sigma = Math.hypot(item.rho.abs, reference.rho.abs);
    return {
      case: item,
      isReference: item.id === reference.id,
      deltaRho,
      sigma,
      dollars: item.betaEff ? deltaRho / 1e5 / item.betaEff : undefined,
    };
  });
}

export { fmt as formatNumber };
