"use client";

import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CardKind,
  classifyPoint,
  describeNuclide,
  diagnoseGeometry,
  GeometryModel,
  getCardData,
  geometryPlotBounds,
  hasOutsideCell,
  materialAtPoint,
  materialColor,
  parseSerpentInput,
  parseGeometryModel,
  parseNuclideId,
  PlotBasis,
  PointStatus,
  SAMPLE_INPUT,
  serializeCards,
  SerpentCard,
  updateCard,
  validateSerpentInput,
  VOID_COLOR,
} from "../lib/serpent";
import {
  buildResultCase,
  buildWorthTable,
  formatNumber,
  ResultCase,
} from "../lib/results";

const GROUPS = [
  { name: "모델 개요", icon: "▤", hint: "계산 사례를 식별하는 제목 카드" },
  { name: "형상 · 경계", icon: "◈", hint: "표면·셀·격자로 구성한 CSG 형상" },
  { name: "물질 · 핵데이터", icon: "●", hint: "물질 조성과 핵데이터 라이브러리" },
  { name: "계산 모드 · 조건", icon: "⚙", hint: "입자 수, 경계조건, 연소 등 계산 설정" },
  { name: "소스 · 검출기", icon: "◎", hint: "외부 소스 정의와 결과 집계 검출기" },
  { name: "시각화 · 출력", icon: "▦", hint: "형상 단면도와 출력 파일 옵션" },
  { name: "외부 파일 · 연동", icon: "⧉", hint: "include 및 외부 해석 코드 연동" },
  { name: "고급 카드", icon: "⋯", hint: "위 분류에 속하지 않는 나머지 카드" },
] as const;

const GEOMETRY_CARDS = new Set(["pin", "nest", "lat", "particle", "pbed", "trans", "transa", "transv", "div"]);
const MATERIAL_CARDS = new Set(["therm", "thermstoch", "mix"]);
const SOURCE_CARDS = new Set(["ene", "fun"]);
const OUTPUT_CARDS = new Set(["mesh", "mplot"]);
const COUPLING_CARDS = new Set(["ifc", "umsh"]);
const LIBRARY_OPTIONS = new Set(["acelib", "declib", "nfylib", "bralib", "sfylib", "pdatadir"]);
const OUTPUT_OPTIONS = new Set(["outp", "printm", "title"]);

type GroupName = (typeof GROUPS)[number]["name"];

function cardCategory(card: SerpentCard): GroupName {
  const data = getCardData(card);
  const keyword = card.keyword.toLowerCase();
  const option = data.name?.toLowerCase() ?? "";
  if (card.kind === "title") return "모델 개요";
  if (card.kind === "surface" || card.kind === "cell" || GEOMETRY_CARDS.has(keyword)) return "형상 · 경계";
  if (card.kind === "material" || MATERIAL_CARDS.has(keyword) || (card.kind === "setting" && LIBRARY_OPTIONS.has(option))) {
    return "물질 · 핵데이터";
  }
  if (card.kind === "source" || card.kind === "detector" || SOURCE_CARDS.has(keyword)) return "소스 · 검출기";
  if (card.kind === "plot" || OUTPUT_CARDS.has(keyword) || (card.kind === "setting" && OUTPUT_OPTIONS.has(option))) {
    return "시각화 · 출력";
  }
  if (card.kind === "include" || COUPLING_CARDS.has(keyword)) return "외부 파일 · 연동";
  if (card.kind === "setting" || ["dep", "branch", "coef", "hisv"].includes(keyword)) return "계산 모드 · 조건";
  return "고급 카드";
}

const CARD_TEMPLATES: Record<string, string> = {
  surface: "\n% --- New surface\nsurf new_surface cyl 0.0 0.0 1.0\n",
  cell: "\n% --- New cell\ncell new_cell 0 void -new_surface\n",
  material: "\n% --- New material\nmat new_material -1.0\n1001.09c 1.0\n",
  setting: "\nset pop 5000 100 20\n",
  detector: "\ndet new_detector de energy_grid\n",
  source: "\nsrc new_source sp 0 0 0\n",
  plot: "\ngplot 3 700 700\n",
};

function Icon({ children }: { children: string }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function fieldLabel(card: SerpentCard, key: string) {
  const labels: Record<string, string> = {
    name:
      card.kind === "surface" ? "표면 이름" :
      card.kind === "cell" ? "셀 이름" :
      card.kind === "material" ? "물질 이름" : "옵션",
    type: "표면 형식",
    values: card.kind === "surface" ? "파라미터" : "값",
    universe: "Universe",
    material: "물질 / Fill",
    region: "영역 표현식",
    density: "밀도",
    options: "물질 옵션",
    composition: "핵종 조성",
    comment: "설명",
  };
  return labels[key] ?? key;
}

/** 사이드바 항목에 표시할 이름과 한 줄 요약. */
function cardSummary(card: SerpentCard) {
  const data = getCardData(card);
  if (card.kind === "surface") {
    return { name: data.name || card.keyword, meta: `${data.type} ${data.values}`.trim() };
  }
  if (card.kind === "cell") {
    const scope = data.universe && data.universe !== "0" ? `u${data.universe} · ` : "";
    return { name: data.name || card.keyword, meta: `${scope}${data.material} ${data.region}`.trim() };
  }
  if (card.kind === "material") {
    const density = Number(data.density);
    const unit = Number.isFinite(density)
      ? density < 0 ? `${Math.abs(density)} g/cm³` : `${density} 1/(b·cm)`
      : data.density;
    const nuclides = (data.composition ?? "").split("\n").filter((line) => line.trim()).length;
    return { name: data.name || card.keyword, meta: `${unit} · 핵종 ${nuclides}` };
  }
  if (card.kind === "title") {
    return { name: data.values || "제목 없음", meta: "set title" };
  }
  if (card.kind === "setting") {
    return { name: `set ${data.name}`, meta: data.values || "—" };
  }
  return { name: card.label || card.keyword, meta: (data.values ?? "").trim() };
}

function formatKind(kind: CardKind) {
  return {
    surface: "SURFACE",
    cell: "CELL",
    material: "MATERIAL",
    setting: "SETTING",
    title: "TITLE",
    plot: "PLOT",
    source: "SOURCE",
    detector: "DETECTOR",
    include: "INCLUDE",
    other: "CARD",
  }[kind];
}

type CardGuide = {
  title: string;
  description: string;
  syntax: string;
  tips: string[];
  url: string;
};

const SYNTAX_MANUAL = "https://serpent.vtt.fi/docs/syntax/index.html";

function surfaceParameterHint(type: string) {
  return {
    px: "x₀ — x축에 수직인 평면의 위치",
    py: "y₀ — y축에 수직인 평면의 위치",
    pz: "z₀ — z축에 수직인 평면의 위치",
    cyl: "x₀  y₀  r — z축과 평행한 원통의 중심과 반지름",
    cylz: "x₀  y₀  r — z축과 평행한 원통의 중심과 반지름",
    sph: "x₀  y₀  z₀  r — 구의 중심과 반지름",
    sqc: "x₀  y₀  r [r₀] — 정사각 기둥의 중심, 반폭, 선택적 모서리 반경",
    pad: "x₀  y₀  r₁  r₂  α₁  α₂ — 원환 부채꼴의 중심, 내·외반경, 시작·끝 각도(°)",
    cuboid: "x₁  x₂  y₁  y₂  z₁  z₂ — 직육면체의 각 축 최소·최대 좌표",
    plane: "A  B  C  D — Ax + By + Cz = D 형태의 일반 평면",
  }[type.toLowerCase()] ?? "선택한 표면 형식에 맞는 좌표와 치수를 cm 단위로 입력합니다.";
}

function guideForCard(card: SerpentCard, data: Record<string, string>): CardGuide {
  const keyword = card.keyword.toLowerCase();
  const option = data.name?.toLowerCase() ?? "";

  if (card.kind === "surface") {
    return {
      title: "표면은 셀의 경계를 만듭니다",
      description: "표면 자체에는 물질이 없으며, 셀 카드가 표면의 양·음 방향을 조합해 실제 공간을 정의합니다.",
      syntax: "surf NAME TYPE PARAM₁ PARAM₂ …",
      tips: [surfaceParameterHint(data.type ?? ""), "표면 이름은 cell, det, 변환 카드에서 다시 참조할 수 있습니다."],
      url: "https://serpent.vtt.fi/docs/extra/csg_surfaces.html",
    };
  }
  if (card.kind === "cell") {
    return {
      title: "셀은 공간에 물질 또는 다른 유니버스를 배치합니다",
      description: "표면 번호의 부호와 Boolean 연산으로 닫힌 영역을 만들고, 그 영역을 물질·void·outside 또는 fill 유니버스로 채웁니다.",
      syntax: "cell NAME UNI MAT  SURF₁ SURF₂ …",
      tips: ["음수 표면은 음의 면(일반적으로 내부), 양수 표면은 양의 면을 선택합니다.", "공백은 교집합, 콜론(:)은 합집합, 괄호는 연산 그룹을 뜻합니다."],
      url: `${SYNTAX_MANUAL}#cell`,
    };
  }
  if (card.kind === "material") {
    return {
      title: "물질은 밀도와 핵종 조성을 정의합니다",
      description: "수송 중 입자의 국소 상호작용 확률은 물질의 밀도, 온도 및 핵종 조성으로 결정됩니다.",
      syntax: "mat NAME DENS [OPTION …]\nNUCLIDE FRACTION …",
      tips: [
        "음수 밀도는 g/cm³ 단위의 질량밀도, 양수는 원자밀도입니다.",
        "핵종 조성에서 원자 단위와 질량 단위를 섞지 마세요.",
        "핵종 이름은 ZAID.라이브러리 형식입니다. 예: 92235.09c → Z=92(우라늄) A=235 → U-235, '09c'는 라이브러리 ID 09 · 연속에너지 중성자 데이터를 뜻합니다.",
      ],
      url: `${SYNTAX_MANUAL}#mat`,
    };
  }
  if (card.kind === "title") {
    return {
      title: "계산 사례를 알아보기 쉬운 이름으로 지정합니다",
      description: "제목은 실행 중 출력과 표준 결과 파일에 기록됩니다. 생략하면 입력 파일명이 대신 사용됩니다.",
      syntax: 'set title "NAME"',
      tips: ["공백이나 특수문자가 포함된 제목은 따옴표로 감쌉니다."],
      url: `${SYNTAX_MANUAL}#set-title`,
    };
  }
  if (card.kind === "setting" && option === "pop") {
    return {
      title: "임계도 계산의 입자 수와 세대 수를 정합니다",
      description: "세대당 중성자 수, 활성 세대, 비활성 세대를 지정하며 이 카드가 있으면 임계도 소스 계산 모드가 선택됩니다.",
      syntax: "set pop NPG NGEN NSKIP [K₀ BTCH NCRIT]",
      tips: ["NPG는 세대당 중성자 수, NGEN은 활성 세대, NSKIP은 초기 비활성 세대입니다.", "외부 소스 계산용 set nps와 동시에 사용할 수 없습니다."],
      url: `${SYNTAX_MANUAL}#set-pop`,
    };
  }
  if (card.kind === "setting" && option === "nps") {
    return {
      title: "외부 소스 계산의 총 입자 이력 수를 정합니다",
      description: "총 입자 이력과 선택적 배치 수를 지정하며, 이 카드가 있으면 외부 소스 모드가 선택됩니다.",
      syntax: "set nps NP [BTCH TBI]",
      tips: ["NP는 전체 입자 이력 수입니다.", "임계도 계산용 set pop과 동시에 사용할 수 없습니다."],
      url: `${SYNTAX_MANUAL}#set-nps`,
    };
  }
  if (card.kind === "setting" && option === "bc") {
    return {
      title: "입자가 외부 경계를 통과할 때의 처리를 정합니다",
      description: "모든 방향에 하나의 조건을 적용하거나 x·y·z 방향별 조건을 지정할 수 있습니다.",
      syntax: "set bc MODE [ALB]  또는  set bc MODEₓ MODEᵧ MODE𝓏 [ALB]",
      tips: ["1 = 흡수(black), 2 = 반사(reflective), 3 = 주기(periodic) 경계입니다.", "반사·주기 조건은 반복 가능한 외곽 표면에서 사용해야 합니다."],
      url: `${SYNTAX_MANUAL}#set-bc`,
    };
  }
  if (card.kind === "setting" && LIBRARY_OPTIONS.has(option)) {
    return {
      title: "Serpent가 사용할 핵데이터 라이브러리 경로를 지정합니다",
      description: "단면적·붕괴·핵분열 수율 등 계산에 필요한 외부 데이터 파일을 연결하는 옵션입니다.",
      syntax: `set ${option} "LIB₁" ["LIB₂" …]`,
      tips: ["SERPENT_DATA 환경변수를 사용하지 않는 경우에는 절대 경로가 필요할 수 있습니다.", "배포된 웹 편집기는 파일 존재 여부까지 확인하지 않으므로 Serpent 실행 환경에서 다시 점검하세요."],
      url: `${SYNTAX_MANUAL}#set-${option}`,
    };
  }
  if (card.kind === "setting" && ["power", "powdens", "srcrate"].includes(option)) {
    return {
      title: "Monte Carlo 결과의 물리적 정규화 기준을 지정합니다",
      description: "모의 입자 이력으로 얻은 반응률을 실제 출력, 출력밀도 또는 소스율 기준의 물리량으로 변환합니다.",
      syntax: `set ${option} VALUE [MAT]`,
      tips: ["power는 W, powdens는 kW/g, srcrate는 particles/s 기준입니다.", "연소 계산에서는 구간별 정규화 조건이 결과에 직접 영향을 줍니다."],
      url: `${SYNTAX_MANUAL}#set-${option}`,
    };
  }
  if (card.kind === "source") {
    return {
      title: "외부 소스의 입자·공간·에너지 분포를 정의합니다",
      description: "점, 셀, 물질, 유니버스, 표면 또는 파일을 기준으로 시작 입자를 샘플링할 수 있습니다.",
      syntax: "src NAME [PART] [sp X Y Z] [sc CELL] [sm MAT] [se E] …",
      tips: ["sp는 점 위치, sc·sm·su는 셀·물질·유니버스 체적 소스입니다.", "체적 소스는 sx·sy·sz 또는 srad로 샘플링 범위를 좁히면 효율이 좋아집니다."],
      url: `${SYNTAX_MANUAL}#src`,
    };
  }
  if (card.kind === "detector") {
    return {
      title: "플럭스·반응률·전류 등의 확률론적 추정량을 계산합니다",
      description: "공간, 에너지, 시간 영역과 반응 응답을 조합해 필요한 결과를 별도로 집계합니다.",
      syntax: "det NAME [PART] [dc CELL] [dm MAT] [de EGRID] [dr MT RMAT] …",
      tips: ["dc·dm·du·dl은 집계할 공간 영역을 제한합니다.", "de는 에너지 격자, dr은 반응 응답을 연결합니다."],
      url: `${SYNTAX_MANUAL}#det`,
    };
  }
  if (card.kind === "plot") {
    return {
      title: "Serpent 실행 시 생성할 형상 단면도를 설정합니다",
      description: "plot은 단면 방향과 픽셀 크기를 지정하고, gplot은 파일명·강조·경계 등 더 세밀한 옵션을 제공합니다.",
      syntax: keyword === "plot" ? "plot TYPE NX NY [POS …]" : "gplot NAME plane TYPE … pix NX NY …",
      tips: ["plot 방향은 1 = YZ, 2 = XZ, 3 = XY입니다.", "현재 우측 미리보기는 이 카드와 별개로 입력문의 CSG를 즉시 계산합니다."],
      url: `${SYNTAX_MANUAL}#${keyword}`,
    };
  }
  if (card.kind === "include") {
    return {
      title: "다른 입력 파일을 현재 모델에 포함합니다",
      description: "큰 모델을 형상·물질·설정 파일로 나눠 관리할 때 사용합니다.",
      syntax: 'include "FILE"',
      tips: ["경로에 공백이나 특수문자가 있으면 따옴표로 감쌉니다.", "브라우저 미리보기는 로컬 include 파일을 자동으로 읽을 수 없으므로 내용을 직접 합쳐야 합니다."],
      url: `${SYNTAX_MANUAL}#include`,
    };
  }
  if (keyword === "pin") {
    return {
      title: "동심 원통층으로 핀 유니버스를 만듭니다",
      description: "재료와 외부 반지름을 안쪽부터 차례로 적어 연료봉 같은 반복 구조를 간단히 정의합니다.",
      syntax: "pin UNI  MAT₁ R₁  MAT₂ R₂ … MATₙ",
      tips: ["반지름은 cm 단위이며 바깥쪽으로 갈수록 증가해야 합니다.", "마지막 재료 영역은 바깥 방향으로 무한히 이어집니다."],
      url: `${SYNTAX_MANUAL}#pin`,
    };
  }
  if (keyword === "lat") {
    return {
      title: "반복되는 유니버스를 격자에 배치합니다",
      description: "격자 형식, 원점, 피치, 크기와 유니버스 배열을 이용해 반복 형상을 구성합니다.",
      syntax: "lat UNI TYPE X₀ Y₀ NX NY PITCH …",
      tips: ["격자 TYPE에 따라 필요한 좌표와 배열 형식이 달라집니다.", "배치되는 각 항목은 별도로 정의된 유니버스 이름입니다."],
      url: `${SYNTAX_MANUAL}#lat`,
    };
  }
  if (keyword === "ene") {
    return {
      title: "검출기 등에 사용할 에너지 군 구조를 정의합니다",
      description: "경계값 목록 또는 선형·로그 균등 구간으로 에너지 빈을 만듭니다.",
      syntax: "ene NAME TYPE E₁ E₂ …  또는  ene NAME TYPE N EMIN EMAX",
      tips: ["에너지 단위는 MeV입니다.", "TYPE 1은 경계 목록, TYPE 2·3은 선형·로그 균등 구간입니다."],
      url: `${SYNTAX_MANUAL}#ene`,
    };
  }
  if (keyword === "therm" || keyword === "thermstoch") {
    return {
      title: "결합 원자의 저에너지 중성자 산란 데이터를 연결합니다",
      description: "물질 카드의 moder 옵션에서 사용하는 열산란 이름과 S(α,β) 라이브러리를 연결합니다.",
      syntax: `${keyword} THNAME [T] LIB₁ [LIB₂ …]`,
      tips: ["THNAME은 mat 카드의 moder 이름과 일치해야 합니다.", "온도 단위를 생략하면 Kelvin으로 해석됩니다."],
      url: `${SYNTAX_MANUAL}#${keyword}`,
    };
  }
  if (keyword === "dep") {
    return {
      title: "연소·방사화 계산의 시간 또는 연소도 구간을 정의합니다",
      description: "각 구간의 단계 형식과 값을 순서대로 지정해 조성 변화 계산 이력을 만듭니다.",
      syntax: "dep TYPE STEP₁ STEP₂ …",
      tips: ["단계 형식에 따라 일(day), MWd/kgU 또는 누적값으로 해석됩니다.", "출력·출력밀도 등 정규화 조건은 구간 사이에서 변경할 수 있습니다."],
      url: `${SYNTAX_MANUAL}#dep`,
    };
  }
  if (["trans", "transa", "transb", "transv", "strans", "ftrans", "dtrans", "utrans"].includes(keyword)) {
    return {
      title: "표면·유니버스·소스·검출기 등의 좌표를 이동하거나 회전합니다",
      description: "기본 형상을 복제하지 않고 위치와 방향을 바꿀 때 사용하는 좌표 변환 카드입니다.",
      syntax: `${keyword} TARGET NAME  X Y Z  [ROTATION …]`,
      tips: ["변환 대상 형식에 따라 첫 인수와 회전 표현이 달라집니다.", "구형 transa·strans·ftrans·dtrans·utrans 대신 최신 trans 문법을 권장합니다."],
      url: `${SYNTAX_MANUAL}#${keyword}`,
    };
  }
  if (card.kind === "setting") {
    return {
      title: `계산 옵션 set ${option}`,
      description: "Serpent의 물리 모델, 계산 제어, 출력 또는 수치 알고리즘을 조정하는 입력 옵션입니다.",
      syntax: `set ${option} ${data.values || "VALUE …"}`,
      tips: ["값의 개수와 허용 범위는 옵션마다 다릅니다.", "기본값을 바꾸는 옵션이므로 공식 문법의 Notes와 제한 조건을 함께 확인하세요."],
      url: `${SYNTAX_MANUAL}#set-${option}`,
    };
  }

  return {
    title: "Serpent 입력 카드",
    description: "이 카드는 Serpent 입력 파서가 하나의 독립된 데이터 블록으로 처리합니다.",
    syntax: `${card.keyword} ${data.name ?? "…"}`.trim(),
    tips: ["옵션 순서와 필수 인수는 공식 입력 문법에서 확인하세요.", "카드 식별자와 같은 이름을 사용자 정의 인수로 사용하지 않는 것이 안전합니다."],
    url: `${SYNTAX_MANUAL}#${keyword === "set" ? `set-${option}` : keyword}`,
  };
}

function fieldHint(card: SerpentCard, key: string, data: Record<string, string>) {
  const option = data.name?.toLowerCase() ?? "";
  if (card.kind === "surface" && key === "type") return "예: cyl, sph, px, pz, sqc, pad";
  if (card.kind === "surface" && key === "values") return surfaceParameterHint(data.type ?? "");
  if (card.kind === "cell" && key === "universe") return "0은 최상위(root) 유니버스입니다.";
  if (card.kind === "cell" && key === "material") return "mat 카드의 이름, void, outside 또는 fill을 입력합니다.";
  if (card.kind === "cell" && key === "region") return "음수: 표면의 음의 면 · 양수: 양의 면 · 공백: 교집합 · 콜론(:): 합집합";
  if (card.kind === "material" && key === "density") return "음수: 질량밀도(g/cm³) · 양수: 원자밀도";
  if (card.kind === "material" && key === "composition") return "한 줄에 핵종명과 분율/밀도를 입력합니다. 예: 92235.09c  4.9E-02";
  if (card.kind === "setting" && option === "pop" && key === "values") return "세대당 중성자 수  활성 세대  비활성 세대  [초기 k-eff  배치 간격  독립 계산 수]";
  if (card.kind === "setting" && option === "nps" && key === "values") return "전체 입자 이력 수  [배치 수  시간 빈]";
  if (card.kind === "setting" && option === "bc" && key === "values") return "1: 흡수 · 2: 반사 · 3: 주기 · 선택적으로 albedo를 추가합니다.";
  if (card.kind === "source" && key === "values") return "예: n sp 0 0 0 se 1.0 — 중성자 점 소스와 에너지";
  if (card.kind === "detector" && key === "values") return "예: dm fuel dr -6 fuel de energy_grid";
  return "";
}

type ValueMeaning = {
  label: string;
  value: string;
  meaning: string;
};

function numericValues(value: string) {
  return value.trim().split(/\s+/).map(Number).filter(Number.isFinite);
}

function boundaryMode(value: string) {
  return { "1": "흡수(black) — 입자를 종료", "2": "반사(reflective) — 대칭 방향으로 반사", "3": "주기(periodic) — 반대편 경계로 이동" }[value] ?? "사용자 지정 경계조건";
}

function interpretOptionSequence(tokens: string[], definitions: Record<string, [number, string]>) {
  const result: ValueMeaning[] = [];
  let index = 0;
  if (tokens[0] === "n" || tokens[0] === "p") {
    result.push({ label: "입자 종류", value: tokens[0], meaning: tokens[0] === "n" ? "중성자" : "광자" });
    index = 1;
  }
  while (index < tokens.length && result.length < 10) {
    const option = tokens[index];
    const definition = definitions[option];
    if (!definition) {
      result.push({ label: `인수 ${index + 1}`, value: option, meaning: "추가 위치 인수 또는 옵션 값" });
      index += 1;
      continue;
    }
    const [length, meaning] = definition;
    const values = tokens.slice(index + 1, index + 1 + length);
    result.push({ label: option, value: values.join(" ") || "—", meaning });
    index += length + 1;
  }
  return result;
}

function interpretCardValues(card: SerpentCard, data: Record<string, string>): ValueMeaning[] {
  const keyword = card.keyword.toLowerCase();
  const option = data.name?.toLowerCase() ?? "";

  if (card.kind === "surface") {
    const values = numericValues(data.values ?? "");
    const type = data.type?.toLowerCase();
    const entries: ValueMeaning[] = [
      { label: "표면 이름", value: data.name || "—", meaning: "셀과 검출기에서 이 경계를 참조할 때 사용하는 식별자" },
      { label: "표면 형식", value: data.type || "—", meaning: surfaceParameterHint(data.type ?? "") },
    ];
    if (type === "px" || type === "py" || type === "pz") {
      const axis = type.at(-1);
      entries.push({ label: `${axis}₀`, value: `${values[0] ?? "—"} cm`, meaning: `${axis}축 원점에서 평면까지의 부호 있는 거리` });
    } else if (type === "cyl" || type === "cylz") {
      entries.push(
        { label: "중심", value: `(${values[0] ?? "—"}, ${values[1] ?? "—"}) cm`, meaning: "XY 평면에서 원통 중심 좌표" },
        { label: "반지름 r", value: `${values[2] ?? "—"} cm`, meaning: `직경은 ${Number.isFinite(values[2]) ? (values[2] * 2).toFixed(3) : "—"} cm` },
      );
      if (values.length >= 5) entries.push({ label: "축 방향 범위", value: `${values[3]} … ${values[4]} cm`, meaning: "절단 원통의 z 최소·최대 위치" });
    } else if (type === "sph") {
      entries.push(
        { label: "중심", value: `(${values[0] ?? "—"}, ${values[1] ?? "—"}, ${values[2] ?? "—"}) cm`, meaning: "구 중심의 X·Y·Z 좌표" },
        { label: "반지름 r", value: `${values[3] ?? "—"} cm`, meaning: `직경은 ${Number.isFinite(values[3]) ? (values[3] * 2).toFixed(3) : "—"} cm` },
      );
    } else if (type === "sqc") {
      entries.push(
        { label: "중심", value: `(${values[0] ?? "—"}, ${values[1] ?? "—"}) cm`, meaning: "정사각 기둥 중심 좌표" },
        { label: "반폭 r", value: `${values[2] ?? "—"} cm`, meaning: `전체 폭은 ${Number.isFinite(values[2]) ? (values[2] * 2).toFixed(3) : "—"} cm` },
      );
      if (Number.isFinite(values[3])) entries.push({ label: "모서리 반경", value: `${values[3]} cm`, meaning: "둥근 모서리에 적용되는 반경" });
    } else if (type === "pad") {
      entries.push(
        { label: "중심", value: `(${values[0] ?? "—"}, ${values[1] ?? "—"}) cm`, meaning: "원환 부채꼴의 중심" },
        { label: "반경 구간", value: `${values[2] ?? "—"} … ${values[3] ?? "—"} cm`, meaning: `두께는 ${Number.isFinite(values[2]) && Number.isFinite(values[3]) ? Math.abs(values[3] - values[2]).toFixed(3) : "—"} cm` },
        { label: "각도 구간", value: `${values[4] ?? "—"}° … ${values[5] ?? "—"}°`, meaning: `열림각은 ${Number.isFinite(values[4]) && Number.isFinite(values[5]) ? Math.abs(values[5] - values[4]).toFixed(3) : "—"}°` },
      );
    } else {
      values.slice(0, 8).forEach((value, index) => entries.push({ label: `PARAM ${index + 1}`, value: String(value), meaning: `${data.type || "표면"} 형식의 ${index + 1}번째 인수` }));
    }
    return entries;
  }

  if (card.kind === "cell") {
    const region = data.region ?? "";
    const surfaces = region.match(/[+-]?[A-Za-z0-9_.]+/g) ?? [];
    return [
      { label: "셀 이름", value: data.name || "—", meaning: "src·det 카드 등에서 이 공간을 참조할 때 사용하는 이름" },
      { label: "유니버스", value: data.universe || "—", meaning: data.universe === "0" ? "최상위(root) 유니버스" : `유니버스 ${data.universe} 내부에 배치` },
      { label: "채움", value: data.material || "—", meaning: data.material === "outside" ? "계산 영역 바깥" : data.material === "void" ? "물질이 없는 빈 공간" : `물질 또는 fill 유니버스 '${data.material}' 사용` },
      { label: "영역식", value: region || "—", meaning: region.includes(":") ? "합집합(:)을 포함한 Boolean 영역" : "나열된 모든 표면 조건의 교집합" },
      ...surfaces.slice(0, 8).map((surface) => ({
        label: `경계 ${surface.replace(/^[+-]/, "")}`,
        value: surface.startsWith("-") ? "음의 면" : "양의 면",
        meaning: surface.startsWith("-") ? "해당 표면 함수가 음수인 쪽(닫힌 표면은 일반적으로 내부)" : "해당 표면 함수가 양수인 쪽(닫힌 표면은 일반적으로 외부)",
      })),
    ];
  }

  if (card.kind === "material") {
    const density = Number(data.density);
    const composition = (data.composition ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    const entries: ValueMeaning[] = [
      { label: "물질 이름", value: data.name || "—", meaning: "cell 카드에서 이 조성을 참조하는 이름" },
      {
        label: "기준 밀도",
        value: data.density || "—",
        meaning: Number.isFinite(density) ? density < 0 ? `질량밀도 ${Math.abs(density)} g/cm³` : `원자밀도 ${density} atoms/(barn·cm)` : "밀도 값을 확인하세요.",
      },
      { label: "핵종 수", value: `${composition.length}개`, meaning: "현재 조성 블록에 입력된 핵종 또는 원소 항목 수" },
    ];
    const options = data.options?.trim();
    if (options) entries.push({ label: "물질 옵션", value: options, meaning: "burn, tmp/tms, moder, rgb 등 물질에 적용되는 추가 설정" });
    composition.slice(0, 7).forEach((line) => {
      const [nuclide, fraction = ""] = line.split(/\s+/);
      const amount = Number(fraction);
      const fractionMeaning = Number.isFinite(amount)
        ? amount < 0 ? `질량 기준 성분값 ${Math.abs(amount)}` : `원자 기준 성분값 ${amount}`
        : "핵종 조성 값";
      const nuclideInfo = parseNuclideId(nuclide);
      entries.push({
        label: nuclide,
        value: fraction || "—",
        meaning: nuclideInfo ? `${describeNuclide(nuclideInfo)} · ${fractionMeaning}` : fractionMeaning,
      });
    });
    if (composition.length > 7) entries.push({ label: "나머지 조성", value: `${composition.length - 7}개`, meaning: "아래 핵종 조성 입력란에서 전체 항목을 확인할 수 있습니다." });
    return entries;
  }

  if (card.kind === "title") {
    return [{ label: "계산 제목", value: data.values || "—", meaning: "실행 로그와 표준 결과 파일에 표시되는 사례 이름" }];
  }

  if (card.kind === "setting" && option === "pop") {
    const values = (data.values ?? "").split(/\s+/).filter(Boolean);
    return [
      { label: "NPG", value: values[0] ?? "—", meaning: "한 세대에서 추적할 중성자 수" },
      { label: "NGEN", value: values[1] ?? "—", meaning: "통계에 포함되는 활성 세대 수" },
      { label: "NSKIP", value: values[2] ?? "—", meaning: "초기 소스 수렴을 위해 버리는 비활성 세대 수" },
      ...(values[3] ? [{ label: "K₀", value: values[3], meaning: "초기 k-effective 추정값" }] : []),
    ];
  }

  if (card.kind === "setting" && option === "nps") {
    const values = (data.values ?? "").split(/\s+/).filter(Boolean);
    return [
      { label: "NP", value: values[0] ?? "—", meaning: "외부 소스 계산에서 추적할 전체 입자 이력 수" },
      ...(values[1] ? [{ label: "BTCH", value: values[1], meaning: "통계 처리를 위한 배치 수" }] : []),
      ...(values[2] ? [{ label: "TBI", value: values[2], meaning: "동적 모드에서 사용할 시간 빈 구조" }] : []),
    ];
  }

  if (card.kind === "setting" && option === "bc") {
    const values = (data.values ?? "").split(/\s+/).filter(Boolean);
    if (values.length >= 3) {
      return ["x", "y", "z"].map((axis, index) => ({ label: `${axis.toUpperCase()} 경계`, value: values[index] ?? "—", meaning: boundaryMode(values[index]) }));
    }
    return [
      { label: "전체 방향 경계", value: values[0] ?? "—", meaning: boundaryMode(values[0]) },
      ...(values[1] ? [{ label: "Albedo", value: values[1], meaning: "경계 통과 시 입자 통계 가중치에 곱하는 계수" }] : []),
    ];
  }

  if (card.kind === "setting" && ["power", "powdens", "srcrate"].includes(option)) {
    const [value = "—", material] = (data.values ?? "").split(/\s+/);
    const units = option === "power" ? "W" : option === "powdens" ? "kW/g" : "particles/s";
    return [
      { label: option, value: `${value} ${units}`, meaning: "결과를 물리량으로 환산할 때 사용하는 정규화 기준" },
      ...(material ? [{ label: "기준 물질", value: material, meaning: "정규화를 이 물질의 기여도에 한정" }] : []),
    ];
  }

  if (card.kind === "setting") {
    return (data.values ?? "").split(/\s+/).filter(Boolean).slice(0, 10).map((value, index) => ({
      label: index === 0 ? `set ${option}` : `인수 ${index + 1}`,
      value,
      meaning: index === 0 ? "이 옵션의 첫 번째 설정값" : `set ${option} 옵션의 ${index + 1}번째 설정값`,
    }));
  }

  if (card.kind === "source") {
    const tokens = (data.values ?? "").split(/\s+/).filter(Boolean);
    return [
      { label: "소스 이름", value: data.name || "—", meaning: "소스 분포 식별자" },
      ...interpretOptionSequence(tokens, {
        sp: [3, "점 소스 또는 분포 중심의 X·Y·Z 좌표(cm)"],
        sc: [1, "이 셀 내부에서 소스 위치를 샘플링"],
        sm: [1, "이 물질 내부에서 소스 위치를 샘플링"],
        su: [1, "이 유니버스 내부에서 소스 위치를 샘플링"],
        ss: [1, "지정 표면에서 입자를 방출"],
        sx: [2, "X 방향 샘플링 최소·최대 범위(cm)"],
        sy: [2, "Y 방향 샘플링 최소·최대 범위(cm)"],
        sz: [2, "Z 방향 샘플링 최소·최대 범위(cm)"],
        srad: [2, "방사 방향 최소·최대 반경(cm)"],
        se: [1, "단일 입자 에너지(MeV)"],
        sd: [3, "입자 진행 방향 벡터"],
      }),
    ];
  }

  if (card.kind === "detector") {
    const tokens = (data.values ?? "").split(/\s+/).filter(Boolean);
    return [
      { label: "검출기 이름", value: data.name || "—", meaning: "출력 변수 DET[NAME]에 사용되는 식별자" },
      ...interpretOptionSequence(tokens, {
        dc: [1, "이 셀에 집계 영역을 제한"],
        dm: [1, "이 물질에 집계 영역을 제한"],
        du: [1, "이 유니버스에 집계 영역을 제한"],
        dl: [1, "이 격자에 집계 영역을 제한"],
        ds: [2, "표면과 방향을 지정한 입자 전류 검출"],
        de: [1, "결과에 적용할 에너지 격자"],
        dr: [2, "MT 반응번호와 응답 물질"],
        dv: [1, "검출기 체적 또는 결과 나눗셈 계수"],
      }),
    ];
  }

  if (card.kind === "plot" && keyword === "plot") {
    const values = [data.name, ...(data.values ?? "").split(/\s+/)].filter(Boolean);
    const plane = { "1": "YZ", "2": "XZ", "3": "XY" }[values[0]] ?? "사용자 지정";
    return [
      { label: "단면 방향", value: values[0] ?? "—", meaning: `${plane} 평면` },
      { label: "이미지 크기", value: `${values[1] ?? "—"} × ${values[2] ?? "—"} px`, meaning: "Serpent가 생성할 PNG의 가로·세로 픽셀 수" },
      ...(values[3] ? [{ label: "단면 위치", value: `${values[3]} cm`, meaning: "단면에 수직인 축의 좌표" }] : []),
    ];
  }

  if (keyword === "pin") {
    const tokens = (data.values ?? "").split(/\s+/).filter(Boolean);
    const entries: ValueMeaning[] = [{ label: "핀 유니버스", value: data.name || "—", meaning: "격자나 fill에서 참조할 동심 원통 구조 이름" }];
    for (let index = 0; index < tokens.length; index += 2) {
      entries.push({
        label: `층 ${index / 2 + 1}`,
        value: tokens[index + 1] ? `${tokens[index]} · R ${tokens[index + 1]} cm` : tokens[index],
        meaning: tokens[index + 1] ? "해당 물질층의 외부 반지름" : "반지름 제한 없이 이어지는 최외곽 물질",
      });
    }
    return entries;
  }

  const values = [data.name, ...(data.values ?? "").split(/\s+/)].filter(Boolean);
  return values.slice(0, 10).map((value, index) => ({
    label: index === 0 ? "첫 번째 인수" : `인수 ${index + 1}`,
    value,
    meaning: `${card.keyword} 카드의 ${index + 1}번째 입력값`,
  }));
}

/**
 * 단일 HTML 파일을 file:// 로 열면 브라우저가 localStorage 를 막을 수 있다.
 * 설정 저장은 부가 기능이므로 실패해도 앱이 죽지 않도록 감싼다.
 */
function readSetting(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장할 수 없는 환경에서는 이번 세션에만 적용한다.
  }
}

const FONT_SCALE_MIN = 90;
const FONT_SCALE_MAX = 150;
const FONT_SCALE_STEP = 10;
const ROOT_FONT_SIZE = 16;

export default function Home() {
  const [source, setSource] = useState(SAMPLE_INPUT);
  const [fileName, setFileName] = useState("pwr_pin.inp");
  const [selectedId, setSelectedId] = useState<string>("");
  const [view, setView] = useState<"builder" | "source" | "preview" | "results">("builder");
  const [results, setResults] = useState<ResultCase[]>([]);
  const [referenceId, setReferenceId] = useState("");
  const [fontScale, setFontScale] = useState(100);
  const [showAdd, setShowAdd] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const resultInput = useRef<HTMLInputElement>(null);

  const cards = useMemo(() => parseSerpentInput(source), [source]);
  const model = useMemo(() => parseGeometryModel(cards), [cards]);

  // 셀 이름 → 카드 id. 형상 진단 결과에서 문제가 된 셀 카드로 바로 이동할 수 있게 한다.
  const cellCardIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of cards) {
      if (card.kind !== "cell") continue;
      const name = getCardData(card).name;
      if (name && !map.has(name)) map.set(name, card.id);
    }
    return map;
  }, [cards]);

  const syntaxIssues = useMemo(() => validateSerpentInput(cards), [cards]);
  const geometryIssues = useMemo(() => diagnoseGeometry(model, cellCardIds), [model, cellCardIds]);
  const issues = useMemo(() => [...syntaxIssues, ...geometryIssues], [syntaxIssues, geometryIssues]);

  const selected = cards.find((card) => card.id === selectedId) ?? cards.find((card) => card.kind === "surface") ?? cards[0];
  const selectedData = selected ? getCardData(selected) : {};
  const selectedGuide = selected ? guideForCard(selected, selectedData) : null;
  const selectedMeanings = selected ? interpretCardValues(selected, selectedData) : [];
  const errors = issues.filter((issue) => issue.level === "error").length;

  const groupedCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const entries = cards.map((card) => ({ card, summary: cardSummary(card), group: cardCategory(card) }));
    const visible = needle
      ? entries.filter(({ card, summary }) =>
          `${summary.name} ${summary.meta} ${card.keyword}`.toLowerCase().includes(needle))
      : entries;
    return GROUPS.map((group) => ({
      ...group,
      items: visible.filter((entry) => entry.group === group.name),
    })).filter((group) => group.items.length);
  }, [cards, query]);

  const matchCount = groupedCards.reduce((total, group) => total + group.items.length, 0);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  useEffect(() => {
    const savedScale = Number(readSetting("serpent-studio-font-scale"));
    if (savedScale >= FONT_SCALE_MIN && savedScale <= FONT_SCALE_MAX) setFontScale(savedScale);
  }, []);

  // rem 기반 스타일이므로 루트 글씨 크기를 바꾸면 여백과 패널 폭까지 함께 확대된다.
  useEffect(() => {
    document.documentElement.style.fontSize = `${(ROOT_FONT_SIZE * fontScale) / 100}px`;
    return () => { document.documentElement.style.fontSize = ""; };
  }, [fontScale]);

  function changeFontScale(nextScale: number) {
    const boundedScale = Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, nextScale));
    setFontScale(boundedScale);
    writeSetting("serpent-studio-font-scale", String(boundedScale));
  }

  function toggleGroup(group: string) {
    setCollapsedGroups((groups) =>
      groups.includes(group) ? groups.filter((item) => item !== group) : [...groups, group],
    );
  }

  function replaceCard(card: SerpentCard) {
    const next = cards.map((item) => (item.id === card.id ? card : item));
    setSource(serializeCards(next));
  }

  function handleField(key: string, value: string) {
    if (!selected) return;
    replaceCard(updateCard(selected, { ...selectedData, [key]: value } as Record<string, string>));
  }

  function addCard(type: string) {
    const nextSource = source.trimEnd() + (CARD_TEMPLATES[type] ?? "");
    setSource(nextSource);
    const nextCards = parseSerpentInput(nextSource);
    setSelectedId(nextCards[nextCards.length - 1]?.id ?? "");
    setShowAdd(false);
    setView("builder");
  }

  function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSource(String(reader.result ?? ""));
      setFileName(file.name);
      setSelectedId("");
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  // 결과 파일은 여러 개를 한꺼번에 받는다. 제어드럼처럼 배치를 바꿔가며 돌린
  // 캠페인에서는 개별 keff 보다 기준 케이스 대비 Δρ 가 실제 산출물이기 때문이다.
  async function openResults(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const loaded = await Promise.all(
      files.map(async (file, index) =>
        buildResultCase(file.name, await file.text(), `${Date.now()}-${index}-${file.name}`),
      ),
    );

    setResults((current) => {
      // 같은 파일을 다시 열면 갈아끼운다.
      const kept = current.filter((item) => !loaded.some((next) => next.fileName === item.fileName));
      const merged = [...kept, ...loaded];
      setReferenceId((id) => (merged.some((item) => item.id === id) ? id : merged[0]?.id ?? ""));
      return merged;
    });
    setView("results");
  }

  function removeResult(id: string) {
    setResults((current) => {
      const next = current.filter((item) => item.id !== id);
      setReferenceId((currentId) => (next.some((item) => item.id === currentId) ? currentId : next[0]?.id ?? ""));
      return next;
    });
  }

  function downloadInput() {
    const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  function runValidation() {
    setLogOpen(true);
    setView("preview");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>SERPENT Studio</strong>
            <span>INPUT MODEL BUILDER</span>
          </div>
        </div>
        <div className="file-pill">
          <Icon>▤</Icon>
          <input
            aria-label="파일 이름"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
          />
          <span className="saved-dot" />
          <span>편집 중</span>
        </div>
        <div className="top-actions">
          <div className="font-size-control" role="group" aria-label="글씨 크기 조절">
            <button
              type="button"
              aria-label="글씨 작게"
              title="글씨 작게"
              disabled={fontScale <= FONT_SCALE_MIN}
              onClick={() => changeFontScale(fontScale - FONT_SCALE_STEP)}
            >A−</button>
            <button
              type="button"
              className="font-size-value"
              aria-label="기본 글씨 크기로 되돌리기"
              title="기본 글씨 크기로 되돌리기"
              onClick={() => changeFontScale(100)}
            >{fontScale}%</button>
            <button
              type="button"
              aria-label="글씨 크게"
              title="글씨 크게"
              disabled={fontScale >= FONT_SCALE_MAX}
              onClick={() => changeFontScale(fontScale + FONT_SCALE_STEP)}
            >A+</button>
          </div>
          <input
            ref={fileInput}
            type="file"
            aria-label="SERPENT 입력문 선택"
            hidden
            onChange={openFile}
          />
          <input
            ref={resultInput}
            type="file"
            aria-label="Serpent 결과 파일 선택"
            accept=".m,text/plain"
            multiple
            hidden
            onChange={openResults}
          />
          <button className="button ghost" onClick={() => fileInput.current?.click()}>
            <Icon>↥</Icon> 열기
          </button>
          <button className="button ghost" onClick={() => resultInput.current?.click()}>
            <Icon>◫</Icon> 결과 열기
          </button>
          <button className="button ghost" onClick={downloadInput}>
            <Icon>↓</Icon> 내보내기
          </button>
          <button className="button primary" onClick={runValidation}>
            <Icon>▶</Icon> 입력 검사
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>모델 구성</span>
            <button className="icon-button" aria-label="카드 추가" onClick={() => setShowAdd(!showAdd)}>＋</button>
          </div>
          {showAdd && (
            <div className="add-menu">
              {Object.keys(CARD_TEMPLATES).map((key) => (
                <button key={key} onClick={() => addCard(key)}>
                  <Icon>＋</Icon>{formatKind(key as CardKind)}
                </button>
              ))}
            </div>
          )}
          <div className="sidebar-search">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              aria-label="카드 검색"
              placeholder="이름 · 값으로 카드 찾기"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button className="search-clear" aria-label="검색어 지우기" onClick={() => setQuery("")}>×</button>
            )}
          </div>
          <nav className="model-tree" aria-label="Serpent 카드">
            {groupedCards.map((group) => {
              const collapsed = !query && collapsedGroups.includes(group.name);
              return (
                <div className="tree-group" key={group.name}>
                  <button
                    className={collapsed ? "tree-label collapsed" : "tree-label"}
                    title={group.hint}
                    aria-expanded={!collapsed}
                    onClick={() => toggleGroup(group.name)}
                  >
                    <span className="chevron" aria-hidden="true">▼</span>
                    <span className="group-icon" aria-hidden="true">{group.icon}</span>
                    <span>{group.name}</span>
                    <span className="group-count">{group.items.length}</span>
                  </button>
                  {!collapsed && (
                    <div className="tree-items">
                      {group.items.map(({ card, summary }) => (
                        <button
                          key={card.id}
                          className={selected?.id === card.id ? "tree-item active" : "tree-item"}
                          onClick={() => { setSelectedId(card.id); setView("builder"); }}
                        >
                          <span className={`kind-dot ${card.kind}`} />
                          <span className="tree-text">
                            <span className="tree-name">{summary.name}</span>
                            {summary.meta && <span className="tree-meta">{summary.meta}</span>}
                          </span>
                          <span className="tree-line">L{card.startLine}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!matchCount && (
              <p className="tree-empty">{query ? `'${query}'와 일치하는 카드가 없습니다.` : "카드가 없습니다."}</p>
            )}
          </nav>
          <div className="project-health">
            <div className="health-row">
              <span>모델 상태</span>
              <strong className={errors ? "bad" : "good"}>{errors ? `${errors} 오류` : "정상"}</strong>
            </div>
            <div className="health-meter"><span style={{ width: errors ? "64%" : "100%" }} /></div>
            <small>
              {query ? `${matchCount} / ${cards.length}개 카드 표시 중` : `${cards.length}개 카드 · Serpent 2 형식`}
            </small>
          </div>
        </aside>

        <section className="editor-pane">
          <div className="editor-tabs">
            <button className={view === "builder" ? "active" : ""} onClick={() => setView("builder")}>
              구조화 편집
            </button>
            <button className={view === "source" ? "active" : ""} onClick={() => setView("source")}>
              원문 입력
            </button>
            <button className={view === "preview" ? "active" : ""} onClick={() => setView("preview")}>
              형상 미리보기
            </button>
            <button className={view === "results" ? "active" : ""} onClick={() => setView("results")}>
              결과 분석
              {results.length > 0 && <span className="tab-count">{results.length}</span>}
            </button>
            <div className="undo-group">
              <button className="icon-button" title="샘플로 되돌리기" onClick={() => setSource(SAMPLE_INPUT)}>↶</button>
            </div>
          </div>

          {view === "results" ? (
            <ResultsPanel
              cases={results}
              referenceId={referenceId}
              onPickReference={setReferenceId}
              onOpen={() => resultInput.current?.click()}
              onRemove={removeResult}
            />
          ) : view === "preview" ? (
            <GeometryPreview
              model={model}
              selectedSurfaceId={selected?.kind === "surface" ? selectedData.name : ""}
            />
          ) : view === "source" ? (
            <div className="source-editor">
              <div className="source-toolbar">
                <span>Serpent 2 input</span>
                <span>{source.split("\n").length} lines</span>
              </div>
              <textarea
                aria-label="Serpent 원문 입력"
                spellCheck={false}
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
            </div>
          ) : selected ? (
            <div className="form-editor">
              <div className="card-header">
                <div>
                  <span className="eyebrow">{cardCategory(selected)} · {formatKind(selected.kind)}</span>
                  <h1>{selected.label}</h1>
                  <p>입력 카드의 값을 수정하면 Serpent 원문에 바로 반영됩니다.</p>
                </div>
                <span className="line-badge">LINE {selected.startLine}</span>
              </div>

              {selectedGuide && (
                <section className="card-guide" aria-label="Serpent 매뉴얼 안내">
                  <div className="guide-copy">
                    <span>공식 매뉴얼 기반 안내</span>
                    <strong>{selectedGuide.title}</strong>
                    <p>{selectedGuide.description}</p>
                  </div>
                  <code>{selectedGuide.syntax}</code>
                  <div className="current-values">
                    <div className="current-values-head">
                      <span>현재 입력값 해석</span>
                      <small>입력값을 수정하면 설명도 즉시 갱신됩니다.</small>
                    </div>
                    <div className="meaning-grid">
                      {selectedMeanings.map((item, index) => (
                        <div className="meaning-item" key={`${item.label}-${item.value}-${index}`}>
                          <span>{item.label}</span>
                          <code>{item.value}</code>
                          <p>{item.meaning}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <ul>
                    {selectedGuide.tips.map((tip) => <li key={tip}>{tip}</li>)}
                  </ul>
                  <a href={selectedGuide.url} target="_blank" rel="noreferrer">
                    공식 문법 보기 ↗
                  </a>
                </section>
              )}

              <h2 className="form-section-title">입력값 편집</h2>
              <div className="form-grid">
                {Object.entries(selectedData).map(([key, value]) => {
                  const wide = ["values", "region", "composition", "comment"].includes(key);
                  const hint = fieldHint(selected, key, selectedData);
                  return (
                    <label className={wide ? "field wide" : "field"} key={`${selected.id}-${key}`}>
                      <span>{fieldLabel(selected, key)}</span>
                      {key === "composition" ? (
                        <div className="composition-editor">
                          <textarea
                            value={value}
                            spellCheck={false}
                            onChange={(event) => handleField(key, event.target.value)}
                          />
                          <div className="composition-hints" aria-label="핵종 조성 해석">
                            {value.split("\n").some((line) => line.trim()) ? (
                              value.split("\n").map((line, index) => {
                                const trimmed = line.trim();
                                if (!trimmed) return null;
                                const [nuclideToken] = trimmed.split(/\s+/);
                                const info = parseNuclideId(nuclideToken);
                                return (
                                  <div
                                    className={info && !info.massSuspect ? "composition-hint" : "composition-hint warn"}
                                    key={`${nuclideToken}-${index}`}
                                  >
                                    <code>{nuclideToken}</code>
                                    <span>
                                      {info
                                        ? describeNuclide(info)
                                        : "라이브러리 접미사(예: .09c)가 없어 해석할 수 없습니다."}
                                    </span>
                                  </div>
                                );
                              })
                            ) : (
                              <p className="composition-hint-empty">
                                핵종을 입력하면 원소·질량수·라이브러리를 해석해 표시합니다. 예: 92235.09c → 우라늄-235, 라이브러리 09c
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <input value={value} onChange={(event) => handleField(key, event.target.value)} />
                      )}
                      {hint && <small>{hint}</small>}
                    </label>
                  );
                })}
              </div>

              <div className="raw-card">
                <div>
                  <span>생성된 입력 카드</span>
                  <small>원문 입력 탭에서도 직접 수정할 수 있습니다.</small>
                </div>
                <code>{selected.lines.filter((line) => line.trim()).join("\n")}</code>
              </div>
            </div>
          ) : (
            <div className="empty-state">편집할 카드를 선택하세요.</div>
          )}
        </section>

        <aside className="inspector">
          <div className="inspector-heading">
            <span>검사 결과</span>
            <span>{issues.length}</span>
          </div>
          <div className="issues">
            <div className="issue-summary">
              <div className={errors ? "summary-icon error" : "summary-icon"}>{errors ? "!" : "✓"}</div>
              <div>
                <strong>{errors ? "입력을 확인해 주세요" : "치명적인 오류가 없습니다"}</strong>
                <span>{errors} errors · {issues.length - errors} warnings</span>
              </div>
            </div>
            {issues.length ? issues.map((issue, index) => (
              <button
                className={`issue ${issue.level}`}
                key={`${issue.message}-${index}`}
                onClick={() => issue.cardId && setSelectedId(issue.cardId)}
              >
                <span>{issue.level === "error" ? "×" : "!"}</span>
                <div><strong>{issue.level === "error" ? "오류" : "권장 사항"}</strong><p>{issue.message}</p></div>
              </button>
            )) : (
              <div className="all-clear">모든 기본 검사를 통과했습니다.</div>
            )}
          </div>
        </aside>
      </section>

      <footer className="statusbar">
        <div><span className={errors ? "status-light error" : "status-light"} /> {errors ? "검사 필요" : "기본 검증 통과"}</div>
        <div className="status-center"><span>Surfaces {cards.filter((c) => c.kind === "surface").length}</span><span>Cells {cards.filter((c) => c.kind === "cell").length}</span><span>Materials {cards.filter((c) => c.kind === "material").length}</span></div>
        <button onClick={() => setLogOpen(!logOpen)}>⌃ 실행 콘솔</button>
      </footer>

      {logOpen && (
        <div className="console">
          <div className="console-head"><span>입력 검사 콘솔</span><button onClick={() => setLogOpen(false)}>×</button></div>
          <pre>
{`SERPENT Studio validator
Reading ${fileName}...
Parsed ${cards.length} input cards.
${errors ? `Found ${errors} error(s) and ${issues.length - errors} warning(s).` : `No blocking errors found. ${issues.length} recommendation(s).`}

브라우저 버전에서는 문법과 참조 무결성을 검사합니다.
정식 계산 전에는 설치된 Serpent에서 입력 검사를 다시 수행하세요.`}
          </pre>
        </div>
      )}
    </main>
  );
}


type PreviewTransform = {
  plotLeft: number;
  plotTop: number;
  plotWidth: number;
  plotHeight: number;
  scale: number;
  horizontalMin: number;
  verticalMax: number;
};

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 40;

/** 눈금 간격을 1·2·5 계열의 읽기 좋은 값으로 맞춘다. */
function niceStep(span: number, targetCount: number) {
  const raw = span / Math.max(1, targetCount);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return step * magnitude;
}

function formatCoordinate(value: number, step: number) {
  const decimals = Math.max(0, Math.min(4, Math.ceil(-Math.log10(step)) + 1));
  return value.toFixed(decimals);
}

function GeometryPreview({
  model,
  selectedSurfaceId,
}: {
  model: GeometryModel;
  selectedSurfaceId: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const transform = useRef<PreviewTransform | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panOrigin = useRef<{ x: number; y: number } | null>(null);

  const [basis, setBasis] = useState<PlotBasis>("xy");
  const [slice, setSlice] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ horizontal: 0, vertical: 0 });
  const [draft, setDraft] = useState(false);
  const [panning, setPanning] = useState(false);
  const [hover, setHover] = useState<
    { horizontal: number; vertical: number; material: string; status: PointStatus; overlap: string[] } | null
  >(null);
  const [activeSurfaceId, setActiveSurfaceId] = useState("");
  const [highlight, setHighlight] = useState("");
  const [showProblems, setShowProblems] = useState(true);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const modelBounds = useMemo(() => geometryPlotBounds(model, basis), [model, basis]);
  // outside 셀이 없으면 바깥 공간 전체가 빈틈으로 잡히므로 빈틈 표시는 끈다.
  const outsideDefined = useMemo(() => hasOutsideCell(model), [model]);
  const axisNames = basis === "xy" ? ["X", "Y", "Z"] : basis === "xz" ? ["X", "Z", "Y"] : ["Y", "Z", "X"];

  const sliceRange = useMemo(() => {
    const source = basis === "xy" ? geometryPlotBounds(model, "xz") : geometryPlotBounds(model, basis === "xz" ? "yz" : "xy");
    const [min, max] = basis === "xy"
      ? [source.verticalMin, source.verticalMax]
      : [source.horizontalMin, source.horizontalMax];
    return { min, max, step: Math.max((max - min) / 100, 0.001) };
  }, [model, basis]);

  // 현재 확대·이동을 반영한 표시 영역.
  const view = useMemo(() => {
    const centerH = (modelBounds.horizontalMin + modelBounds.horizontalMax) / 2 + pan.horizontal;
    const centerV = (modelBounds.verticalMin + modelBounds.verticalMax) / 2 + pan.vertical;
    const halfH = (modelBounds.horizontalMax - modelBounds.horizontalMin) / 2 / zoom;
    const halfV = (modelBounds.verticalMax - modelBounds.verticalMin) / 2 / zoom;
    return {
      horizontalMin: centerH - halfH,
      horizontalMax: centerH + halfH,
      verticalMin: centerV - halfV,
      verticalMax: centerV + halfV,
    };
  }, [modelBounds, pan, zoom]);

  const visibleSurfaces = useMemo(() => {
    return [...model.surfaces.values()].filter((surface) => {
      if (basis === "xy") {
        if (["cyl", "cylz", "sqc", "pad", "px", "py"].includes(surface.type)) return true;
        if (surface.type === "sph") {
          return Math.abs(slice - (surface.values[2] ?? 0)) <= (surface.values[3] ?? 0);
        }
        return false;
      }
      if (basis === "xz") return ["cyl", "cylz", "pad", "px", "pz", "sph"].includes(surface.type);
      return ["cyl", "cylz", "pad", "py", "pz", "sph"].includes(surface.type);
    });
  }, [model, basis, slice]);

  const usedMaterials = useMemo(() => {
    const names = new Set<string>();
    for (const cell of model.cells) {
      if (cell.material && cell.material !== "outside" && cell.material !== "fill") names.add(cell.material);
    }
    for (const layers of model.pins.values()) {
      for (const layer of layers) if (layer.material !== "outside") names.add(layer.material);
    }
    for (const name of model.materials.keys()) names.add(name);
    return [...names];
  }, [model]);

  useEffect(() => {
    if (visibleSurfaces.some((surface) => surface.id === selectedSurfaceId)) {
      setActiveSurfaceId(selectedSurfaceId);
    }
  }, [visibleSurfaces, selectedSurfaceId]);

  useEffect(() => {
    if (!visibleSurfaces.some((surface) => surface.id === activeSurfaceId)) {
      setActiveSurfaceId(visibleSurfaces[0]?.id ?? "");
    }
  }, [visibleSurfaces, activeSurfaceId]);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const activeSurface = visibleSurfaces.find((surface) => surface.id === activeSurfaceId);

  function markInteracting() {
    setDraft(true);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => setDraft(false), 180);
  }

  function resetView() {
    setZoom(1);
    setPan({ horizontal: 0, vertical: 0 });
  }

  function changeZoom(factor: number) {
    markInteracting();
    setZoom((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor)));
  }

  // 단면을 바꾸면 확대·이동을 초기화해 전체 형상부터 다시 보여준다.
  function changeBasis(next: PlotBasis) {
    setBasis(next);
    resetView();
    setHover(null);
  }

  function pointToWorld(event: { clientX: number; clientY: number }) {
    const element = canvas.current;
    const current = transform.current;
    if (!element || !current) return null;
    const rect = element.getBoundingClientRect();
    return {
      horizontal: current.horizontalMin + (event.clientX - rect.left - current.plotLeft) / current.scale,
      vertical: current.verticalMax - (event.clientY - rect.top - current.plotTop) / current.scale,
    };
  }

  function worldToPoint(horizontal: number, vertical: number) {
    return basis === "xy"
      ? ([horizontal, vertical, slice] as const)
      : basis === "xz"
        ? ([horizontal, slice, vertical] as const)
        : ([slice, horizontal, vertical] as const);
  }

  // 휠 확대는 기본 스크롤을 막아야 해서 passive: false 리스너로 직접 등록한다.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const anchor = pointToWorld(event);
      const factor = Math.exp(-event.deltaY * 0.0015);
      markInteracting();
      setZoom((current) => {
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor));
        if (anchor && next !== current) {
          // 커서 아래 지점이 제자리에 남도록 중심을 보정한다.
          setPan((currentPan) => {
            const centerH = (modelBounds.horizontalMin + modelBounds.horizontalMax) / 2 + currentPan.horizontal;
            const centerV = (modelBounds.verticalMin + modelBounds.verticalMax) / 2 + currentPan.vertical;
            const ratio = current / next;
            return {
              horizontal: currentPan.horizontal + (anchor.horizontal - centerH) * (1 - ratio),
              vertical: currentPan.vertical + (anchor.vertical - centerV) * (1 - ratio),
            };
          });
        }
        return next;
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [modelBounds]);

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    panOrigin.current = { x: event.clientX, y: event.clientY };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const current = transform.current;
    const origin = panOrigin.current;
    if (origin && current) {
      const deltaH = (event.clientX - origin.x) / current.scale;
      const deltaV = (event.clientY - origin.y) / current.scale;
      panOrigin.current = { x: event.clientX, y: event.clientY };
      markInteracting();
      setPan((current) => ({ horizontal: current.horizontal - deltaH, vertical: current.vertical + deltaV }));
      return;
    }
    const world = pointToWorld(event);
    if (!world) return;
    const [x, y, z] = worldToPoint(world.horizontal, world.vertical);
    const info = classifyPoint(model, x, y, z);
    setHover({ ...world, material: info.material, status: info.status, overlap: info.overlap });
  }

  function endPan(event: ReactPointerEvent<HTMLCanvasElement>) {
    panOrigin.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  useEffect(() => {
    const element = canvas.current;
    if (!element || !size.width || !size.height) return;
    const context = element.getContext("2d");
    if (!context) return;

    const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const ratio = window.devicePixelRatio || 1;
    const width = size.width;
    const height = size.height;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    // 모델을 화면비에 맞춰 채운다. 여백을 남기지 않고 캔버스 전체가 도면이 된다.
    const scale = Math.min(
      width / (view.horizontalMax - view.horizontalMin),
      height / (view.verticalMax - view.verticalMin),
    );
    const centerH = (view.horizontalMin + view.horizontalMax) / 2;
    const centerV = (view.verticalMin + view.verticalMax) / 2;
    const horizontalMin = centerH - width / (2 * scale);
    const verticalMax = centerV + height / (2 * scale);
    const hSpan = width / scale;
    const vSpan = height / scale;
    const plotLeft = 0;
    const plotTop = 0;
    const plotWidth = width;
    const plotHeight = height;
    transform.current = { plotLeft, plotTop, plotWidth, plotHeight, scale, horizontalMin, verticalMax };

    const toCanvas = (horizontal: number, vertical: number) => ({
      x: (horizontal - horizontalMin) * scale,
      y: (verticalMax - vertical) * scale,
    });

    // 상호작용 중에는 해상도를 낮춰 즉시 반응하고, 멈추면 실제 디스플레이 배율(devicePixelRatio)만큼
    // 그려서 Retina 등 고해상도 화면에서도 경계선이 흐려지지 않게 한다. 2400px 상한은 초고해상도
    // 디스플레이에서 셀이 많은 모델을 그릴 때 메인 스레드가 멈추지 않도록 하는 안전장치일 뿐이다.
    const settledRaster = Math.max(plotWidth, plotHeight, 1) * ratio;
    const maxRaster = draft ? 360 : Math.min(settledRaster, 2400);
    const density = Math.min(ratio, maxRaster / Math.max(plotWidth, plotHeight, 1));
    const rasterWidth = Math.max(1, Math.round(plotWidth * density));
    const rasterHeight = Math.max(1, Math.round(plotHeight * density));
    const raster = document.createElement("canvas");
    raster.width = rasterWidth;
    raster.height = rasterHeight;
    const rasterContext = raster.getContext("2d");
    if (!rasterContext) return;
    const image = rasterContext.createImageData(rasterWidth, rasterHeight);

    // 문제 영역 표시가 켜지면 첫 매칭에서 멈추지 않고 모든 셀을 확인하므로 조금 느려진다.
    const inspectProblems = showProblems && !draft;

    for (let py = 0; py < rasterHeight; py += 1) {
      const vertical = verticalMax - ((py + 0.5) / rasterHeight) * vSpan;
      for (let px = 0; px < rasterWidth; px += 1) {
        const horizontal = horizontalMin + ((px + 0.5) / rasterWidth) * hSpan;
        const [x, y, z] = basis === "xy"
          ? [horizontal, vertical, slice]
          : basis === "xz"
            ? [horizontal, slice, vertical]
            : [slice, horizontal, vertical];

        let materialName: string;
        let isOverlap = false;
        let isGap = false;
        if (inspectProblems) {
          const info = classifyPoint(model, x, y, z);
          materialName = info.material;
          isOverlap = info.overlap.length > 1;
          isGap = info.status === "undefined" && outsideDefined;
        } else {
          materialName = materialAtPoint(model, x, y, z);
        }

        const offset = (py * rasterWidth + px) * 4;

        // 빈틈은 물질이 없으므로 통째로 경고색으로 칠한다.
        if (isGap) {
          image.data[offset] = 255;
          image.data[offset + 1] = 64;
          image.data[offset + 2] = 132;
          image.data[offset + 3] = 255;
          continue;
        }

        const color = materialColor(model, materialName);
        if (!color) {
          image.data[offset] = 7;
          image.data[offset + 1] = 23;
          image.data[offset + 2] = 20;
          image.data[offset + 3] = 255;
          continue;
        }

        const dim = highlight && materialName !== highlight;
        let red = dim ? Math.round(color[0] * 0.28 + 20) : color[0];
        let green = dim ? Math.round(color[1] * 0.28 + 30) : color[1];
        let blue = dim ? Math.round(color[2] * 0.28 + 27) : color[2];

        // 겹침은 어느 물질이 이겼는지도 봐야 하므로 사선 빗금으로만 덮는다.
        if (isOverlap && (px + py) % 10 < 4) {
          red = 255;
          green = 64;
          blue = 132;
        }

        image.data[offset] = red;
        image.data[offset + 1] = green;
        image.data[offset + 2] = blue;
        image.data[offset + 3] = 255;
      }
    }

    rasterContext.putImageData(image, 0, 0);
    context.fillStyle = "#071714";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(raster, plotLeft, plotTop, plotWidth, plotHeight);

    if (basis === "xy") {
      for (const surface of model.surfaces.values()) {
        if (surface.type !== "pad") continue;
        const v = surface.values;
        const start = v[4] ?? 0;
        const end = v[5] ?? 360;
        const middle = (((start + end) / 2) * Math.PI) / 180;
        const middleRadius = ((v[2] ?? 0) + (v[3] ?? 0)) / 2;
        const sampleX = (v[0] ?? 0) + Math.cos(middle) * middleRadius;
        const sampleY = (v[1] ?? 0) + Math.sin(middle) * middleRadius;
        const materialName = materialAtPoint(model, sampleX, sampleY, slice);
        if (!materialName) continue;
        const color = materialColor(model, materialName) ?? [234, 84, 85];
        const points: { x: number; y: number }[] = [];
        const segments = 48;
        for (let index = 0; index <= segments; index += 1) {
          const angle = ((start + ((end - start) * index) / segments) * Math.PI) / 180;
          points.push(toCanvas((v[0] ?? 0) + Math.cos(angle) * (v[3] ?? 0), (v[1] ?? 0) + Math.sin(angle) * (v[3] ?? 0)));
        }
        for (let index = segments; index >= 0; index -= 1) {
          const angle = ((start + ((end - start) * index) / segments) * Math.PI) / 180;
          points.push(toCanvas((v[0] ?? 0) + Math.cos(angle) * (v[2] ?? 0), (v[1] ?? 0) + Math.sin(angle) * (v[2] ?? 0)));
        }
        context.beginPath();
        points.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
        context.closePath();
        context.fillStyle = `rgb(${color.join(",")})`;
        context.fill();
        context.strokeStyle = "rgba(28, 48, 42, .65)";
        context.lineWidth = 0.6;
        context.stroke();
      }
    }

    // --- 눈금 ---------------------------------------------------------
    // 가로 눈금값은 아래쪽, 세로 눈금값은 왼쪽 여백에 적고 두 띠가 겹치는 모서리는 비워 둔다.
    const tickFont = Math.max(10, rootFont * 0.7);
    const step = niceStep(hSpan, Math.max(3, Math.round(plotWidth / (tickFont * 6.5))));
    const bottomBand = tickFont * 2;
    context.save();
    context.beginPath();
    context.rect(plotLeft, plotTop, plotWidth, plotHeight);
    context.clip();
    context.font = `${tickFont}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.textBaseline = "alphabetic";

    const drawTickLabel = (x: number, y: number, text: string) => {
      const labelWidth = context.measureText(text).width;
      context.fillStyle = "rgba(4,20,17,.78)";
      context.fillRect(x - 3, y - tickFont, labelWidth + 6, tickFont + 5);
      context.fillStyle = "#b9d5cb";
      context.fillText(text, x, y);
    };

    let leftGutter = 0;
    for (let value = Math.ceil((verticalMax - vSpan) / step) * step; value <= verticalMax; value += step) {
      const y = toCanvas(0, value).y;
      const zero = Math.abs(value) < step / 1000;
      context.strokeStyle = zero ? "rgba(255,255,255,.32)" : "rgba(255,255,255,.1)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(plotLeft, y);
      context.lineTo(plotLeft + plotWidth, y);
      context.stroke();
      if (y < tickFont + 4 || y > plotHeight - bottomBand) continue;
      const label = formatCoordinate(value, step);
      leftGutter = Math.max(leftGutter, context.measureText(label).width + 12);
      drawTickLabel(7, y - 4, label);
    }
    for (let value = Math.ceil(horizontalMin / step) * step; value <= horizontalMin + hSpan; value += step) {
      const x = toCanvas(value, 0).x;
      const zero = Math.abs(value) < step / 1000;
      context.strokeStyle = zero ? "rgba(255,255,255,.32)" : "rgba(255,255,255,.1)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, plotTop);
      context.lineTo(x, plotTop + plotHeight);
      context.stroke();
      if (x < leftGutter) continue;
      drawTickLabel(x + 4, plotHeight - 7, formatCoordinate(value, step));
    }
    context.restore();

    // --- 선택한 경계의 치수 -------------------------------------------
    if (activeSurface) {
      const v = activeSurface.values;
      const dimensionColor = "#ffb15c";
      const labelFont = Math.max(11, rootFont * 0.72);
      const drawLabel = (x: number, y: number, text: string) => {
        context.font = `600 ${labelFont}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        const labelWidth = context.measureText(text).width + labelFont * 1.1;
        const boxHeight = labelFont * 1.7;
        const left = Math.max(6, Math.min(width - labelWidth - 6, x - labelWidth / 2));
        const top = Math.max(6, Math.min(height - boxHeight - 6, y - boxHeight - 6));
        context.fillStyle = "rgba(5, 20, 17, .92)";
        context.fillRect(left, top, labelWidth, boxHeight);
        context.strokeStyle = dimensionColor;
        context.lineWidth = 1;
        context.strokeRect(left + 0.5, top + 0.5, labelWidth - 1, boxHeight - 1);
        context.fillStyle = "#ffe0b8";
        context.fillText(text, left + labelFont * 0.55, top + boxHeight * 0.7);
      };
      const drawDimension = (start: { x: number; y: number }, end: { x: number; y: number }, label: string) => {
        context.strokeStyle = dimensionColor;
        context.fillStyle = dimensionColor;
        context.lineWidth = 1.5;
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        for (const point of [start, end]) {
          context.beginPath();
          context.arc(point.x, point.y, 3, 0, Math.PI * 2);
          context.fill();
        }
        drawLabel((start.x + end.x) / 2, (start.y + end.y) / 2, label);
      };

      context.save();
      context.strokeStyle = dimensionColor;
      context.lineWidth = 2;
      context.setLineDash([6, 3]);

      if (basis === "xy" && ["cyl", "cylz", "sqc"].includes(activeSurface.type)) {
        const centerX = v[0] ?? 0;
        const centerY = v[1] ?? 0;
        const radius = v.at(-1) ?? 0;
        const center = toCanvas(centerX, centerY);
        const edge = toCanvas(centerX + radius, centerY);
        if (activeSurface.type === "sqc") {
          const topLeft = toCanvas(centerX - radius, centerY + radius);
          const bottomRight = toCanvas(centerX + radius, centerY - radius);
          context.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        } else {
          context.beginPath();
          context.ellipse(center.x, center.y, radius * scale, radius * scale, 0, 0, Math.PI * 2);
          context.stroke();
        }
        drawDimension(center, edge, `${activeSurface.id} · ${activeSurface.type === "sqc" ? "반폭" : "R"} ${radius.toFixed(3)} cm`);
      } else if (basis === "xy" && activeSurface.type === "pad") {
        const angle = ((((v[4] ?? 0) + (v[5] ?? 360)) / 2) * Math.PI) / 180;
        const centerX = v[0] ?? 0;
        const centerY = v[1] ?? 0;
        const inner = v[2] ?? 0;
        const outer = v[3] ?? 0;
        drawDimension(
          toCanvas(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner),
          toCanvas(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer),
          `${activeSurface.id} · R ${inner.toFixed(2)}–${outer.toFixed(2)} cm`,
        );
      } else if (basis === "xy" && activeSurface.type === "sph") {
        const fullRadius = v[3] ?? 0;
        const sectionRadius = Math.sqrt(Math.max(0, fullRadius ** 2 - (slice - (v[2] ?? 0)) ** 2));
        const center = toCanvas(v[0] ?? 0, v[1] ?? 0);
        const edge = toCanvas((v[0] ?? 0) + sectionRadius, v[1] ?? 0);
        context.beginPath();
        context.ellipse(center.x, center.y, sectionRadius * scale, sectionRadius * scale, 0, 0, Math.PI * 2);
        context.stroke();
        drawDimension(center, edge, `${activeSurface.id} · 단면 R ${sectionRadius.toFixed(3)} cm`);
      } else {
        const isVerticalPlane =
          (basis === "xy" && activeSurface.type === "px") ||
          (basis === "xz" && activeSurface.type === "px") ||
          (basis === "yz" && activeSurface.type === "py");
        const isHorizontalPlane =
          (basis === "xy" && activeSurface.type === "py") ||
          ((basis === "xz" || basis === "yz") && activeSurface.type === "pz");

        if (isVerticalPlane) {
          const coordinate = v[0] ?? 0;
          const lineX = toCanvas(coordinate, 0).x;
          context.beginPath();
          context.moveTo(lineX, plotTop);
          context.lineTo(lineX, plotTop + plotHeight);
          context.stroke();
          drawDimension(toCanvas(0, 0), toCanvas(coordinate, 0), `${activeSurface.id} · d ${Math.abs(coordinate).toFixed(3)} cm`);
        } else if (isHorizontalPlane) {
          const coordinate = v[0] ?? 0;
          const lineY = toCanvas(0, coordinate).y;
          context.beginPath();
          context.moveTo(plotLeft, lineY);
          context.lineTo(plotLeft + plotWidth, lineY);
          context.stroke();
          drawDimension(toCanvas(0, 0), toCanvas(0, coordinate), `${activeSurface.id} · d ${Math.abs(coordinate).toFixed(3)} cm`);
        } else if ((basis === "xz" || basis === "yz") && ["cyl", "cylz"].includes(activeSurface.type)) {
          const centerCoordinate = basis === "xz" ? (v[0] ?? 0) : (v[1] ?? 0);
          const radius = v.at(-1) ?? 0;
          const leftX = toCanvas(centerCoordinate - radius, 0).x;
          const rightX = toCanvas(centerCoordinate + radius, 0).x;
          context.beginPath();
          context.moveTo(leftX, plotTop);
          context.lineTo(leftX, plotTop + plotHeight);
          context.moveTo(rightX, plotTop);
          context.lineTo(rightX, plotTop + plotHeight);
          context.stroke();
          drawDimension(toCanvas(centerCoordinate, 0), toCanvas(centerCoordinate + radius, 0), `${activeSurface.id} · R ${radius.toFixed(3)} cm`);
        } else {
          context.setLineDash([]);
          drawLabel(width * 0.72, labelFont * 3, `${activeSurface.id} · ${surfaceDetails(activeSurface).dimension}`);
        }
      }
      context.restore();
    }
  }, [model, basis, slice, view, size, activeSurface, highlight, draft, showProblems, outsideDefined]);

  function surfaceDetails(surface: (typeof visibleSurfaces)[number]) {
    const v = surface.values;
    if (surface.type === "cyl" || surface.type === "cylz") {
      const centerDistance = Math.hypot(v[0] ?? 0, v[1] ?? 0);
      return {
        position: `(${(v[0] ?? 0).toFixed(2)}, ${(v[1] ?? 0).toFixed(2)})`,
        dimension: `R ${(v.at(-1) ?? 0).toFixed(3)} · 중심거리 ${centerDistance.toFixed(3)}`,
      };
    }
    if (surface.type === "pad") {
      return {
        position: `(${(v[0] ?? 0).toFixed(2)}, ${(v[1] ?? 0).toFixed(2)})`,
        dimension: `R ${(v[2] ?? 0).toFixed(2)}–${(v[3] ?? 0).toFixed(2)} · ${v[4] ?? 0}°–${v[5] ?? 0}°`,
      };
    }
    if (surface.type === "pz") {
      return { position: `z = ${(v[0] ?? 0).toFixed(3)}`, dimension: `원점거리 ${Math.abs(v[0] ?? 0).toFixed(3)}` };
    }
    if (surface.type === "sph") {
      return {
        position: `(${(v[0] ?? 0).toFixed(1)}, ${(v[1] ?? 0).toFixed(1)}, ${(v[2] ?? 0).toFixed(1)})`,
        dimension: `R ${(v[3] ?? 0).toFixed(3)}`,
      };
    }
    if (surface.type === "sqc") {
      return {
        position: `(${(v[0] ?? 0).toFixed(2)}, ${(v[1] ?? 0).toFixed(2)})`,
        dimension: `반폭 ${(v.at(-1) ?? 0).toFixed(3)}`,
      };
    }
    return { position: `${surface.type} = ${(v[0] ?? 0).toFixed(3)}`, dimension: `원점거리 ${Math.abs(v[0] ?? 0).toFixed(3)}` };
  }

  const hoverColor = hover ? materialColor(model, hover.material) : null;

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <span className="toolbar-label">단면</span>
        <div className="segmented">
          {(["xy", "xz", "yz"] as PlotBasis[]).map((item) => (
            <button className={basis === item ? "active" : ""} key={item} onClick={() => changeBasis(item)}>
              {item.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="slice-control">
          <span className="slice-axis">{axisNames[2]} =</span>
          <input
            type="range"
            min={sliceRange.min}
            max={sliceRange.max}
            step={sliceRange.step}
            value={slice}
            aria-label={`${axisNames[2]} 단면 위치`}
            onChange={(event) => setSlice(Number(event.target.value))}
          />
          <input
            type="number"
            step={0.1}
            value={Number(slice.toFixed(4))}
            aria-label={`${axisNames[2]} 단면 좌표`}
            onChange={(event) => setSlice(Number(event.target.value))}
          />
          <span>cm</span>
        </label>
        <button
          type="button"
          className={showProblems ? "problem-toggle active" : "problem-toggle"}
          aria-pressed={showProblems}
          title="셀이 겹치거나 어떤 셀에도 속하지 않는 영역을 표시합니다."
          onClick={() => setShowProblems(!showProblems)}
        >
          <span className="problem-swatch" aria-hidden="true" />
          문제 영역
        </button>
        <div className="zoom-control">
          <button onClick={() => changeZoom(1 / 1.4)} aria-label="축소" title="축소">−</button>
          <span className="zoom-value">{(zoom * 100).toFixed(0)}%</span>
          <button onClick={() => changeZoom(1.4)} aria-label="확대" title="확대">＋</button>
          <button onClick={resetView} title="전체 보기로 되돌리기">전체</button>
        </div>
      </div>

      <div className={panning ? "canvas-wrap panning" : "canvas-wrap"} ref={wrap}>
        <canvas
          ref={canvas}
          aria-label={`Serpent 입력문에서 생성한 ${basis.toUpperCase()} 재료 평면도`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onPointerLeave={(event) => { endPan(event); setHover(null); }}
        />
        <div className="canvas-hint">휠 확대 · 드래그 이동</div>
      </div>

      <div className="canvas-readout">
        <span className="readout-axes">
          가로 {axisNames[0]} · 세로 {axisNames[1]} · 단면 {axisNames[2]} = {Number(slice.toFixed(3))} cm
        </span>
        {hover ? (
          <>
            <span>{axisNames[0]} <b>{hover.horizontal.toFixed(3)}</b></span>
            <span>{axisNames[1]} <b>{hover.vertical.toFixed(3)}</b></span>
            {hover.overlap.length > 1 && (
              <span className="readout-problem">겹침: {hover.overlap.join(" · ")}</span>
            )}
            {hover.status === "undefined" && outsideDefined && (
              <span className="readout-problem">빈틈 — 어떤 셀에도 속하지 않음</span>
            )}
            <span className="readout-material">
              <i style={{ background: hoverColor ? `rgb(${hoverColor.join(",")})` : "transparent" }} />
              {hover.material
                || (hover.status === "outside" ? "outside (계산 영역 바깥)"
                  : hover.status === "unsupported" ? "미지원 구조(lat 등)"
                  : "정의되지 않은 공간")}
            </span>
          </>
        ) : (
          <span className="readout-idle">도면 위에 커서를 올리면 좌표와 물질이 표시됩니다.</span>
        )}
      </div>

      <div className="preview-details">
        <div className="legend-block">
          <div className="legend-title">
            <strong>물질 색상</strong>
            <small>클릭하면 해당 물질만 강조합니다.</small>
          </div>
          <div className="material-strip">
            {usedMaterials.map((name) => {
              const color = materialColor(model, name) ?? VOID_COLOR;
              return (
                <button
                  key={name}
                  className={highlight && highlight !== name ? "dimmed" : ""}
                  onClick={() => setHighlight(highlight === name ? "" : name)}
                >
                  <i style={{ background: `rgb(${color.join(",")})` }} />
                  {name}
                </button>
              );
            })}
            {!usedMaterials.length && <span className="no-preview">정의된 물질이 없습니다.</span>}
          </div>
          {showProblems && (
            <p className="problem-legend">
              <span className="problem-swatch hatched" aria-hidden="true" />
              빗금은 <strong>셀 겹침</strong> — Serpent는 오류 없이 먼저 정의된 셀만 사용합니다.
              <span className="problem-swatch solid" aria-hidden="true" />
              단색은 <strong>빈틈</strong> — 실행 중 지오메트리 오류가 납니다.
              {!outsideDefined && " (outside 셀이 없어 빈틈 표시는 꺼져 있습니다.)"}
            </p>
          )}
        </div>

        <div className="legend-block">
          <div className="legend-title">
            <strong>{basis.toUpperCase()} 단면 경계 {visibleSurfaces.length}개</strong>
            <small>행을 선택하면 도면에 치수가 표시됩니다.</small>
          </div>
          {visibleSurfaces.length ? (
            <table className="dimension-table">
              <thead>
                <tr>
                  <th>경계</th><th>형식</th><th>기준 위치</th><th>치수 / 거리</th>
                </tr>
              </thead>
              <tbody>
                {visibleSurfaces.map((surface) => {
                  const details = surfaceDetails(surface);
                  return (
                    <tr
                      key={surface.id}
                      className={activeSurfaceId === surface.id ? "active" : ""}
                      onClick={() => setActiveSurfaceId(surface.id)}
                    >
                      <td className="name">{surface.id}</td>
                      <td><span className="type-tag">{surface.type}</span></td>
                      <td>{details.position}</td>
                      <td>{details.dimension}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="no-preview">현재 단면과 교차하는 지원 표면이 없습니다.</p>
          )}
        </div>

        <p className="preview-note">
          이 평면도는 결과 이미지가 아니라 입력문의 표면·셀 Boolean 조건과 물질 색을 픽셀별로 계산해 생성합니다.
          격자(lat)와 좌표 변환(trans)은 아직 반영되지 않습니다.
        </p>
      </div>
    </div>
  );
}

const SPECTRUM_WIDTH = 640;
const SPECTRUM_HEIGHT = 220;
const SPECTRUM_PAD = { left: 54, right: 12, top: 12, bottom: 34 };

/** 군 단위 중성자속을 로그-로그 계단 경로와 눈금으로 환산한다. */
function buildSpectrumPath(bins: ResultCase["spectrum"]) {
  const width = SPECTRUM_WIDTH;
  const height = SPECTRUM_HEIGHT;
  const pad = SPECTRUM_PAD;

  {
    const usable = bins.filter((bin) => bin.perLethargy > 0);
    if (usable.length < 2) return null;

    const eMin = Math.log10(usable[0].low);
    const eMax = Math.log10(usable[usable.length - 1].high);
    const fluxMax = Math.log10(Math.max(...usable.map((bin) => bin.perLethargy)));
    // 아래로 4 decade 만 보여주면 열·고속 봉우리 구조가 가장 잘 드러난다.
    const fluxMin = fluxMax - 4;

    const x = (energy: number) =>
      pad.left + ((Math.log10(energy) - eMin) / (eMax - eMin)) * (width - pad.left - pad.right);
    const y = (flux: number) => {
      const clamped = Math.max(fluxMin, Math.log10(flux));
      return height - pad.bottom - ((clamped - fluxMin) / (fluxMax - fluxMin)) * (height - pad.top - pad.bottom);
    };

    // 군 단위 값이므로 곡선이 아니라 계단으로 그려야 물리적으로 정확하다.
    const steps: string[] = [];
    usable.forEach((bin, index) => {
      const top = y(bin.perLethargy);
      steps.push(`${index === 0 ? "M" : "L"}${x(bin.low).toFixed(1)} ${top.toFixed(1)}`);
      steps.push(`L${x(bin.high).toFixed(1)} ${top.toFixed(1)}`);
    });

    const ticks: { at: number; label: string }[] = [];
    for (let decade = Math.ceil(eMin); decade <= Math.floor(eMax); decade += 1) {
      if (decade % 2 !== 0) continue;
      ticks.push({ at: x(10 ** decade), label: `1e${decade}` });
    }

    return { d: steps.join(" "), ticks, baseline: y(10 ** fluxMin) };
  }
}

function SpectrumChart({ bins }: { bins: ResultCase["spectrum"] }) {
  const width = SPECTRUM_WIDTH;
  const height = SPECTRUM_HEIGHT;
  const pad = SPECTRUM_PAD;
  const path = useMemo(() => buildSpectrumPath(bins), [bins]);

  if (!path) return null;

  return (
    <svg className="spectrum-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="중성자속 스펙트럼">
      <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className="axis" />
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className="axis" />
      {path.ticks.map((tick) => (
        <g key={tick.label}>
          <line x1={tick.at} y1={height - pad.bottom} x2={tick.at} y2={height - pad.bottom + 4} className="axis" />
          <text x={tick.at} y={height - pad.bottom + 16} className="tick">{tick.label}</text>
        </g>
      ))}
      <text x={width / 2} y={height - 4} className="tick strong">에너지 (MeV)</text>
      <text x={12} y={height / 2} className="tick strong" transform={`rotate(-90 12 ${height / 2})`}>
        렙서지당 중성자속
      </text>
      <path d={path.d} className="spectrum-line" />
    </svg>
  );
}

function ResultsPanel({
  cases,
  referenceId,
  onPickReference,
  onOpen,
  onRemove,
}: {
  cases: ResultCase[];
  referenceId: string;
  onPickReference: (id: string) => void;
  onOpen: () => void;
  onRemove: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState("");

  const valid = useMemo(() => cases.filter((item) => !item.error), [cases]);
  const active = valid.find((item) => item.id === activeId) ?? valid[0];
  const worth = buildWorthTable(valid, referenceId);

  if (!cases.length) {
    return (
      <div className="results-pane empty">
        <div className="results-empty">
          <span className="results-empty-mark">◫</span>
          <h2>Serpent 결과 파일을 불러오세요</h2>
          <p>
            계산이 끝나면 생기는 <code>*_res.m</code> 파일을 열면 keff·반응도·지발중성자분율 같은
            주요 결과가 자동으로 정리됩니다.
          </p>
          <p className="results-empty-hint">
            여러 개를 한꺼번에 선택하면 기준 케이스 대비 반응도가(Δρ)를 표로 비교합니다.
            제어봉·제어드럼 배치를 바꿔가며 돌린 계산을 비교할 때 쓰세요.
          </p>
          <button className="button primary" onClick={onOpen}>
            <Icon>↥</Icon> 결과 파일 열기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="results-pane">
      <div className="results-bar">
        <div className="results-tabs" role="tablist" aria-label="불러온 결과 파일">
          {cases.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={active?.id === item.id}
              className={`result-tab ${active?.id === item.id ? "active" : ""} ${item.error ? "broken" : item.worstStatus}`}
              onClick={() => setActiveId(item.id)}
              title={item.fileName}
            >
              <span className={`status-dot ${item.error ? "bad" : item.worstStatus}`} />
              <span className="result-tab-name">{item.label}</span>
              <span
                className="result-tab-close"
                role="button"
                tabIndex={0}
                aria-label={`${item.label} 닫기`}
                onClick={(event) => { event.stopPropagation(); onRemove(item.id); }}
                onKeyDown={(event) => { if (event.key === "Enter") { event.stopPropagation(); onRemove(item.id); } }}
              >×</span>
            </button>
          ))}
        </div>
        <button className="button ghost" onClick={onOpen}><Icon>＋</Icon> 추가</button>
      </div>

      {active?.error || !active ? (
        <p className="results-error">{cases.find((item) => item.error)?.error ?? "결과를 읽을 수 없습니다."}</p>
      ) : (
        <div className="results-body">
          <header className="results-head">
            <div>
              <span className="eyebrow">{active.version || "Serpent"} · {active.completeDate || "완료 시각 미상"}</span>
              <h1>{active.inputName || active.fileName}</h1>
              <p>
                {active.pop?.toLocaleString()}개 입자 × {active.activeCycles ?? "?"}회 활성 사이클
                {active.cycles !== undefined && ` (전체 ${active.cycles}회 중 ${active.skip}회 버림)`}
                {active.runningTime !== undefined && ` · ${(active.runningTime / 60).toFixed(1)}분 소요`}
              </p>
            </div>
            <span className={`health-badge ${active.worstStatus}`}>
              {active.worstStatus === "ok" ? "검증 통과" : active.worstStatus === "warn" ? "확인 필요" : "결과 사용 주의"}
            </span>
          </header>

          <section className="metric-row" aria-label="핵심 결과">
            <div className="metric primary">
              <span>실효증배계수 k<sub>eff</sub></span>
              <strong>{active.keff ? formatNumber(active.keff.value, 5) : "—"}</strong>
              <small>
                ± {active.keff ? (active.keff.abs * 1e5).toFixed(1) : "—"} pcm · {active.keffEstimator}
              </small>
            </div>
            <div className="metric">
              <span>반응도 ρ</span>
              <strong>{active.rho ? active.rho.value.toFixed(1) : "—"}<em>pcm</em></strong>
              <small>± {active.rho ? active.rho.abs.toFixed(1) : "—"} pcm</small>
            </div>
            <div className="metric">
              <span>반응도 (달러)</span>
              <strong>{active.dollars !== undefined ? active.dollars.toFixed(3) : "—"}<em>$</em></strong>
              <small>ρ / β<sub>eff</sub></small>
            </div>
            <div className="metric">
              <span>지발중성자분율 β<sub>eff</sub></span>
              <strong>{active.betaEff !== undefined ? (active.betaEff * 1e5).toFixed(0) : "—"}<em>pcm</em></strong>
              <small>{active.betaEff !== undefined ? formatNumber(active.betaEff, 6) : "—"}</small>
            </div>
            <div className="metric">
              <span>중성자 세대시간 Λ</span>
              <strong>{active.genTime !== undefined ? (active.genTime * 1e6).toFixed(2) : "—"}<em>μs</em></strong>
              <small>{active.genTimeEstimator || "—"}</small>
            </div>
          </section>

          <section className="results-section">
            <h2>계산 건전성</h2>
            <p className="section-note">
              값을 쓰기 전에 확인하는 항목입니다. 하나라도 실패하면 keff 자체를 신뢰할 수 없습니다.
            </p>
            <div className="check-grid">
              {active.checks.map((check) => (
                <div className={`check-item ${check.status}`} key={check.label}>
                  <span className={`status-dot ${check.status}`} />
                  <div>
                    <strong>{check.label}</strong>
                    <small>{check.detail}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {valid.length > 1 && (
            <section className="results-section">
              <h2>기준 대비 반응도가 (Δρ)</h2>
              <p className="section-note">
                제어드럼·제어봉 배치 연구의 최종 산출물입니다. 두 계산이 독립이므로 오차는 √(σ₁²+σ₂²)로 전파됩니다.
                기준보다 반응도가 낮으면 음수(삽입 효과)입니다.
              </p>
              <label className="reference-picker">
                <span>기준 케이스</span>
                <select value={referenceId} onChange={(event) => onPickReference(event.target.value)}>
                  {valid.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <div className="table-scroll">
                <table className="worth-table">
                  <thead>
                    <tr>
                      <th>케이스</th>
                      <th>k<sub>eff</sub></th>
                      <th>ρ (pcm)</th>
                      <th>Δρ (pcm)</th>
                      <th>Δρ ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worth.map((row) => (
                      <tr key={row.case.id} className={row.isReference ? "is-reference" : ""}>
                        <td>
                          <span className={`status-dot ${row.case.worstStatus}`} />
                          {row.case.label}
                          {row.isReference && <span className="ref-tag">기준</span>}
                        </td>
                        <td className="num">
                          {row.case.keff ? formatNumber(row.case.keff.value, 5) : "—"}
                          <small>±{row.case.keff ? (row.case.keff.abs * 1e5).toFixed(1) : "—"}</small>
                        </td>
                        <td className="num">{row.case.rho ? row.case.rho.value.toFixed(1) : "—"}</td>
                        <td className="num strong">
                          {row.isReference || row.deltaRho === undefined ? "—" : (
                            <>
                              {row.deltaRho > 0 ? "+" : ""}{row.deltaRho.toFixed(1)}
                              <small>±{row.sigma?.toFixed(1)}</small>
                            </>
                          )}
                        </td>
                        <td className="num">
                          {row.isReference || row.dollars === undefined
                            ? "—"
                            : `${row.dollars > 0 ? "+" : ""}${row.dollars.toFixed(3)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="results-section">
            <h2>노심 물리 특성</h2>
            <div className="physics-grid">
              {active.physics.map((row) => (
                <div className="physics-item" key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                  <small>{row.hint}</small>
                </div>
              ))}
            </div>
          </section>

          {active.spectrum.length > 0 && (
            <section className="results-section">
              <h2>중성자속 스펙트럼</h2>
              <p className="section-note">
                무한체계 70군 중성자속(INF_MICRO_FLX)을 단위 렙서지당 값으로 환산한 결과입니다.
              </p>
              <SpectrumChart bins={active.spectrum} />
            </section>
          )}

          <p className="preview-note">
            res.m 에서 값 뒤의 두 번째 숫자는 절대오차가 아니라 <strong>상대 표준편차</strong>입니다.
            이 화면의 ± 표기는 이미 값과 곱해 절대오차로 환산한 것입니다.
          </p>
        </div>
      )}
    </div>
  );
}
