"use client";

import {
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CardKind,
  getCardData,
  geometryPlotBounds,
  materialAtPoint,
  parseSerpentInput,
  parseGeometryModel,
  PlotBasis,
  SAMPLE_INPUT,
  serializeCards,
  SerpentCard,
  updateCard,
  validateSerpentInput,
} from "../lib/serpent";

const GROUPS = [
  "모델 개요",
  "형상 · 경계",
  "물질 · 핵데이터",
  "계산 모드 · 조건",
  "소스 · 검출기",
  "시각화 · 출력",
  "외부 파일 · 연동",
  "고급 카드",
] as const;

const GEOMETRY_CARDS = new Set(["pin", "nest", "lat", "particle", "pbed", "trans", "transa", "transv", "div"]);
const MATERIAL_CARDS = new Set(["therm", "thermstoch", "mix"]);
const SOURCE_CARDS = new Set(["ene", "fun"]);
const OUTPUT_CARDS = new Set(["mesh", "mplot"]);
const COUPLING_CARDS = new Set(["ifc", "umsh"]);
const LIBRARY_OPTIONS = new Set(["acelib", "declib", "nfylib", "bralib", "sfylib", "pdatadir"]);
const OUTPUT_OPTIONS = new Set(["outp", "printm", "title"]);

function cardCategory(card: SerpentCard) {
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
      syntax: "mat NAME DENS [OPTION …]\\nNUCLIDE FRACTION …",
      tips: ["음수 밀도는 g/cm³ 단위의 질량밀도, 양수는 원자밀도입니다.", "핵종 조성에서 원자 단위와 질량 단위를 섞지 마세요."],
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

export default function Home() {
  const [source, setSource] = useState(SAMPLE_INPUT);
  const [fileName, setFileName] = useState("pwr_pin.inp");
  const [selectedId, setSelectedId] = useState<string>("");
  const [view, setView] = useState<"builder" | "source">("builder");
  const [panel, setPanel] = useState<"preview" | "issues">("preview");
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const cards = useMemo(() => parseSerpentInput(source), [source]);
  const issues = useMemo(() => validateSerpentInput(cards), [cards]);
  const selected = cards.find((card) => card.id === selectedId) ?? cards.find((card) => card.kind === "surface") ?? cards[0];
  const selectedData = selected ? getCardData(selected) : {};
  const selectedGuide = selected ? guideForCard(selected, selectedData) : null;
  const errors = issues.filter((issue) => issue.level === "error").length;

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

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
    setPanel(issues.length ? "issues" : "preview");
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
          <input
            ref={fileInput}
            type="file"
            aria-label="SERPENT 입력문 선택"
            hidden
            onChange={openFile}
          />
          <button className="button ghost" onClick={() => fileInput.current?.click()}>
            <Icon>↥</Icon> 열기
          </button>
          <button className="button ghost" onClick={downloadInput}>
            <Icon>↓</Icon> 내보내기
          </button>
          <button className="button primary" onClick={runValidation}>
            <Icon>▶</Icon> 입력 검사
          </button>
        </div>
      </header>

      <section className={previewExpanded ? "workspace preview-expanded" : "workspace"}>
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
          <nav className="model-tree" aria-label="Serpent 카드">
            {GROUPS.map((group) => {
              const groupCards = cards.filter((card) => cardCategory(card) === group);
              if (!groupCards.length) return null;
              return (
                <div className="tree-group" key={group}>
                  <div className="tree-label">
                    <span>{group}</span>
                    <span>{groupCards.length}</span>
                  </div>
                  {groupCards.map((card) => (
                    <button
                      key={card.id}
                      className={selected?.id === card.id ? "tree-item active" : "tree-item"}
                      onClick={() => { setSelectedId(card.id); setView("builder"); }}
                    >
                      <span className={`kind-dot ${card.kind}`} />
                      <span className="tree-name">{card.label || card.keyword}</span>
                      <span className="tree-line">L{card.startLine}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="project-health">
            <div className="health-row">
              <span>모델 상태</span>
              <strong className={errors ? "bad" : "good"}>{errors ? `${errors} 오류` : "정상"}</strong>
            </div>
            <div className="health-meter"><span style={{ width: errors ? "64%" : "100%" }} /></div>
            <small>{cards.length}개 카드 · Serpent 2 형식</small>
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
            <div className="undo-group">
              <button className="icon-button" title="샘플로 되돌리기" onClick={() => setSource(SAMPLE_INPUT)}>↶</button>
            </div>
          </div>

          {view === "source" ? (
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
                  <ul>
                    {selectedGuide.tips.map((tip) => <li key={tip}>{tip}</li>)}
                  </ul>
                  <a href={selectedGuide.url} target="_blank" rel="noreferrer">
                    공식 문법 보기 ↗
                  </a>
                </section>
              )}

              <div className="form-grid">
                {Object.entries(selectedData).map(([key, value]) => {
                  const wide = ["values", "region", "composition", "comment"].includes(key);
                  const multiline = key === "composition";
                  const hint = fieldHint(selected, key, selectedData);
                  return (
                    <label className={wide ? "field wide" : "field"} key={`${selected.id}-${key}`}>
                      <span>{fieldLabel(selected, key)}</span>
                      {multiline ? (
                        <textarea
                          value={value}
                          spellCheck={false}
                          onChange={(event) => handleField(key, event.target.value)}
                        />
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
          <div className="inspector-tabs">
            <button className={panel === "preview" ? "active" : ""} onClick={() => setPanel("preview")}>형상 미리보기</button>
            <button className={panel === "issues" ? "active" : ""} onClick={() => setPanel("issues")}>
              검사 결과 <span>{issues.length}</span>
            </button>
            <button
              className="panel-expand"
              aria-label={previewExpanded ? "편집 화면과 함께 보기" : "평면도 넓게 보기"}
              aria-pressed={previewExpanded}
              title={previewExpanded ? "편집 화면과 함께 보기" : "평면도 넓게 보기"}
              onClick={() => {
                setPanel("preview");
                setPreviewExpanded(!previewExpanded);
              }}
            >
              {previewExpanded ? "⇥" : "⇤"}
            </button>
          </div>
          {panel === "preview" ? (
            <GeometryPreview
              cards={cards}
              expanded={previewExpanded}
              selectedSurfaceId={selected?.kind === "surface" ? selectedData.name : ""}
            />
          ) : (
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
          )}
        </aside>
      </section>

      <footer className="statusbar">
        <div><span className={errors ? "status-light error" : "status-light"} /> {errors ? "검사 필요" : "기본 검증 통과"}</div>
        <div className="status-center"><span>Surfaces {cards.filter((c) => c.kind === "surface").length}</span><span>Cells {cards.filter((c) => c.kind === "cell").length}</span><span>Materials {cards.filter((c) => c.kind === "material").length}</span></div>
        <button onClick={() => setLogOpen(!logOpen)}>⌃ 실행 콘솔</button>
      </footer>

      {logOpen && (
        <div className={previewExpanded ? "console preview-expanded" : "console"}>
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

function GeometryPreview({
  cards,
  expanded,
  selectedSurfaceId,
}: {
  cards: SerpentCard[];
  expanded: boolean;
  selectedSurfaceId: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [basis, setBasis] = useState<PlotBasis>("xy");
  const [slice, setSlice] = useState(0);
  const [activeSurfaceId, setActiveSurfaceId] = useState("");
  const model = useMemo(() => parseGeometryModel(cards), [cards]);
  const bounds = useMemo(() => geometryPlotBounds(model, basis), [model, basis]);
  const axisNames = basis === "xy" ? ["X", "Y", "z"] : basis === "xz" ? ["X", "Z", "y"] : ["Y", "Z", "x"];

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

  const activeSurface = visibleSurfaces.find((surface) => surface.id === activeSurfaceId);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = element.clientWidth;
    const height = element.clientHeight;
    element.width = width * ratio;
    element.height = height * ratio;
    context.scale(ratio, ratio);
    const hSpan = bounds.horizontalMax - bounds.horizontalMin;
    const vSpan = bounds.verticalMax - bounds.verticalMin;
    const scale = Math.min(width / hSpan, height / vSpan);
    const plotWidth = hSpan * scale;
    const plotHeight = vSpan * scale;
    const plotLeft = (width - plotWidth) / 2;
    const plotTop = (height - plotHeight) / 2;
    const pixelDensity = Math.min(ratio, 768 / Math.max(plotWidth, plotHeight));
    const rasterWidth = Math.max(1, Math.round(plotWidth * pixelDensity));
    const rasterHeight = Math.max(1, Math.round(plotHeight * pixelDensity));
    const raster = document.createElement("canvas");
    raster.width = rasterWidth;
    raster.height = rasterHeight;
    const rasterContext = raster.getContext("2d");
    if (!rasterContext) return;
    const image = rasterContext.createImageData(rasterWidth, rasterHeight);
    const toCanvas = (horizontal: number, vertical: number) => ({
      x: plotLeft + (horizontal - bounds.horizontalMin) * scale,
      y: plotTop + (bounds.verticalMax - vertical) * scale,
    });

    for (let py = 0; py < rasterHeight; py += 1) {
      const vertical = bounds.verticalMax - (py + 0.5) / rasterHeight * vSpan;
      for (let px = 0; px < rasterWidth; px += 1) {
        const horizontal = bounds.horizontalMin + (px + 0.5) / rasterWidth * hSpan;
        const [x, y, z] =
          basis === "xy" ? [horizontal, vertical, slice] :
          basis === "xz" ? [horizontal, slice, vertical] :
          [slice, horizontal, vertical];
        const materialName = materialAtPoint(model, x, y, z);
        const material = model.materials.get(materialName);
        const offset = (py * rasterWidth + px) * 4;
        image.data[offset] = material?.color[0] ?? 4;
        image.data[offset + 1] = material?.color[1] ?? 16;
        image.data[offset + 2] = material?.color[2] ?? 13;
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
        const middle = (start + end) / 2 * Math.PI / 180;
        const middleRadius = ((v[2] ?? 0) + (v[3] ?? 0)) / 2;
        const sampleX = (v[0] ?? 0) + Math.cos(middle) * middleRadius;
        const sampleY = (v[1] ?? 0) + Math.sin(middle) * middleRadius;
        const materialName = materialAtPoint(model, sampleX, sampleY, slice);
        if (!materialName) continue;
        const color = model.materials.get(materialName)?.color ?? [234, 84, 85];
        const points: { x: number; y: number }[] = [];
        const segments = 30;
        for (let index = 0; index <= segments; index += 1) {
          const angle = (start + (end - start) * index / segments) * Math.PI / 180;
          points.push(toCanvas(
            (v[0] ?? 0) + Math.cos(angle) * (v[3] ?? 0),
            (v[1] ?? 0) + Math.sin(angle) * (v[3] ?? 0),
          ));
        }
        for (let index = segments; index >= 0; index -= 1) {
          const angle = (start + (end - start) * index / segments) * Math.PI / 180;
          points.push(toCanvas(
            (v[0] ?? 0) + Math.cos(angle) * (v[2] ?? 0),
            (v[1] ?? 0) + Math.sin(angle) * (v[2] ?? 0),
          ));
        }
        context.beginPath();
        points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
        context.closePath();
        context.fillStyle = `rgb(${color.join(",")})`;
        context.fill();
        context.strokeStyle = "rgba(28, 48, 42, .65)";
        context.lineWidth = 0.6;
        context.stroke();
      }
    }

    context.strokeStyle = "rgba(255,255,255,.24)";
    context.lineWidth = 1;
    context.setLineDash([3, 4]);
    const zeroX = toCanvas(0, 0).x;
    const zeroY = toCanvas(0, 0).y;
    if (zeroX >= plotLeft && zeroX <= plotLeft + plotWidth) {
      context.beginPath(); context.moveTo(zeroX, plotTop); context.lineTo(zeroX, plotTop + plotHeight); context.stroke();
    }
    if (zeroY >= plotTop && zeroY <= plotTop + plotHeight) {
      context.beginPath(); context.moveTo(plotLeft, zeroY); context.lineTo(plotLeft + plotWidth, zeroY); context.stroke();
    }
    context.setLineDash([]);

    if (activeSurface) {
      const v = activeSurface.values;
      const dimensionColor = "#ffb15c";
      const drawLabel = (x: number, y: number, text: string) => {
        context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
        const labelWidth = context.measureText(text).width + 14;
        const left = Math.max(6, Math.min(width - labelWidth - 6, x - labelWidth / 2));
        const top = Math.max(6, Math.min(height - 25, y - 22));
        context.fillStyle = "rgba(5, 20, 17, .9)";
        context.fillRect(left, top, labelWidth, 19);
        context.strokeStyle = dimensionColor;
        context.lineWidth = 1;
        context.strokeRect(left + 0.5, top + 0.5, labelWidth - 1, 18);
        context.fillStyle = "#ffe0b8";
        context.fillText(text, left + 7, top + 13);
      };
      const drawDimension = (
        start: { x: number; y: number },
        end: { x: number; y: number },
        label: string,
      ) => {
        context.strokeStyle = dimensionColor;
        context.fillStyle = dimensionColor;
        context.lineWidth = 1.5;
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
          context.ellipse(
            center.x,
            center.y,
            radius * scale,
            radius * scale,
            0,
            0,
            Math.PI * 2,
          );
          context.stroke();
        }
        context.setLineDash([]);
        drawDimension(center, edge, `${activeSurface.id} · ${activeSurface.type === "sqc" ? "반폭" : "R"} ${radius.toFixed(3)} cm`);
      } else if (basis === "xy" && activeSurface.type === "pad") {
        const angle = ((v[4] ?? 0) + (v[5] ?? 360)) / 2 * Math.PI / 180;
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
        context.setLineDash([]);
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
          context.beginPath(); context.moveTo(lineX, plotTop); context.lineTo(lineX, plotTop + plotHeight); context.stroke();
          context.setLineDash([]);
          drawDimension(toCanvas(0, 0), toCanvas(coordinate, 0), `${activeSurface.id} · d ${Math.abs(coordinate).toFixed(3)} cm`);
        } else if (isHorizontalPlane) {
          const coordinate = v[0] ?? 0;
          const lineY = toCanvas(0, coordinate).y;
          context.beginPath(); context.moveTo(plotLeft, lineY); context.lineTo(plotLeft + plotWidth, lineY); context.stroke();
          context.setLineDash([]);
          drawDimension(toCanvas(0, 0), toCanvas(0, coordinate), `${activeSurface.id} · d ${Math.abs(coordinate).toFixed(3)} cm`);
        } else if ((basis === "xz" || basis === "yz") && ["cyl", "cylz"].includes(activeSurface.type)) {
          const centerCoordinate = basis === "xz" ? (v[0] ?? 0) : (v[1] ?? 0);
          const radius = v.at(-1) ?? 0;
          const leftX = toCanvas(centerCoordinate - radius, 0).x;
          const rightX = toCanvas(centerCoordinate + radius, 0).x;
          context.beginPath();
          context.moveTo(leftX, plotTop); context.lineTo(leftX, plotTop + plotHeight);
          context.moveTo(rightX, plotTop); context.lineTo(rightX, plotTop + plotHeight);
          context.stroke();
          context.setLineDash([]);
          drawDimension(toCanvas(centerCoordinate, 0), toCanvas(centerCoordinate + radius, 0), `${activeSurface.id} · R ${radius.toFixed(3)} cm`);
        } else {
          context.setLineDash([]);
          drawLabel(width * 0.72, 44, `${activeSurface.id} · ${surfaceDetails(activeSurface).dimension}`);
        }
      }
      context.restore();
    }

    context.fillStyle = "rgba(4, 22, 18, .82)";
    context.fillRect(7, 7, 126, 30);
    context.fillStyle = "#d7e7e0";
    context.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText(
      `${axisNames[0]} ${bounds.horizontalMin.toFixed(1)} … ${bounds.horizontalMax.toFixed(1)} cm`,
      13,
      19,
    );
    context.fillText(
      `${axisNames[1]} ${bounds.verticalMin.toFixed(1)} … ${bounds.verticalMax.toFixed(1)} cm`,
      13,
      31,
    );
  }, [model, basis, slice, bounds, axisNames, activeSurface, expanded]);

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

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <div className="segmented">
          {(["xy", "xz", "yz"] as PlotBasis[]).map((item) => (
            <button className={basis === item ? "active" : ""} key={item} onClick={() => setBasis(item)}>
              {item.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="slice-control">
          {axisNames[2]} =
          <input type="number" step="1" value={slice} onChange={(event) => setSlice(Number(event.target.value))} />
          cm
        </label>
        <span className="dimension-unit">단위 cm</span>
      </div>
      <div className="canvas-wrap">
        <canvas ref={canvas} aria-label={`Serpent 입력문에서 생성한 ${basis.toUpperCase()} 재료 평면도`} />
        <div className="axis x">{axisNames[0]}</div>
        <div className="axis y">{axisNames[1]}</div>
        <div className="source-badge">INPUT CSG</div>
      </div>
      <div className="legend">
        <div className="material-strip">
          {[...model.materials.values()].map((material) => (
            <span key={material.name}><i style={{ background: `rgb(${material.color.join(",")})` }} />{material.name}</span>
          ))}
        </div>
        <div className="legend-head">
          <div>
            <strong>{basis.toUpperCase()} 구분 경계</strong>
            <small>경계를 선택하면 도면에 거리가 표시됩니다.</small>
          </div>
          <span>{visibleSurfaces.length}</span>
        </div>
        <div className="dimension-table-head">
          <span>경계</span><span>형식</span><span>기준 위치</span><span>경계 치수 / 거리</span>
        </div>
        {visibleSurfaces.map((surface) => {
          const details = surfaceDetails(surface);
          return (
          <button
            className={activeSurfaceId === surface.id ? "dimension-row active" : "dimension-row"}
            key={surface.id}
            onClick={() => setActiveSurfaceId(surface.id)}
          >
            <span />
            <strong>{surface.id}</strong>
            <code>{surface.type}</code>
            <code>{details.position}</code>
            <code>{details.dimension}</code>
          </button>
        )})}
        {!visibleSurfaces.length && <p className="no-preview">현재 단면과 교차하는 지원 표면이 없습니다.</p>}
      </div>
      <p className="preview-note">이 평면도는 결과 이미지가 아니라 입력문의 표면·셀 Boolean 조건과 물질 RGB 값을 픽셀별로 계산해 생성합니다.</p>
    </div>
  );
}
