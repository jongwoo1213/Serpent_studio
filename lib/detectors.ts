/**
 * Serpent 2 검출기(det) 출력 파일(`[input]_det[idx].m`) 파서.
 *
 * `_res.m`과 달리 검출기 결과는 완전히 별도의 파일에 저장된다 (VTT 문서
 * "2.3.4. Detector output" 기준). 형식도 다르다 — res.m 은 한 줄짜리
 * `NAME (idx, [1:N]) = [ ... ];` 대입이지만, det 파일은 여러 줄짜리 행렬
 * `DET[NAME] = [ 행1; 행2; ... ];` 이다. 결과 테이블 열 순서는
 *   idx  EBI  UBI  CBI  MBI  LBI  RBI  XBI  YBI  ZBI  MEAN  ERR
 * (시간 구간이 있으면 idx 뒤에 TBI 가 하나 더 끼어 13열이 된다) 이고,
 * 에너지 구간 경계는 별도 테이블 `DET[NAME]E = [ EMIN EMAX EMID; ... ];` 에 있다.
 *
 * 주의: 이 파서는 VTT 공식 문서에 적힌 열 순서만으로 작성했고, 실제로
 * Serpent 가 만든 det 파일로 검증하지는 못했다 — Serpent 는 유료 라이선스가
 * 있어야 실행되는 코드라 이 저장소에 진짜 예시가 없다. 그래서 형식이 조금이라도
 * 다르면 (에너지 말고 다른 구간도 함께 바뀌는 검출기 등) 조용히 건너뛰도록
 * 보수적으로 짰다 — 틀리게 그리느니 안 그리는 쪽을 택한다.
 */

export type DetectorEnergyBin = {
  low: number;
  high: number;
  mid: number;
  /** 이 구간의 적분(그룹 전체) 값. res.m 의 INF_MICRO_FLX 와 같은 성격이다. */
  mean: number;
  /** 상대 표준편차. */
  rel: number;
};

export type Detector = {
  name: string;
  bins: DetectorEnergyBin[];
};

/** `VAR = [ ... ];` 형태의 MATLAB 대입문을 이름별로 모은다. 줄바꿈·세미콜론
 * 위치에 기대지 않고 대괄호 안의 숫자만 뽑아 쓰므로 사소한 서식 차이에 강하다. */
function extractMatrices(text: string): Map<string, number[]> {
  const matrices = new Map<string, number[]>();
  // 여러 줄에 걸친 대입도 잡아야 하므로 [\s\S] 로 개행까지 포함해 매칭한다.
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\[([\s\S]*?)\]\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const [, name, body] = match;
    // % 주석을 지우고 숫자만 남긴다. NaN/Inf 등은 실제로 안 나오므로 걱정하지 않는다.
    const cleaned = body.replace(/%[^\n]*/g, "");
    const numbers = (cleaned.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
    if (numbers.length) matrices.set(name, numbers);
  }
  return matrices;
}

/** 이 파일이 정말 det 출력인지 — 내용 기반 판별에 쓴다. */
export function looksLikeDetectorFile(text: string) {
  return /\bDET[A-Za-z_][A-Za-z0-9_]*\s*=\s*\[/.test(text);
}

/**
 * det 파일에서 "에너지만 바뀌는" 검출기, 즉 순수 스펙트럼 검출기만 뽑아낸다.
 *
 * 공간·물질·반응 등 다른 구간까지 함께 있는 검출기(예: 격자별 출력분포)는
 * 이 함수가 다루는 범위 밖이다 — 행 개수가 에너지 구간 개수와 안 맞으면
 * 여러 구간이 섞여 있다는 뜻이므로 조용히 건너뛴다.
 */
export function parseDetectorFile(text: string): Detector[] {
  const matrices = extractMatrices(text);
  const detectors: Detector[] = [];

  for (const [varName, values] of matrices) {
    if (!varName.startsWith("DET")) continue;
    if (varName.endsWith("E") && matrices.has(varName.slice(0, -1))) continue; // 에너지 경계 테이블 자신은 건너뛴다
    // T/X/Y/Z/R/PHI/THETA/COORD 로 끝나는 보조 경계 테이블도 결과 테이블이 아니다.
    if (/(T|X|Y|Z|R|PHI|THETA|COORD)$/.test(varName) && matrices.has(varName.replace(/(T|X|Y|Z|R|PHI|THETA|COORD)$/, ""))) {
      continue;
    }

    const energyKey = `${varName}E`;
    const energy = matrices.get(energyKey);
    if (!energy || energy.length % 3 !== 0) continue; // 에너지 구간 정보가 없으면 스펙트럼으로 그릴 수 없다

    const groups = energy.length / 3;
    // 시간 구간이 있으면 13열, 없으면 12열이다 — 행 개수로 역산한다.
    const cols12 = values.length / 12;
    const cols13 = values.length / 13;
    let stride: number | null = null;
    if (Number.isInteger(cols12) && cols12 === groups) stride = 12;
    else if (Number.isInteger(cols13) && cols13 === groups) stride = 13;
    if (!stride) continue; // 에너지 말고 다른 구간도 섞여 있어 단순 스펙트럼이 아니다

    const meanCol = stride - 2;
    const errCol = stride - 1;
    const bins: DetectorEnergyBin[] = [];
    for (let g = 0; g < groups; g += 1) {
      const [low, high, mid] = [energy[g * 3], energy[g * 3 + 1], energy[g * 3 + 2]];
      const mean = values[g * stride + meanCol];
      const rel = values[g * stride + errCol];
      if (!(low > 0) || !(high > low) || !Number.isFinite(mean)) continue;
      bins.push({ low, high, mid, mean, rel });
    }
    if (bins.length) detectors.push({ name: varName.slice(3), bins });
  }

  return detectors;
}

/**
 * 검출기 스펙트럼을 결과 화면의 스펙트럼 그래프가 쓰는 모양(단위 렙서지당 값)으로 바꾼다.
 * lib/results.ts 의 buildSpectrum 과 같은 공식(적분값 ÷ ln(상한/하한))을 쓴다.
 */
export function detectorToSpectrumBins(detector: Detector) {
  return detector.bins.map((bin) => ({
    low: bin.low,
    high: bin.high,
    perLethargy: bin.mean / Math.log(bin.high / bin.low),
  }));
}

/** `foo_det0.m`, `foo_det12b3.m` 등에서 접미사를 뗀 기본 이름. 결과문과 짝짓는 데 쓴다. */
export function detectorBaseName(fileName: string) {
  return fileName.replace(/_det\d+(b\d+)?\.m$/i, "");
}

export function isDetectorFileName(fileName: string) {
  return /_det\d+(b\d+)?\.m$/i.test(fileName);
}
