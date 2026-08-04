"use client";

import {
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  forwardRef,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
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
  padAngleRange,
  parseSerpentInput,
  parseGeometryModel,
  parseNuclideId,
  PlotBasis,
  PointStatus,
  SAMPLE_INPUT,
  serializeCards,
  SerpentCard,
  updateCard,
  ValidationIssue,
  validateSerpentInput,
  VOID_COLOR,
} from "../lib/serpent";
import {
  buildResultCase,
  buildWorthTable,
  formatNumber,
  ResultCase,
} from "../lib/results";
import {
  EMPTY_SUMMARY_META,
  renderSpectrumSvg,
  renderSummaryMarkdown,
  SPECTRUM_SVG_HEIGHT,
  SPECTRUM_SVG_WIDTH,
  summaryFileName,
  SummaryGeometryImage,
  SummaryImagePlan,
  SummaryMeta,
  tCheck,
  tError,
  tPhysicsHint,
  tPhysicsLabel,
} from "../lib/summary";
import {
  IngestedFile,
  ingest,
  pairKey,
  readDropped,
  readFiles,
} from "../lib/pairing";
import {
  Detector,
  detectorBaseName,
  detectorToSpectrumBins,
  isDetectorFileName,
  looksLikeDetectorFile,
  parseDetectorFile,
} from "../lib/detectors";
import { translateUi, UiLocale } from "../lib/i18n";

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

function fieldLabel(card: SerpentCard, key: string, locale: UiLocale) {
  const L = (ko: string, en: string) => (locale === "en" ? en : ko);
  const labels: Record<string, string> = {
    name:
      card.kind === "surface" ? L("표면 이름", "Surface name") :
      card.kind === "cell" ? L("셀 이름", "Cell name") :
      card.kind === "material" ? L("물질 이름", "Material name") : L("옵션", "Option"),
    type: L("표면 형식", "Surface type"),
    values: card.kind === "surface" ? L("파라미터", "Parameters") : L("값", "Value"),
    universe: "Universe",
    material: L("물질 / Fill", "Material / Fill"),
    region: L("영역 표현식", "Region expression"),
    density: L("밀도", "Density"),
    options: L("물질 옵션", "Material options"),
    composition: L("핵종 조성", "Nuclide composition"),
    comment: L("설명", "Comment"),
  };
  return labels[key] ?? key;
}

/** 사이드바 항목에 표시할 이름과 한 줄 요약. */
function cardSummary(card: SerpentCard, locale: UiLocale) {
  const L = (ko: string, en: string) => (locale === "en" ? en : ko);
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
    return { name: data.name || card.keyword, meta: `${unit} · ${L(`핵종 ${nuclides}`, `${nuclides} nuclides`)}` };
  }
  if (card.kind === "title") {
    return { name: data.values || L("제목 없음", "Untitled"), meta: "set title" };
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

function surfaceParameterHint(type: string, locale: UiLocale) {
  const L = (ko: string, en: string) => (locale === "en" ? en : ko);
  return {
    px: L("x₀ — x축에 수직인 평면의 위치", "x₀ — position of the plane perpendicular to the x-axis"),
    py: L("y₀ — y축에 수직인 평면의 위치", "y₀ — position of the plane perpendicular to the y-axis"),
    pz: L("z₀ — z축에 수직인 평면의 위치", "z₀ — position of the plane perpendicular to the z-axis"),
    cyl: L("x₀  y₀  r — z축과 평행한 원통의 중심과 반지름", "x₀  y₀  r — center and radius of a cylinder parallel to the z-axis"),
    cylz: L("x₀  y₀  r — z축과 평행한 원통의 중심과 반지름", "x₀  y₀  r — center and radius of a cylinder parallel to the z-axis"),
    sph: L("x₀  y₀  z₀  r — 구의 중심과 반지름", "x₀  y₀  z₀  r — center and radius of a sphere"),
    sqc: L(
      "x₀  y₀  r [r₀] — 정사각 기둥의 중심, 반폭, 선택적 모서리 반경",
      "x₀  y₀  r [r₀] — center and half-width of a square prism, with an optional corner radius",
    ),
    pad: L(
      "x₀  y₀  r₁  r₂  α₁  α₂ — 원환 부채꼴의 중심, 내·외반경, 시작·끝 각도(°)",
      "x₀  y₀  r₁  r₂  α₁  α₂ — center, inner/outer radius, and start/end angle (°) of an annular sector",
    ),
    cuboid: L(
      "x₁  x₂  y₁  y₂  z₁  z₂ — 직육면체의 각 축 최소·최대 좌표",
      "x₁  x₂  y₁  y₂  z₁  z₂ — min/max coordinates on each axis of a cuboid",
    ),
    plane: L("A  B  C  D — Ax + By + Cz = D 형태의 일반 평면", "A  B  C  D — a general plane of the form Ax + By + Cz = D"),
  }[type.toLowerCase()] ?? L(
    "선택한 표면 형식에 맞는 좌표와 치수를 cm 단위로 입력합니다.",
    "Enter the coordinates and dimensions in cm that match the selected surface type.",
  );
}

function guideForCard(card: SerpentCard, data: Record<string, string>, locale: UiLocale): CardGuide {
  const L = (ko: string, en: string) => (locale === "en" ? en : ko);
  const keyword = card.keyword.toLowerCase();
  const option = data.name?.toLowerCase() ?? "";

  if (card.kind === "surface") {
    return {
      title: L("표면은 셀의 경계를 만듭니다", "A surface defines the boundary of a cell"),
      description: L(
        "표면 자체에는 물질이 없으며, 셀 카드가 표면의 양·음 방향을 조합해 실제 공간을 정의합니다.",
        "A surface has no material of its own — cell cards combine its positive and negative sides to define actual space.",
      ),
      syntax: "surf NAME TYPE PARAM₁ PARAM₂ …",
      tips: [
        surfaceParameterHint(data.type ?? "", locale),
        L("표면 이름은 cell, det, 변환 카드에서 다시 참조할 수 있습니다.", "The surface name can be referenced again from cell, det, and transformation cards."),
      ],
      url: "https://serpent.vtt.fi/docs/extra/csg_surfaces.html",
    };
  }
  if (card.kind === "cell") {
    return {
      title: L("셀은 공간에 물질 또는 다른 유니버스를 배치합니다", "A cell places a material or another universe in space"),
      description: L(
        "표면 번호의 부호와 Boolean 연산으로 닫힌 영역을 만들고, 그 영역을 물질·void·outside 또는 fill 유니버스로 채웁니다.",
        "Surface signs and Boolean operations form a closed region, which is then filled with a material, void, outside, or a fill universe.",
      ),
      syntax: "cell NAME UNI MAT  SURF₁ SURF₂ …",
      tips: [
        L("음수 표면은 음의 면(일반적으로 내부), 양수 표면은 양의 면을 선택합니다.", "A negative surface selects its negative side (usually the interior); a positive surface selects its positive side."),
        L("공백은 교집합, 콜론(:)은 합집합, 괄호는 연산 그룹을 뜻합니다.", "A space means intersection, a colon (:) means union, and parentheses group operations."),
      ],
      url: `${SYNTAX_MANUAL}#cell`,
    };
  }
  if (card.kind === "material") {
    return {
      title: L("물질은 밀도와 핵종 조성을 정의합니다", "A material defines density and nuclide composition"),
      description: L(
        "수송 중 입자의 국소 상호작용 확률은 물질의 밀도, 온도 및 핵종 조성으로 결정됩니다.",
        "A particle's local interaction probability during transport is determined by the material's density, temperature, and nuclide composition.",
      ),
      syntax: "mat NAME DENS [OPTION …]\nNUCLIDE FRACTION …",
      tips: [
        L("음수 밀도는 g/cm³ 단위의 질량밀도, 양수는 원자밀도입니다.", "A negative density is mass density in g/cm³; a positive value is atomic density."),
        L("핵종 조성에서 원자 단위와 질량 단위를 섞지 마세요.", "Don't mix atomic and mass units within the nuclide composition."),
        L(
          "핵종 이름은 ZAID.라이브러리 형식입니다. 예: 92235.09c → Z=92(우라늄) A=235 → U-235, '09c'는 라이브러리 ID 09 · 연속에너지 중성자 데이터를 뜻합니다.",
          "Nuclide names use the ZAID.library format. Example: 92235.09c → Z=92 (uranium) A=235 → U-235, where '09c' means library ID 09, continuous-energy neutron data.",
        ),
      ],
      url: `${SYNTAX_MANUAL}#mat`,
    };
  }
  if (card.kind === "title") {
    return {
      title: L("계산 사례를 알아보기 쉬운 이름으로 지정합니다", "Give the calculation case a recognizable name"),
      description: L(
        "제목은 실행 중 출력과 표준 결과 파일에 기록됩니다. 생략하면 입력 파일명이 대신 사용됩니다.",
        "The title is recorded in the run output and the standard result file. If omitted, the input file name is used instead.",
      ),
      syntax: 'set title "NAME"',
      tips: [L("공백이나 특수문자가 포함된 제목은 따옴표로 감쌉니다.", "Wrap a title containing spaces or special characters in quotes.")],
      url: `${SYNTAX_MANUAL}#set-title`,
    };
  }
  if (card.kind === "setting" && option === "pop") {
    return {
      title: L("임계도 계산의 입자 수와 세대 수를 정합니다", "Sets the particle and generation counts for a criticality calculation"),
      description: L(
        "세대당 중성자 수, 활성 세대, 비활성 세대를 지정하며 이 카드가 있으면 임계도 소스 계산 모드가 선택됩니다.",
        "Specifies neutrons per generation, active generations, and inactive generations; having this card selects criticality source mode.",
      ),
      syntax: "set pop NPG NGEN NSKIP [K₀ BTCH NCRIT]",
      tips: [
        L("NPG는 세대당 중성자 수, NGEN은 활성 세대, NSKIP은 초기 비활성 세대입니다.", "NPG is neutrons per generation, NGEN is active generations, and NSKIP is the initial inactive generations."),
        L("외부 소스 계산용 set nps와 동시에 사용할 수 없습니다.", "Cannot be used together with set nps, which is for external-source calculations."),
      ],
      url: `${SYNTAX_MANUAL}#set-pop`,
    };
  }
  if (card.kind === "setting" && option === "nps") {
    return {
      title: L("외부 소스 계산의 총 입자 이력 수를 정합니다", "Sets the total particle-history count for an external-source calculation"),
      description: L(
        "총 입자 이력과 선택적 배치 수를 지정하며, 이 카드가 있으면 외부 소스 모드가 선택됩니다.",
        "Specifies the total particle histories and an optional batch count; having this card selects external-source mode.",
      ),
      syntax: "set nps NP [BTCH TBI]",
      tips: [
        L("NP는 전체 입자 이력 수입니다.", "NP is the total number of particle histories."),
        L("임계도 계산용 set pop과 동시에 사용할 수 없습니다.", "Cannot be used together with set pop, which is for criticality calculations."),
      ],
      url: `${SYNTAX_MANUAL}#set-nps`,
    };
  }
  if (card.kind === "setting" && option === "bc") {
    return {
      title: L("입자가 외부 경계를 통과할 때의 처리를 정합니다", "Sets how particles are handled when they cross the outer boundary"),
      description: L(
        "모든 방향에 하나의 조건을 적용하거나 x·y·z 방향별 조건을 지정할 수 있습니다.",
        "You can apply one condition to all directions, or set a separate condition for each of the x, y, and z directions.",
      ),
      syntax: L("set bc MODE [ALB]  또는  set bc MODEₓ MODEᵧ MODE𝓏 [ALB]", "set bc MODE [ALB]  or  set bc MODEₓ MODEᵧ MODE𝓏 [ALB]"),
      tips: [
        L("1 = 흡수(black), 2 = 반사(reflective), 3 = 주기(periodic) 경계입니다.", "1 = black (absorbing), 2 = reflective, 3 = periodic boundary."),
        L("반사·주기 조건은 반복 가능한 외곽 표면에서 사용해야 합니다.", "Reflective and periodic conditions must be used on outer surfaces that are actually repeatable."),
      ],
      url: `${SYNTAX_MANUAL}#set-bc`,
    };
  }
  if (card.kind === "setting" && LIBRARY_OPTIONS.has(option)) {
    return {
      title: L("Serpent가 사용할 핵데이터 라이브러리 경로를 지정합니다", "Specifies the nuclear data library path Serpent will use"),
      description: L(
        "단면적·붕괴·핵분열 수율 등 계산에 필요한 외부 데이터 파일을 연결하는 옵션입니다.",
        "An option that links the external data files needed for the calculation — cross sections, decay, fission yields, and so on.",
      ),
      syntax: `set ${option} "LIB₁" ["LIB₂" …]`,
      tips: [
        L(
          "SERPENT_DATA 환경변수를 사용하지 않는 경우에는 절대 경로가 필요할 수 있습니다.",
          "An absolute path may be required if you're not using the SERPENT_DATA environment variable.",
        ),
        L(
          "배포된 웹 편집기는 파일 존재 여부까지 확인하지 않으므로 Serpent 실행 환경에서 다시 점검하세요.",
          "This web editor doesn't check whether the file actually exists, so verify it again in your Serpent run environment.",
        ),
      ],
      url: `${SYNTAX_MANUAL}#set-${option}`,
    };
  }
  if (card.kind === "setting" && ["power", "powdens", "srcrate"].includes(option)) {
    return {
      title: L("Monte Carlo 결과의 물리적 정규화 기준을 지정합니다", "Specifies the physical normalization basis for Monte Carlo results"),
      description: L(
        "모의 입자 이력으로 얻은 반응률을 실제 출력, 출력밀도 또는 소스율 기준의 물리량으로 변환합니다.",
        "Converts reaction rates obtained from simulated particle histories into physical quantities normalized to actual power, power density, or source rate.",
      ),
      syntax: `set ${option} VALUE [MAT]`,
      tips: [
        L("power는 W, powdens는 kW/g, srcrate는 particles/s 기준입니다.", "power is in W, powdens is in kW/g, and srcrate is in particles/s."),
        L(
          "연소 계산에서는 구간별 정규화 조건이 결과에 직접 영향을 줍니다.",
          "In burnup calculations, the per-step normalization directly affects the results.",
        ),
      ],
      url: `${SYNTAX_MANUAL}#set-${option}`,
    };
  }
  if (card.kind === "source") {
    return {
      title: L("외부 소스의 입자·공간·에너지 분포를 정의합니다", "Defines the particle, spatial, and energy distribution of an external source"),
      description: L(
        "점, 셀, 물질, 유니버스, 표면 또는 파일을 기준으로 시작 입자를 샘플링할 수 있습니다.",
        "Starting particles can be sampled based on a point, cell, material, universe, surface, or file.",
      ),
      syntax: "src NAME [PART] [sp X Y Z] [sc CELL] [sm MAT] [se E] …",
      tips: [
        L("sp는 점 위치, sc·sm·su는 셀·물질·유니버스 체적 소스입니다.", "sp is a point location; sc, sm, and su are cell, material, and universe volume sources."),
        L(
          "체적 소스는 sx·sy·sz 또는 srad로 샘플링 범위를 좁히면 효율이 좋아집니다.",
          "For a volume source, narrowing the sampling range with sx, sy, sz, or srad improves efficiency.",
        ),
      ],
      url: `${SYNTAX_MANUAL}#src`,
    };
  }
  if (card.kind === "detector") {
    return {
      title: L("플럭스·반응률·전류 등의 확률론적 추정량을 계산합니다", "Computes stochastic estimates such as flux, reaction rate, and current"),
      description: L(
        "공간, 에너지, 시간 영역과 반응 응답을 조합해 필요한 결과를 별도로 집계합니다.",
        "Combines spatial, energy, and time bins with a reaction response to tally the desired result separately.",
      ),
      syntax: "det NAME [PART] [dc CELL] [dm MAT] [de EGRID] [dr MT RMAT] …",
      tips: [
        L("dc·dm·du·dl은 집계할 공간 영역을 제한합니다.", "dc, dm, du, and dl restrict the spatial region being tallied."),
        L("de는 에너지 격자, dr은 반응 응답을 연결합니다.", "de links an energy grid, and dr links a reaction response."),
      ],
      url: `${SYNTAX_MANUAL}#det`,
    };
  }
  if (card.kind === "plot") {
    return {
      title: L("Serpent 실행 시 생성할 형상 단면도를 설정합니다", "Configures the geometry cross-section plot Serpent generates at run time"),
      description: L(
        "plot은 단면 방향과 픽셀 크기를 지정하고, gplot은 파일명·강조·경계 등 더 세밀한 옵션을 제공합니다.",
        "plot sets the cross-section direction and pixel size, while gplot offers finer options such as file name, highlighting, and boundaries.",
      ),
      syntax: keyword === "plot" ? "plot TYPE NX NY [POS …]" : "gplot NAME plane TYPE … pix NX NY …",
      tips: [
        L("plot 방향은 1 = YZ, 2 = XZ, 3 = XY입니다.", "plot direction is 1 = YZ, 2 = XZ, 3 = XY."),
        L(
          "현재 우측 미리보기는 이 카드와 별개로 입력문의 CSG를 즉시 계산합니다.",
          "The preview on the right is computed live from the input's CSG, independently of this card.",
        ),
      ],
      url: `${SYNTAX_MANUAL}#${keyword}`,
    };
  }
  if (card.kind === "include") {
    return {
      title: L("다른 입력 파일을 현재 모델에 포함합니다", "Includes another input file in the current model"),
      description: L(
        "큰 모델을 형상·물질·설정 파일로 나눠 관리할 때 사용합니다.",
        "Used to split a large model into separate geometry, material, and settings files for easier management.",
      ),
      syntax: 'include "FILE"',
      tips: [
        L("경로에 공백이나 특수문자가 있으면 따옴표로 감쌉니다.", "Wrap the path in quotes if it contains spaces or special characters."),
        L(
          "브라우저 미리보기는 로컬 include 파일을 자동으로 읽을 수 없으므로 내용을 직접 합쳐야 합니다.",
          "The browser preview cannot automatically read a local include file, so you'll need to merge its contents in manually.",
        ),
      ],
      url: `${SYNTAX_MANUAL}#include`,
    };
  }
  if (keyword === "pin") {
    return {
      title: L("동심 원통층으로 핀 유니버스를 만듭니다", "Builds a pin universe from concentric cylindrical layers"),
      description: L(
        "재료와 외부 반지름을 안쪽부터 차례로 적어 연료봉 같은 반복 구조를 간단히 정의합니다.",
        "List materials and outer radii from the inside out to easily define a repeating structure like a fuel rod.",
      ),
      syntax: "pin UNI  MAT₁ R₁  MAT₂ R₂ … MATₙ",
      tips: [
        L("반지름은 cm 단위이며 바깥쪽으로 갈수록 증가해야 합니다.", "Radii are in cm and must increase outward."),
        L("마지막 재료 영역은 바깥 방향으로 무한히 이어집니다.", "The last material region extends infinitely outward."),
      ],
      url: `${SYNTAX_MANUAL}#pin`,
    };
  }
  if (keyword === "lat") {
    return {
      title: L("반복되는 유니버스를 격자에 배치합니다", "Arranges repeating universes on a lattice"),
      description: L(
        "격자 형식, 원점, 피치, 크기와 유니버스 배열을 이용해 반복 형상을 구성합니다.",
        "Builds a repeating geometry using a lattice type, origin, pitch, size, and universe array.",
      ),
      syntax: "lat UNI TYPE X₀ Y₀ NX NY PITCH …",
      tips: [
        L("격자 TYPE에 따라 필요한 좌표와 배열 형식이 달라집니다.", "The required coordinates and array format depend on the lattice TYPE."),
        L("배치되는 각 항목은 별도로 정의된 유니버스 이름입니다.", "Each entry placed is the name of a separately defined universe."),
      ],
      url: `${SYNTAX_MANUAL}#lat`,
    };
  }
  if (keyword === "ene") {
    return {
      title: L("검출기 등에 사용할 에너지 군 구조를 정의합니다", "Defines an energy group structure for use in detectors and elsewhere"),
      description: L(
        "경계값 목록 또는 선형·로그 균등 구간으로 에너지 빈을 만듭니다.",
        "Builds energy bins from a list of boundary values, or from evenly spaced linear or logarithmic intervals.",
      ),
      syntax: L("ene NAME TYPE E₁ E₂ …  또는  ene NAME TYPE N EMIN EMAX", "ene NAME TYPE E₁ E₂ …  or  ene NAME TYPE N EMIN EMAX"),
      tips: [
        L("에너지 단위는 MeV입니다.", "Energy units are MeV."),
        L("TYPE 1은 경계 목록, TYPE 2·3은 선형·로그 균등 구간입니다.", "TYPE 1 is a boundary list; TYPE 2 and 3 are evenly spaced linear and logarithmic intervals."),
      ],
      url: `${SYNTAX_MANUAL}#ene`,
    };
  }
  if (keyword === "therm" || keyword === "thermstoch") {
    return {
      title: L("결합 원자의 저에너지 중성자 산란 데이터를 연결합니다", "Links low-energy neutron scattering data for bound atoms"),
      description: L(
        "물질 카드의 moder 옵션에서 사용하는 열산란 이름과 S(α,β) 라이브러리를 연결합니다.",
        "Links a thermal-scattering name used by a material card's moder option to an S(α,β) library.",
      ),
      syntax: `${keyword} THNAME [T] LIB₁ [LIB₂ …]`,
      tips: [
        L("THNAME은 mat 카드의 moder 이름과 일치해야 합니다.", "THNAME must match the moder name used on the mat card."),
        L("온도 단위를 생략하면 Kelvin으로 해석됩니다.", "If the temperature unit is omitted, it's interpreted as Kelvin."),
      ],
      url: `${SYNTAX_MANUAL}#${keyword}`,
    };
  }
  if (keyword === "dep") {
    return {
      title: L("연소·방사화 계산의 시간 또는 연소도 구간을 정의합니다", "Defines the time or burnup steps for a burnup/activation calculation"),
      description: L(
        "각 구간의 단계 형식과 값을 순서대로 지정해 조성 변화 계산 이력을 만듭니다.",
        "Specifies the step type and value for each interval in order, building the composition-change calculation history.",
      ),
      syntax: "dep TYPE STEP₁ STEP₂ …",
      tips: [
        L(
          "단계 형식에 따라 일(day), MWd/kgU 또는 누적값으로 해석됩니다.",
          "Depending on the step type, values are interpreted as days, MWd/kgU, or cumulative values.",
        ),
        L(
          "출력·출력밀도 등 정규화 조건은 구간 사이에서 변경할 수 있습니다.",
          "Normalization conditions such as power or power density can be changed between steps.",
        ),
      ],
      url: `${SYNTAX_MANUAL}#dep`,
    };
  }
  if (["trans", "transa", "transb", "transv", "strans", "ftrans", "dtrans", "utrans"].includes(keyword)) {
    return {
      title: L(
        "표면·유니버스·소스·검출기 등의 좌표를 이동하거나 회전합니다",
        "Translates or rotates the coordinates of surfaces, universes, sources, detectors, and more",
      ),
      description: L(
        "기본 형상을 복제하지 않고 위치와 방향을 바꿀 때 사용하는 좌표 변환 카드입니다.",
        "A coordinate-transformation card used to change position and orientation without duplicating the underlying geometry.",
      ),
      syntax: `${keyword} TARGET NAME  X Y Z  [ROTATION …]`,
      tips: [
        L("변환 대상 형식에 따라 첫 인수와 회전 표현이 달라집니다.", "The first argument and rotation notation depend on the type of the transformation target."),
        L(
          "구형 transa·strans·ftrans·dtrans·utrans 대신 최신 trans 문법을 권장합니다.",
          "The current trans syntax is recommended over the legacy transa, strans, ftrans, dtrans, and utrans cards.",
        ),
      ],
      url: `${SYNTAX_MANUAL}#${keyword}`,
    };
  }
  if (card.kind === "setting") {
    return {
      title: L(`계산 옵션 set ${option}`, `Calculation option set ${option}`),
      description: L(
        "Serpent의 물리 모델, 계산 제어, 출력 또는 수치 알고리즘을 조정하는 입력 옵션입니다.",
        "An input option that adjusts Serpent's physics models, run control, output, or numerical algorithms.",
      ),
      syntax: `set ${option} ${data.values || "VALUE …"}`,
      tips: [
        L("값의 개수와 허용 범위는 옵션마다 다릅니다.", "The number of values and allowed range differ by option."),
        L(
          "기본값을 바꾸는 옵션이므로 공식 문법의 Notes와 제한 조건을 함께 확인하세요.",
          "This option changes a default value, so also check the Notes and constraints in the official syntax reference.",
        ),
      ],
      url: `${SYNTAX_MANUAL}#set-${option}`,
    };
  }

  return {
    title: L("Serpent 입력 카드", "Serpent input card"),
    description: L(
      "이 카드는 Serpent 입력 파서가 하나의 독립된 데이터 블록으로 처리합니다.",
      "The Serpent input parser treats this card as a single, independent data block.",
    ),
    syntax: `${card.keyword} ${data.name ?? "…"}`.trim(),
    tips: [
      L("옵션 순서와 필수 인수는 공식 입력 문법에서 확인하세요.", "Check the official input syntax reference for option order and required arguments."),
      L(
        "카드 식별자와 같은 이름을 사용자 정의 인수로 사용하지 않는 것이 안전합니다.",
        "It's safest not to reuse the card identifier itself as a user-defined argument name.",
      ),
    ],
    url: `${SYNTAX_MANUAL}#${keyword === "set" ? `set-${option}` : keyword}`,
  };
}

function fieldHint(card: SerpentCard, key: string, data: Record<string, string>, locale: UiLocale) {
  const L = (ko: string, en: string) => (locale === "en" ? en : ko);
  const option = data.name?.toLowerCase() ?? "";
  if (card.kind === "surface" && key === "type") return L("예: cyl, sph, px, pz, sqc, pad", "e.g. cyl, sph, px, pz, sqc, pad");
  if (card.kind === "surface" && key === "values") return surfaceParameterHint(data.type ?? "", locale);
  if (card.kind === "cell" && key === "universe") return L("0은 최상위(root) 유니버스입니다.", "0 is the top-level (root) universe.");
  if (card.kind === "cell" && key === "material") return L("mat 카드의 이름, void, outside 또는 fill을 입력합니다.", "Enter a mat card's name, void, outside, or fill.");
  if (card.kind === "cell" && key === "region") {
    return L(
      "음수: 표면의 음의 면 · 양수: 양의 면 · 공백: 교집합 · 콜론(:): 합집합",
      "Negative: the surface's negative side · Positive: its positive side · Space: intersection · Colon (:): union",
    );
  }
  if (card.kind === "material" && key === "density") return L("음수: 질량밀도(g/cm³) · 양수: 원자밀도", "Negative: mass density (g/cm³) · Positive: atomic density");
  if (card.kind === "material" && key === "composition") {
    return L("한 줄에 핵종명과 분율/밀도를 입력합니다. 예: 92235.09c  4.9E-02", "Enter one nuclide name and fraction/density per line. e.g. 92235.09c  4.9E-02");
  }
  if (card.kind === "setting" && option === "pop" && key === "values") {
    return L(
      "세대당 중성자 수  활성 세대  비활성 세대  [초기 k-eff  배치 간격  독립 계산 수]",
      "Neutrons per generation  active generations  inactive generations  [initial k-eff  batch interval  number of independent runs]",
    );
  }
  if (card.kind === "setting" && option === "nps" && key === "values") return L("전체 입자 이력 수  [배치 수  시간 빈]", "Total particle histories  [batch count  time bins]");
  if (card.kind === "setting" && option === "bc" && key === "values") {
    return L("1: 흡수 · 2: 반사 · 3: 주기 · 선택적으로 albedo를 추가합니다.", "1: absorbing · 2: reflective · 3: periodic · optionally add an albedo.");
  }
  if (card.kind === "source" && key === "values") return L("예: n sp 0 0 0 se 1.0 — 중성자 점 소스와 에너지", "e.g. n sp 0 0 0 se 1.0 — a neutron point source with an energy");
  if (card.kind === "detector" && key === "values") return L("예: dm fuel dr -6 fuel de energy_grid", "e.g. dm fuel dr -6 fuel de energy_grid");
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

function boundaryMode(value: string, locale: UiLocale) {
  const L = (ko: string, en: string) => (locale === "en" ? en : ko);
  return {
    "1": L("흡수(black) — 입자를 종료", "black (absorbing) — terminates the particle"),
    "2": L("반사(reflective) — 대칭 방향으로 반사", "reflective — reflects the particle symmetrically"),
    "3": L("주기(periodic) — 반대편 경계로 이동", "periodic — moves the particle to the opposite boundary"),
  }[value] ?? L("사용자 지정 경계조건", "custom boundary condition");
}

function interpretOptionSequence(tokens: string[], definitions: Record<string, [number, string]>, locale: UiLocale) {
  const L = (ko: string, en: string) => (locale === "en" ? en : ko);
  const result: ValueMeaning[] = [];
  let index = 0;
  if (tokens[0] === "n" || tokens[0] === "p") {
    result.push({ label: L("입자 종류", "Particle type"), value: tokens[0], meaning: tokens[0] === "n" ? L("중성자", "Neutron") : L("광자", "Photon") });
    index = 1;
  }
  while (index < tokens.length && result.length < 10) {
    const option = tokens[index];
    const definition = definitions[option];
    if (!definition) {
      result.push({ label: L(`인수 ${index + 1}`, `Argument ${index + 1}`), value: option, meaning: L("추가 위치 인수 또는 옵션 값", "Additional positional argument or option value") });
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

function interpretCardValues(card: SerpentCard, data: Record<string, string>, locale: UiLocale): ValueMeaning[] {
  const L = (ko: string, en: string) => (locale === "en" ? en : ko);
  const keyword = card.keyword.toLowerCase();
  const option = data.name?.toLowerCase() ?? "";

  if (card.kind === "surface") {
    const values = numericValues(data.values ?? "");
    const type = data.type?.toLowerCase();
    const entries: ValueMeaning[] = [
      { label: L("표면 이름", "Surface name"), value: data.name || "—", meaning: L("셀과 검출기에서 이 경계를 참조할 때 사용하는 식별자", "The identifier used to reference this boundary from cell and detector cards") },
      { label: L("표면 형식", "Surface type"), value: data.type || "—", meaning: surfaceParameterHint(data.type ?? "", locale) },
    ];
    if (type === "px" || type === "py" || type === "pz") {
      const axis = type.at(-1);
      entries.push({ label: `${axis}₀`, value: `${values[0] ?? "—"} cm`, meaning: L(`${axis}축 원점에서 평면까지의 부호 있는 거리`, `Signed distance from the origin to the plane along the ${axis}-axis`) });
    } else if (type === "cyl" || type === "cylz") {
      entries.push(
        { label: L("중심", "Center"), value: `(${values[0] ?? "—"}, ${values[1] ?? "—"}) cm`, meaning: L("XY 평면에서 원통 중심 좌표", "Cylinder center coordinates in the XY plane") },
        { label: L("반지름 r", "Radius r"), value: `${values[2] ?? "—"} cm`, meaning: L(`직경은 ${Number.isFinite(values[2]) ? (values[2] * 2).toFixed(3) : "—"} cm`, `Diameter is ${Number.isFinite(values[2]) ? (values[2] * 2).toFixed(3) : "—"} cm`) },
      );
      if (values.length >= 5) entries.push({ label: L("축 방향 범위", "Axial extent"), value: `${values[3]} … ${values[4]} cm`, meaning: L("절단 원통의 z 최소·최대 위치", "Min/max z position of the truncated cylinder") });
    } else if (type === "sph") {
      entries.push(
        { label: L("중심", "Center"), value: `(${values[0] ?? "—"}, ${values[1] ?? "—"}, ${values[2] ?? "—"}) cm`, meaning: L("구 중심의 X·Y·Z 좌표", "X, Y, Z coordinates of the sphere's center") },
        { label: L("반지름 r", "Radius r"), value: `${values[3] ?? "—"} cm`, meaning: L(`직경은 ${Number.isFinite(values[3]) ? (values[3] * 2).toFixed(3) : "—"} cm`, `Diameter is ${Number.isFinite(values[3]) ? (values[3] * 2).toFixed(3) : "—"} cm`) },
      );
    } else if (type === "sqc") {
      entries.push(
        { label: L("중심", "Center"), value: `(${values[0] ?? "—"}, ${values[1] ?? "—"}) cm`, meaning: L("정사각 기둥 중심 좌표", "Center coordinates of the square prism") },
        { label: L("반폭 r", "Half-width r"), value: `${values[2] ?? "—"} cm`, meaning: L(`전체 폭은 ${Number.isFinite(values[2]) ? (values[2] * 2).toFixed(3) : "—"} cm`, `Full width is ${Number.isFinite(values[2]) ? (values[2] * 2).toFixed(3) : "—"} cm`) },
      );
      if (Number.isFinite(values[3])) entries.push({ label: L("모서리 반경", "Corner radius"), value: `${values[3]} cm`, meaning: L("둥근 모서리에 적용되는 반경", "Radius applied to the rounded corners") });
    } else if (type === "pad") {
      entries.push(
        { label: L("중심", "Center"), value: `(${values[0] ?? "—"}, ${values[1] ?? "—"}) cm`, meaning: L("원환 부채꼴의 중심", "Center of the annular sector") },
        {
          label: L("반경 구간", "Radial range"),
          value: `${values[2] ?? "—"} … ${values[3] ?? "—"} cm`,
          meaning: L(
            `두께는 ${Number.isFinite(values[2]) && Number.isFinite(values[3]) ? Math.abs(values[3] - values[2]).toFixed(3) : "—"} cm`,
            `Thickness is ${Number.isFinite(values[2]) && Number.isFinite(values[3]) ? Math.abs(values[3] - values[2]).toFixed(3) : "—"} cm`,
          ),
        },
        {
          label: L("각도 구간", "Angular range"),
          value: `${values[4] ?? "—"}° … ${values[5] ?? "—"}°`,
          meaning: L(
            `열림각은 ${Number.isFinite(values[4]) && Number.isFinite(values[5]) ? Math.abs(values[5] - values[4]).toFixed(3) : "—"}°`,
            `Opening angle is ${Number.isFinite(values[4]) && Number.isFinite(values[5]) ? Math.abs(values[5] - values[4]).toFixed(3) : "—"}°`,
          ),
        },
      );
    } else {
      values.slice(0, 8).forEach((value, index) => entries.push({ label: `PARAM ${index + 1}`, value: String(value), meaning: L(`${data.type || "표면"} 형식의 ${index + 1}번째 인수`, `Argument ${index + 1} of the ${data.type || "surface"} type`) }));
    }
    return entries;
  }

  if (card.kind === "cell") {
    const region = data.region ?? "";
    const surfaces = region.match(/[+-]?[A-Za-z0-9_.]+/g) ?? [];
    return [
      { label: L("셀 이름", "Cell name"), value: data.name || "—", meaning: L("src·det 카드 등에서 이 공간을 참조할 때 사용하는 이름", "The name used to reference this space from src, det, and other cards") },
      {
        label: L("유니버스", "Universe"),
        value: data.universe || "—",
        meaning: data.universe === "0" ? L("최상위(root) 유니버스", "Top-level (root) universe") : L(`유니버스 ${data.universe} 내부에 배치`, `Placed inside universe ${data.universe}`),
      },
      {
        label: L("채움", "Fill"),
        value: data.material || "—",
        meaning:
          data.material === "outside" ? L("계산 영역 바깥", "Outside the computational domain") :
          data.material === "void" ? L("물질이 없는 빈 공간", "Empty space with no material") :
          L(`물질 또는 fill 유니버스 '${data.material}' 사용`, `Uses the material or fill universe '${data.material}'`),
      },
      {
        label: L("영역식", "Region expression"),
        value: region || "—",
        meaning: region.includes(":") ? L("합집합(:)을 포함한 Boolean 영역", "A Boolean region containing a union (:)") : L("나열된 모든 표면 조건의 교집합", "The intersection of every listed surface condition"),
      },
      ...surfaces.slice(0, 8).map((surface) => ({
        label: L(`경계 ${surface.replace(/^[+-]/, "")}`, `Boundary ${surface.replace(/^[+-]/, "")}`),
        value: surface.startsWith("-") ? L("음의 면", "negative side") : L("양의 면", "positive side"),
        meaning: surface.startsWith("-")
          ? L("해당 표면 함수가 음수인 쪽(닫힌 표면은 일반적으로 내부)", "The side where the surface function is negative (usually the interior for a closed surface)")
          : L("해당 표면 함수가 양수인 쪽(닫힌 표면은 일반적으로 외부)", "The side where the surface function is positive (usually the exterior for a closed surface)"),
      })),
    ];
  }

  if (card.kind === "material") {
    const density = Number(data.density);
    const composition = (data.composition ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    const entries: ValueMeaning[] = [
      { label: L("물질 이름", "Material name"), value: data.name || "—", meaning: L("cell 카드에서 이 조성을 참조하는 이름", "The name cell cards use to reference this composition") },
      {
        label: L("기준 밀도", "Reference density"),
        value: data.density || "—",
        meaning: Number.isFinite(density)
          ? density < 0
            ? L(`질량밀도 ${Math.abs(density)} g/cm³`, `Mass density ${Math.abs(density)} g/cm³`)
            : L(`원자밀도 ${density} atoms/(barn·cm)`, `Atomic density ${density} atoms/(barn·cm)`)
          : L("밀도 값을 확인하세요.", "Check the density value."),
      },
      { label: L("핵종 수", "Nuclide count"), value: L(`${composition.length}개`, `${composition.length}`), meaning: L("현재 조성 블록에 입력된 핵종 또는 원소 항목 수", "The number of nuclide or element entries in the current composition block") },
    ];
    const options = data.options?.trim();
    if (options) entries.push({ label: L("물질 옵션", "Material options"), value: options, meaning: L("burn, tmp/tms, moder, rgb 등 물질에 적용되는 추가 설정", "Additional settings applied to the material, such as burn, tmp/tms, moder, or rgb") });
    composition.slice(0, 7).forEach((line) => {
      const [nuclide, fraction = ""] = line.split(/\s+/);
      const amount = Number(fraction);
      const fractionMeaning = Number.isFinite(amount)
        ? amount < 0
          ? L(`질량 기준 성분값 ${Math.abs(amount)}`, `Mass-based fraction ${Math.abs(amount)}`)
          : L(`원자 기준 성분값 ${amount}`, `Atom-based fraction ${amount}`)
        : L("핵종 조성 값", "Nuclide composition value");
      const nuclideInfo = parseNuclideId(nuclide);
      entries.push({
        label: nuclide,
        value: fraction || "—",
        meaning: nuclideInfo ? `${describeNuclide(nuclideInfo, locale)} · ${fractionMeaning}` : fractionMeaning,
      });
    });
    if (composition.length > 7) {
      entries.push({
        label: L("나머지 조성", "Remaining composition"),
        value: L(`${composition.length - 7}개`, `${composition.length - 7}`),
        meaning: L("아래 핵종 조성 입력란에서 전체 항목을 확인할 수 있습니다.", "See the nuclide composition field below for the full list."),
      });
    }
    return entries;
  }

  if (card.kind === "title") {
    return [{ label: L("계산 제목", "Calculation title"), value: data.values || "—", meaning: L("실행 로그와 표준 결과 파일에 표시되는 사례 이름", "The case name shown in the run log and the standard result file") }];
  }

  if (card.kind === "setting" && option === "pop") {
    const values = (data.values ?? "").split(/\s+/).filter(Boolean);
    return [
      { label: "NPG", value: values[0] ?? "—", meaning: L("한 세대에서 추적할 중성자 수", "Neutrons tracked per generation") },
      { label: "NGEN", value: values[1] ?? "—", meaning: L("통계에 포함되는 활성 세대 수", "Active generations included in the statistics") },
      { label: "NSKIP", value: values[2] ?? "—", meaning: L("초기 소스 수렴을 위해 버리는 비활성 세대 수", "Inactive generations discarded for initial source convergence") },
      ...(values[3] ? [{ label: "K₀", value: values[3], meaning: L("초기 k-effective 추정값", "Initial k-effective estimate") }] : []),
    ];
  }

  if (card.kind === "setting" && option === "nps") {
    const values = (data.values ?? "").split(/\s+/).filter(Boolean);
    return [
      { label: "NP", value: values[0] ?? "—", meaning: L("외부 소스 계산에서 추적할 전체 입자 이력 수", "Total particle histories tracked in the external-source calculation") },
      ...(values[1] ? [{ label: "BTCH", value: values[1], meaning: L("통계 처리를 위한 배치 수", "Batch count used for statistical processing") }] : []),
      ...(values[2] ? [{ label: "TBI", value: values[2], meaning: L("동적 모드에서 사용할 시간 빈 구조", "Time-bin structure used in dynamic mode") }] : []),
    ];
  }

  if (card.kind === "setting" && option === "bc") {
    const values = (data.values ?? "").split(/\s+/).filter(Boolean);
    if (values.length >= 3) {
      return ["x", "y", "z"].map((axis, index) => ({ label: L(`${axis.toUpperCase()} 경계`, `${axis.toUpperCase()} boundary`), value: values[index] ?? "—", meaning: boundaryMode(values[index], locale) }));
    }
    return [
      { label: L("전체 방향 경계", "All-direction boundary"), value: values[0] ?? "—", meaning: boundaryMode(values[0], locale) },
      ...(values[1] ? [{ label: "Albedo", value: values[1], meaning: L("경계 통과 시 입자 통계 가중치에 곱하는 계수", "Factor multiplied into the particle's statistical weight when it crosses the boundary") }] : []),
    ];
  }

  if (card.kind === "setting" && ["power", "powdens", "srcrate"].includes(option)) {
    const [value = "—", material] = (data.values ?? "").split(/\s+/);
    const units = option === "power" ? "W" : option === "powdens" ? "kW/g" : "particles/s";
    return [
      { label: option, value: `${value} ${units}`, meaning: L("결과를 물리량으로 환산할 때 사용하는 정규화 기준", "The normalization basis used to convert results into physical quantities") },
      ...(material ? [{ label: L("기준 물질", "Reference material"), value: material, meaning: L("정규화를 이 물질의 기여도에 한정", "Restricts normalization to this material's contribution") }] : []),
    ];
  }

  if (card.kind === "setting") {
    return (data.values ?? "").split(/\s+/).filter(Boolean).slice(0, 10).map((value, index) => ({
      label: index === 0 ? `set ${option}` : L(`인수 ${index + 1}`, `Argument ${index + 1}`),
      value,
      meaning: index === 0 ? L("이 옵션의 첫 번째 설정값", "The first setting value for this option") : L(`set ${option} 옵션의 ${index + 1}번째 설정값`, `The ${index + 1}th setting value for the set ${option} option`),
    }));
  }

  if (card.kind === "source") {
    const tokens = (data.values ?? "").split(/\s+/).filter(Boolean);
    return [
      { label: L("소스 이름", "Source name"), value: data.name || "—", meaning: L("소스 분포 식별자", "Identifier for the source distribution") },
      ...interpretOptionSequence(tokens, {
        sp: [3, L("점 소스 또는 분포 중심의 X·Y·Z 좌표(cm)", "X, Y, Z coordinates (cm) of the point source or distribution center")],
        sc: [1, L("이 셀 내부에서 소스 위치를 샘플링", "Samples the source position inside this cell")],
        sm: [1, L("이 물질 내부에서 소스 위치를 샘플링", "Samples the source position inside this material")],
        su: [1, L("이 유니버스 내부에서 소스 위치를 샘플링", "Samples the source position inside this universe")],
        ss: [1, L("지정 표면에서 입자를 방출", "Emits particles from the specified surface")],
        sx: [2, L("X 방향 샘플링 최소·최대 범위(cm)", "Min/max sampling range along X (cm)")],
        sy: [2, L("Y 방향 샘플링 최소·최대 범위(cm)", "Min/max sampling range along Y (cm)")],
        sz: [2, L("Z 방향 샘플링 최소·최대 범위(cm)", "Min/max sampling range along Z (cm)")],
        srad: [2, L("방사 방향 최소·최대 반경(cm)", "Min/max radius in the radial direction (cm)")],
        se: [1, L("단일 입자 에너지(MeV)", "Single particle energy (MeV)")],
        sd: [3, L("입자 진행 방향 벡터", "Particle direction vector")],
      }, locale),
    ];
  }

  if (card.kind === "detector") {
    const tokens = (data.values ?? "").split(/\s+/).filter(Boolean);
    return [
      { label: L("검출기 이름", "Detector name"), value: data.name || "—", meaning: L("출력 변수 DET[NAME]에 사용되는 식별자", "The identifier used in the output variable DET[NAME]") },
      ...interpretOptionSequence(tokens, {
        dc: [1, L("이 셀에 집계 영역을 제한", "Restricts the tally region to this cell")],
        dm: [1, L("이 물질에 집계 영역을 제한", "Restricts the tally region to this material")],
        du: [1, L("이 유니버스에 집계 영역을 제한", "Restricts the tally region to this universe")],
        dl: [1, L("이 격자에 집계 영역을 제한", "Restricts the tally region to this lattice")],
        ds: [2, L("표면과 방향을 지정한 입자 전류 검출", "Detects particle current with a specified surface and direction")],
        de: [1, L("결과에 적용할 에너지 격자", "The energy grid applied to the results")],
        dr: [2, L("MT 반응번호와 응답 물질", "The MT reaction number and response material")],
        dv: [1, L("검출기 체적 또는 결과 나눗셈 계수", "Detector volume or a divisor applied to the results")],
      }, locale),
    ];
  }

  if (card.kind === "plot" && keyword === "plot") {
    const values = [data.name, ...(data.values ?? "").split(/\s+/)].filter(Boolean);
    const plane = { "1": "YZ", "2": "XZ", "3": "XY" }[values[0]] ?? L("사용자 지정", "custom");
    return [
      { label: L("단면 방향", "Cross-section direction"), value: values[0] ?? "—", meaning: L(`${plane} 평면`, `${plane} plane`) },
      { label: L("이미지 크기", "Image size"), value: `${values[1] ?? "—"} × ${values[2] ?? "—"} px`, meaning: L("Serpent가 생성할 PNG의 가로·세로 픽셀 수", "The width/height in pixels of the PNG Serpent generates") },
      ...(values[3] ? [{ label: L("단면 위치", "Cross-section position"), value: `${values[3]} cm`, meaning: L("단면에 수직인 축의 좌표", "The coordinate on the axis perpendicular to the cross-section") }] : []),
    ];
  }

  if (keyword === "pin") {
    const tokens = (data.values ?? "").split(/\s+/).filter(Boolean);
    const entries: ValueMeaning[] = [{ label: L("핀 유니버스", "Pin universe"), value: data.name || "—", meaning: L("격자나 fill에서 참조할 동심 원통 구조 이름", "The name of this concentric-cylinder structure, referenced from a lattice or fill") }];
    for (let index = 0; index < tokens.length; index += 2) {
      entries.push({
        label: L(`층 ${index / 2 + 1}`, `Layer ${index / 2 + 1}`),
        value: tokens[index + 1] ? `${tokens[index]} · R ${tokens[index + 1]} cm` : tokens[index],
        meaning: tokens[index + 1] ? L("해당 물질층의 외부 반지름", "Outer radius of this material layer") : L("반지름 제한 없이 이어지는 최외곽 물질", "The outermost material, extending with no radius limit"),
      });
    }
    return entries;
  }

  const values = [data.name, ...(data.values ?? "").split(/\s+/)].filter(Boolean);
  return values.slice(0, 10).map((value, index) => ({
    label: index === 0 ? L("첫 번째 인수", "First argument") : L(`인수 ${index + 1}`, `Argument ${index + 1}`),
    value,
    meaning: L(`${card.keyword} 카드의 ${index + 1}번째 입력값`, `The ${index + 1}th input value of the ${card.keyword} card`),
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

const GEOMETRY_WIDTH_DEFAULT = 420;
const GEOMETRY_WIDTH_MIN = 300;
const GEOMETRY_WIDTH_MAX = 800;

const WORKSPACE_STORAGE_KEY = "serpent-studio-workspace-v1";

type EditorView = "builder" | "source" | "results" | "summary";

const EDITOR_VIEWS: EditorView[] = ["builder", "source", "results", "summary"];

type WorkspaceSnapshot = {
  source: string;
  fileName: string;
  geometrySource: string;
  selectedId: string;
  view: EditorView;
  results: IngestedFile[];
  inputs: IngestedFile[];
  detectors: [string, Detector[]][];
  referenceKey: string;
  activeResultKey: string;
  /** 계산 정리에서 사람이 채운 항목. 다음 방문에도 그대로 남아야 한다. */
  summaryMeta: SummaryMeta;
  /** 입력문을 파일로 연 경우의 원본 정보(폴더·수정 시각). */
  inputFileInfo?: IngestedFile;
};

/** 저장된 값이 깨졌어도 정리 화면이 죽지 않도록 문자열 필드만 골라 받는다. */
function readSummaryMeta(value: unknown): SummaryMeta {
  if (!value || typeof value !== "object") return EMPTY_SUMMARY_META;
  const saved = value as Partial<SummaryMeta>;
  const text = (field: keyof SummaryMeta) =>
    typeof saved[field] === "string" ? (saved[field] as string) : "";
  return {
    title: text("title"),
    analyst: text("analyst"),
    location: text("location"),
    notes: text("notes"),
    includeImages: typeof saved.includeImages === "boolean" ? saved.includeImages : true,
    locale: saved.locale === "en" ? "en" : "ko",
  };
}

function savedResultKey(item: { fileName: string; dir: string }) {
  return `${item.dir}␟${item.fileName}`;
}

function readWorkspace(): WorkspaceSnapshot | null {
  const raw = readSetting(WORKSPACE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
    if (typeof saved.source !== "string" || typeof saved.fileName !== "string") return null;
    if (!Array.isArray(saved.results) || !Array.isArray(saved.inputs) || !Array.isArray(saved.detectors)) return null;
    return {
      source: saved.source,
      fileName: saved.fileName,
      geometrySource: typeof saved.geometrySource === "string" ? saved.geometrySource : saved.source,
      selectedId: typeof saved.selectedId === "string" ? saved.selectedId : "",
      view: EDITOR_VIEWS.includes(saved.view as EditorView) ? (saved.view as EditorView) : "builder",
      results: saved.results,
      inputs: saved.inputs,
      detectors: saved.detectors,
      referenceKey: typeof saved.referenceKey === "string" ? saved.referenceKey : "",
      activeResultKey: typeof saved.activeResultKey === "string" ? saved.activeResultKey : "",
      summaryMeta: readSummaryMeta(saved.summaryMeta),
      inputFileInfo: saved.inputFileInfo,
    };
  } catch {
    return null;
  }
}

/**
 * 문자열/Blob 을 파일로 내려받는다. 이 앱 곳곳의 다운로드 버튼이 공유하는 마지막 단계.
 *
 * click() 직후 바로 revokeObjectURL 을 부르면, 브라우저가 그 blob 을 아직 다 읽기 전에
 * URL 이 무효화되어 다운로드가 아무 오류 없이 조용히 실패할 수 있다 — 파일 하나만 받을
 * 때는 거의 안 드러나지만, "계산 정리" 다운로드처럼 여러 파일을 연달아 트리거하면 그중
 * 일부만 받아지는 형태로 나타난다. 정리(remove/revoke)를 다음 틱으로 미뤄서 브라우저가
 * 다운로드를 큐에 넣을 시간을 준다.
 */
function triggerDownload(data: BlobPart, filename: string, mime?: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** 캔버스에서 이미 만든 `data:image/png;base64,...` 를 그대로 Blob 으로 바꾼다. */
async function dataUrlToBlob(dataUrl: string) {
  return (await fetch(dataUrl)).blob();
}

/**
 * 스펙트럼 SVG(순수 문자열)를 PNG 로 래스터화한다. 벡터 그림이라 원래 "해상도"가
 * 없으므로, 화면보다 선명하게 받을 수 있도록 2배로 그린다. data: URI 로 만든
 * `<img>`는 동일 출처로 취급되어 캔버스를 오염시키지 않는다.
 */
function svgToPngBlob(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (!context) { reject(new Error("2D 캔버스 컨텍스트를 만들 수 없습니다.")); return; }
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob); else reject(new Error("PNG 인코딩에 실패했습니다."));
      }, "image/png");
    };
    image.onerror = () => reject(new Error("스펙트럼 SVG 를 이미지로 불러오지 못했습니다."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export default function Home() {
  const [source, setSource] = useState(SAMPLE_INPUT);
  const [fileName, setFileName] = useState("pwr_pin.inp");
  const [selectedId, setSelectedId] = useState<string>("");
  const [view, setView] = useState<EditorView>("builder");
  const [summaryMeta, setSummaryMeta] = useState<SummaryMeta>(EMPTY_SUMMARY_META);
  /** 입력문을 파일로 열었을 때의 원본 정보. 정리 문서의 폴더·수정 시각이 여기서 나온다. */
  const [inputFileInfo, setInputFileInfo] = useState<IngestedFile | undefined>(undefined);
  // 형상 미리보기는 캔버스라 순수 함수로 다시 그릴 수 없다. 계산 정리 문서에 쓸 스냅샷은
  // "계산 정리" 탭을 열 때나 새로고침 버튼을 눌렀을 때만 찍는다 — 매 렌더마다 캔버스를
  // PNG 로 인코딩하면(팬/줌 중에도) 그 자체로 무거워지기 때문이다.
  const geometryPreviewRef = useRef<GeometryPreviewHandle>(null);
  const [geometryImage, setGeometryImage] = useState<SummaryGeometryImage | undefined>(undefined);
  // 형상 미리보기 패널의 폭(px). 좌우 리사이저로 조절하고 다음 방문에도 기억한다.
  const [geometryWidth, setGeometryWidth] = useState(GEOMETRY_WIDTH_DEFAULT);
  const [resizingGeometry, setResizingGeometry] = useState(false);
  // 형상 미리보기는 캔버스 재계산과 겹침/빈틈 표본검사를 동반해 매 타이핑마다 다시
  // 그리면 큰 입력에서 느려진다. 새로고침을 누르기 전까지는 이 값(마지막으로 반영한
  // 원문) 기준으로만 다시 계산한다.
  const [geometrySource, setGeometrySource] = useState(SAMPLE_INPUT);
  const [showIssues, setShowIssues] = useState(false);
  // 좁은 화면(≤760px)에서 숨는 형상 미리보기 패널을 전체화면 오버레이로 다시 열지 여부.
  const [mobileGeometryOpen, setMobileGeometryOpen] = useState(false);
  const [results, setResults] = useState<ResultCase[]>([]);
  // ResultCase 는 Map 을 포함해 그대로 JSON 저장할 수 없으므로 원문 파일도 따로 유지한다.
  const [openedResultFiles, setOpenedResultFiles] = useState<IngestedFile[]>([]);
  const [referenceId, setReferenceId] = useState("");
  const [activeResultId, setActiveResultId] = useState("");
  const [fontScale, setFontScale] = useState(100);
  const [uiLocale, setUiLocale] = useState<UiLocale>("ko");
  const t = useCallback((ko: string) => translateUi(ko, uiLocale), [uiLocale]);
  const [showAdd, setShowAdd] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  // 결과문에서 짝을 찾아 열 수 있도록, 함께 들어온 입력문을 pairKey 로 들고 있는다.
  const [inputLibrary, setInputLibrary] = useState<Map<string, IngestedFile>>(new Map());
  // dir+기본이름 → 그 이름의 결과문과 짝지어질 검출기(det) 스펙트럼들.
  const [detectorLibrary, setDetectorLibrary] = useState<Map<string, Detector[]>>(new Map());
  const [linkNotice, setLinkNotice] = useState("");
  const [dropping, setDropping] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const resultInput = useRef<HTMLInputElement>(null);
  /** 우리가 마지막으로 넣어준 입력문. 사용자가 손댄 편집을 덮어쓰지 않기 위해 비교용으로 쓴다. */
  const loadedSource = useRef(SAMPLE_INPUT);
  // 원문 편집 되돌리기/다시하기 스택. past 의 끝이 가장 최근 이전 상태.
  const [sourcePast, setSourcePast] = useState<string[]>([]);
  const [sourceFuture, setSourceFuture] = useState<string[]>([]);
  // 원문 텍스트영역에서 타이핑하는 동안은 매 키 입력마다 기록을 남기지 않고,
  // 잠시 멈췄다가 다시 칠 때만 새 되돌리기 지점을 만든다.
  const typingBurst = useRef<{ active: boolean; timer: ReturnType<typeof setTimeout> | null }>({
    active: false,
    timer: null,
  });

  const cards = useMemo(() => parseSerpentInput(source), [source]);

  // 형상 미리보기와 겹침/빈틈 진단은 새로고침을 눌러야 반영되는 별도 스냅샷에서 계산한다.
  const geometryCards = useMemo(() => parseSerpentInput(geometrySource), [geometrySource]);
  const geometryModel = useMemo(() => parseGeometryModel(geometryCards), [geometryCards]);
  const geometryStale = source !== geometrySource;

  // 셀 이름 → 카드 id. 형상 진단이 지목한 셀 카드로 바로 이동할 때 쓴다.
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
  // 겹침/빈틈 진단은 형상 표본검사와 같은 비용이 드므로 새로고침된 스냅샷에서만 다시 돈다.
  // 카드 id 를 넘기지 않는 이유는 그 map 이 타이핑마다 새로 만들어져 이 memo 를 깨뜨리기 때문이다.
  const geometryIssues = useMemo(() => diagnoseGeometry(geometryModel), [geometryModel]);
  const issues = useMemo(() => [...syntaxIssues, ...geometryIssues], [syntaxIssues, geometryIssues]);

  /** 진단이 남긴 셀 이름을 지금 카드 목록에서 찾아 준다. */
  function issueCardId(issue: ValidationIssue) {
    return issue.cardId ?? (issue.cellName ? cellCardIds.get(issue.cellName) : undefined);
  }

  const selected = cards.find((card) => card.id === selectedId) ?? cards.find((card) => card.kind === "surface") ?? cards[0];
  const selectedData = selected ? getCardData(selected) : {};
  const selectedGuide = selected ? guideForCard(selected, selectedData, uiLocale) : null;
  const selectedMeanings = selected ? interpretCardValues(selected, selectedData, uiLocale) : [];
  const errors = issues.filter((issue) => issue.level === "error").length;
  const issuesTone = errors ? "bad" : issues.length ? "warn" : "ok";
  // 형상 겹침·빈틈 검사는 격자 표본점만 확인하므로 "정상"이라고 단정하지 않는다.
  const issuesLabel = errors
    ? t("오류 {n}개").replace("{n}", String(errors))
    : issues.length
      ? t("권장 {n}개").replace("{n}", String(issues.length))
      : t("표본 검사 통과");

  const groupedCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const entries = cards.map((card) => ({ card, summary: cardSummary(card, uiLocale), group: cardCategory(card) }));
    const visible = needle
      ? entries.filter(({ card, summary }) =>
          `${summary.name} ${summary.meta} ${card.keyword}`.toLowerCase().includes(needle))
      : entries;
    return GROUPS.map((group) => ({
      ...group,
      items: visible.filter((entry) => entry.group === group.name),
    })).filter((group) => group.items.length);
  }, [cards, query, uiLocale]);

  const matchCount = groupedCards.reduce((total, group) => total + group.items.length, 0);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  // 로컬 저장소에서 복원하는 간단한 UI 설정들. 하나로 묶어 마운트 시 한 번만 돈다.
  useEffect(() => {
    const savedScale = Number(readSetting("serpent-studio-font-scale"));
    if (savedScale >= FONT_SCALE_MIN && savedScale <= FONT_SCALE_MAX) setFontScale(savedScale);
    if (readSetting("serpent-studio-ui-locale") === "en") setUiLocale("en");
  }, []);

  function changeUiLocale(locale: UiLocale) {
    setUiLocale(locale);
    writeSetting("serpent-studio-ui-locale", locale);
  }

  useEffect(() => {
    const savedWidth = Number(readSetting("serpent-studio-geometry-width"));
    if (savedWidth >= GEOMETRY_WIDTH_MIN && savedWidth <= GEOMETRY_WIDTH_MAX) setGeometryWidth(savedWidth);
  }, []);

  // 브라우저는 새로고침 뒤 File 객체를 되살릴 수 없으므로, 마지막으로 읽은 원문을 저장해
  // ResultCase 를 다시 만든다. 저장 데이터가 깨졌다면 기본 예제 상태로 자연스럽게 시작한다.
  useEffect(() => {
    const saved = readWorkspace();
    if (!saved) {
      setWorkspaceReady(true);
      return;
    }

    const restoredResults = saved.results.map((file, index) =>
      buildResultCase(file.name, file.text, `restored-${index}-${file.name}`, file.dir),
    );
    const inputLibrary = new Map(saved.inputs.map((file) => [pairKey(file, "input"), file]));
    const reference = restoredResults.find((item) => savedResultKey(item) === saved.referenceKey);
    const active = restoredResults.find((item) => savedResultKey(item) === saved.activeResultKey);

    loadedSource.current = saved.source;
    setSource(saved.source);
    setFileName(saved.fileName);
    setGeometrySource(saved.geometrySource);
    setSelectedId(saved.selectedId);
    setResults(restoredResults);
    setOpenedResultFiles(saved.results);
    setInputLibrary(inputLibrary);
    setDetectorLibrary(new Map(saved.detectors));
    setReferenceId(reference?.id ?? restoredResults[0]?.id ?? "");
    setActiveResultId(active?.id ?? restoredResults[0]?.id ?? "");
    setSummaryMeta(saved.summaryMeta);
    setInputFileInfo(saved.inputFileInfo);
    setView(saved.view === "results" && !restoredResults.length ? "builder" : saved.view);
    if (saved.fileName !== "pwr_pin.inp" || restoredResults.length) {
      // 이 효과는 마운트 시 한 번만 돌아 아직 저장된 UI 언어를 반영하기 전일 수 있으므로,
      // t() 클로저 대신 저장된 값을 직접 읽어 판단한다(그래야 이 effect 를 t 의존으로
      // 다시 걸 필요가 없다).
      setLinkNotice(
        readSetting("serpent-studio-ui-locale") === "en"
          ? translateUi("직전에 열었던 작업을 복원했습니다.", "en")
          : "직전에 열었던 작업을 복원했습니다.",
      );
    }
    setWorkspaceReady(true);
  }, []);

  useEffect(() => {
    if (!workspaceReady) return;
    const reference = results.find((item) => item.id === referenceId);
    const active = results.find((item) => item.id === activeResultId);
    writeSetting(WORKSPACE_STORAGE_KEY, JSON.stringify({
      source,
      fileName,
      geometrySource,
      selectedId,
      view,
      results: openedResultFiles,
      inputs: [...inputLibrary.values()],
      detectors: [...detectorLibrary.entries()],
      referenceKey: reference ? savedResultKey(reference) : "",
      activeResultKey: active ? savedResultKey(active) : "",
      summaryMeta,
      inputFileInfo,
    } satisfies WorkspaceSnapshot));
  }, [workspaceReady, source, fileName, geometrySource, selectedId, view, openedResultFiles, inputLibrary, detectorLibrary, results, referenceId, activeResultId, summaryMeta, inputFileInfo]);

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

  /**
   * 형상 미리보기 폭 조절 핸들. 핸들은 미리보기 패널의 왼쪽 경계에 있으므로
   * 왼쪽으로 끌수록(clientX 감소) 패널이 넓어진다.
   */
  function beginGeometryResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = geometryWidth;
    let latestWidth = startWidth;
    setResizingGeometry(true);

    function onMove(moveEvent: PointerEvent) {
      const next = Math.min(
        GEOMETRY_WIDTH_MAX,
        Math.max(GEOMETRY_WIDTH_MIN, startWidth + (startX - moveEvent.clientX)),
      );
      latestWidth = next;
      setGeometryWidth(next);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizingGeometry(false);
      writeSetting("serpent-studio-geometry-width", String(latestWidth));
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function resetGeometryWidth() {
    setGeometryWidth(GEOMETRY_WIDTH_DEFAULT);
    writeSetting("serpent-studio-geometry-width", String(GEOMETRY_WIDTH_DEFAULT));
  }

  function toggleGroup(group: string) {
    setCollapsedGroups((groups) =>
      groups.includes(group) ? groups.filter((item) => item !== group) : [...groups, group],
    );
  }

  const MAX_SOURCE_HISTORY = 300;

  function pushSourceHistory(previous: string) {
    setSourcePast((past) => {
      const next = [...past, previous];
      return next.length > MAX_SOURCE_HISTORY ? next.slice(next.length - MAX_SOURCE_HISTORY) : next;
    });
    setSourceFuture([]);
  }

  /** 원문을 되돌리기 스택에 기록하며 바꾼다. coalesce 는 타이핑처럼 연속된 입력을
   * 한 번의 되돌리기 지점으로 묶을 때 쓴다(잠시 멈추면 다음 타이핑부터 새 지점). */
  function updateSource(next: string, options: { coalesce?: boolean } = {}) {
    if (next === source) return;
    const burst = typingBurst.current;
    if (options.coalesce) {
      if (!burst.active) {
        pushSourceHistory(source);
        burst.active = true;
      }
      if (burst.timer) clearTimeout(burst.timer);
      burst.timer = setTimeout(() => {
        burst.active = false;
        burst.timer = null;
      }, 800);
    } else {
      if (burst.timer) clearTimeout(burst.timer);
      burst.active = false;
      burst.timer = null;
      pushSourceHistory(source);
    }
    setSource(next);
  }

  /** 새 파일을 불러오거나 샘플로 되돌릴 때는 이전 문서의 되돌리기 이력을 들고 있을 이유가 없다. */
  function resetSourceHistory() {
    if (typingBurst.current.timer) clearTimeout(typingBurst.current.timer);
    typingBurst.current = { active: false, timer: null };
    setSourcePast([]);
    setSourceFuture([]);
  }

  const undoSource = useCallback(() => {
    setSourcePast((past) => {
      if (!past.length) return past;
      const previous = past[past.length - 1];
      setSourceFuture((future) => [source, ...future]);
      setSource(previous);
      return past.slice(0, -1);
    });
  }, [source]);

  const redoSource = useCallback(() => {
    setSourceFuture((future) => {
      if (!future.length) return future;
      const [next, ...rest] = future;
      setSourcePast((past) => [...past, source]);
      setSource(next);
      return rest;
    });
  }, [source]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redoSource();
      } else if (key === "z") {
        event.preventDefault();
        undoSource();
      } else if (key === "y") {
        event.preventDefault();
        redoSource();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoSource, redoSource]);

  function replaceCard(card: SerpentCard) {
    const next = cards.map((item) => (item.id === card.id ? card : item));
    updateSource(serializeCards(next));
  }

  function handleField(key: string, value: string) {
    if (!selected) return;
    replaceCard(updateCard(selected, { ...selectedData, [key]: value } as Record<string, string>));
  }

  function addCard(type: string) {
    const nextSource = source.trimEnd() + (CARD_TEMPLATES[type] ?? "");
    updateSource(nextSource);
    const nextCards = parseSerpentInput(nextSource);
    setSelectedId(nextCards[nextCards.length - 1]?.id ?? "");
    setShowAdd(false);
    setView("builder");
  }

  /** 우리가 넣어준 뒤로 사용자가 편집하지 않았다면 갈아끼워도 안전하다. */
  function sourceIsUntouched() {
    return source === loadedSource.current;
  }

  function loadInput(file: IngestedFile) {
    loadedSource.current = file.text;
    setSource(file.text);
    resetSourceHistory();
    // 파일을 새로 여는 것은 편집 중 타이핑이 아니라 완전히 새 내용이므로 곧바로 반영한다.
    setGeometrySource(file.text);
    setFileName(file.name);
    setSelectedId("");
    // 계산 정리에 쓸 폴더·수정 시각은 File 객체를 읽는 이 시점에만 알 수 있다.
    setInputFileInfo(file);
  }

  /** 형상 미리보기를 지금 편집 중인 원문으로 다시 계산한다. */
  function refreshGeometry() {
    setGeometrySource(source);
  }

  /**
   * 고르거나 끌어다 놓은 파일을 한 경로로 처리한다.
   *
   * 결과문과 입력문을 내용으로 구분한 뒤 이름이 같은 것끼리 이어 준다.
   * 결과문만 들어오면 결과 탭을, 입력문만 들어오면 편집 화면을 연다.
   *
   * 검출기(det) 출력은 _res.m 과 완전히 다른 파일(`[input]_det[idx].m`)이자
   * 다른 문법(`DETNAME = [ ... ];` 행렬)이라 여기서 먼저 걸러내 별도로 다룬다.
   * 나머지 입력문/결과문 분류(ingest)는 그다음에 손댄다.
   */
  async function ingestFiles(files: IngestedFile[], intent: "input" | "result" | "any" = "any") {
    const detectorFiles = files.filter((file) => isDetectorFileName(file.name) || looksLikeDetectorFile(file.text));
    const rest = files.filter((file) => !detectorFiles.includes(file));
    const detectorKeys = detectorFiles.map((file) => ({
      file,
      key: `${file.dir}␟${detectorBaseName(file.name)}`,
    }));
    const resultKey = (item: { dir: string; fileName: string }) =>
      `${item.dir}␟${item.fileName.replace(/_res\.m$/i, "").replace(/\.m$/i, "")}`;

    if (detectorFiles.length) {
      const nextLibrary = new Map(detectorLibrary);
      for (const { file, key } of detectorKeys) nextLibrary.set(key, parseDetectorFile(file.text));
      setDetectorLibrary(nextLibrary);
    }

    if (!rest.length) {
      if (detectorFiles.length) {
        // 결과문 없이 검출기 출력만 들어온 경우, 지금 열려 있는 결과 탭 중에 짝이 있는지만 본다
        // (같은 배치로 함께 고른 결과문과의 연결은 rest.length 가 0 이 아닌 아래 분기에서 처리된다).
        const linked = detectorKeys.filter(({ key }) => results.some((item) => resultKey(item) === key)).length;
        setLinkNotice(
          linked
            ? t("검출기 출력 {n}개를 불러와 열려 있는 결과에 연결했습니다.").replace("{n}", String(detectorFiles.length))
            : t("검출기 출력 {n}개를 불러왔습니다. 같은 이름의 결과문을 열면 스펙트럼에서 고를 수 있습니다.").replace("{n}", String(detectorFiles.length)),
        );
      } else {
        setLinkNotice(
          intent === "result"
            ? t("Serpent 결과문(_res.m)을 찾지 못했습니다.")
            : t("Serpent 입력문을 찾지 못했습니다."),
        );
      }
      return;
    }

    const batch = ingest(rest);
    if (!batch.results.length && !batch.inputs.length) {
      setLinkNotice(
        intent === "result"
          ? t("Serpent 결과문(_res.m)을 찾지 못했습니다.")
          : t("Serpent 입력문을 찾지 못했습니다."),
      );
      return;
    }

    // 결과문 없이 입력문만 들어오면 아래에서 편집기 내용을 곧바로 갈아끼운다(loadInput).
    // 지금 편집 중인 내용이 저장되지 않은 상태라면 조용히 덮어쓰지 않고 먼저 확인한다.
    const willReplaceEditor = !batch.results.length && batch.inputs.length > 0;
    if (willReplaceEditor && !sourceIsUntouched()) {
      const proceed = window.confirm(
        t("지금 편집 중인 입력문에 저장하지 않은 변경 사항이 있습니다. 새 입력문을 열면 그 내용이 사라집니다. 계속할까요?"),
      );
      if (!proceed) return;
    }

    // 같은 이름의 입력문을 계속 들고 있어야 결과 탭을 옮길 때도 짝을 찾을 수 있다.
    const library = new Map(inputLibrary);
    for (const [key, file] of batch.inputByKey) library.set(key, file);
    setInputLibrary(library);

    let linked = 0;
    if (batch.results.length) {
      const stamp = Date.now();
      const loaded = batch.results.map((file, index) =>
        buildResultCase(file.name, file.text, `${stamp}-${index}-${file.name}`, file.dir),
      );
      for (const file of batch.results) {
        if (library.has(pairKey(file, "result"))) linked += 1;
      }
      setResults((current) => {
        const kept = current.filter((item) => !loaded.some((next) => next.fileName === item.fileName));
        const merged = [...kept, ...loaded];
        setReferenceId((id) => (merged.some((item) => item.id === id) ? id : merged[0]?.id ?? ""));
        return merged;
      });
      setOpenedResultFiles((current) => {
        const kept = current.filter((item) => !batch.results.some((file) => file.name === item.name && file.dir === item.dir));
        return [...kept, ...batch.results];
      });
      setActiveResultId(loaded[0].id);
    } else {
      // 입력문만 들어온 경우, 이미 열려 있는 결과 중 같은 이름이 있으면 그 탭으로 옮긴다.
      const match = results.find((item) =>
        batch.inputs.some((file) => pairKey(file, "input") === pairKey({ name: item.fileName, dir: item.dir, text: "" }, "result")),
      );
      if (match) {
        setActiveResultId(match.id);
        linked += 1;
      }
    }

    // 결과문의 짝이 있으면 그 입력문을, 없으면 그냥 첫 입력문을 연다.
    const paired = batch.results.map((file) => library.get(pairKey(file, "result"))).find(Boolean);
    const toOpen = paired ?? batch.inputs[0];
    if (toOpen && (sourceIsUntouched() || !batch.results.length)) loadInput(toOpen);

    setView(
      intent === "input" ? "builder" : intent === "result" ? "results" : batch.results.length ? "results" : "builder",
    );
    const detectorSuffix = detectorFiles.length
      ? t(" 검출기 출력 {n}개도 함께 연결했습니다.").replace("{n}", String(detectorFiles.length))
      : "";
    setLinkNotice(
      (batch.results.length && batch.inputs.length
        ? t("결과문 {r}개 · 입력문 {i}개를 불러와 {n}개를 이름으로 연결했습니다.")
          .replace("{r}", String(batch.results.length)).replace("{i}", String(batch.inputs.length)).replace("{n}", String(linked))
        : batch.results.length
          ? linked
            ? t("결과문 {n}개를 불러와 이미 열린 입력문에 연결했습니다.").replace("{n}", String(batch.results.length))
            : t("결과문 {n}개를 탭으로 열었습니다.").replace("{n}", String(batch.results.length))
          : linked
            ? t("입력문을 불러오고 이름이 같은 결과문에 연결했습니다.")
            : t("입력문을 불러왔습니다.")) + detectorSuffix,
    );
  }

  async function onPickInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) await ingestFiles(await readFiles(files), "input");
  }

  async function onPickResults(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) await ingestFiles(await readFiles(files), "result");
  }

  async function onDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    setDropping(false);
    const files = await readDropped(event.dataTransfer.items);
    if (files.length) await ingestFiles(files, "any");
  }

  /** 결과 케이스에 짝지어진 입력문을 찾는다. */
  function inputFor(item: ResultCase) {
    return inputLibrary.get(pairKey({ name: item.fileName, dir: item.dir, text: "" }, "result"));
  }

  /** 결과 케이스에 짝지어진 검출기(det) 스펙트럼들을 찾는다. */
  function detectorsFor(item: ResultCase) {
    const key = `${item.dir}␟${item.fileName.replace(/_res\.m$/i, "").replace(/\.m$/i, "")}`;
    return detectorLibrary.get(key) ?? [];
  }

  /**
   * 결과 탭을 옮기면 짝지어진 입력문도 따라 열어 준다.
   * 단 사용자가 편집 중이던 내용은 말없이 덮어쓰지 않는다.
   */
  function pickActiveResult(id: string) {
    setActiveResultId(id);
    const item = results.find((entry) => entry.id === id);
    const paired = item && inputFor(item);
    if (paired && paired.text !== source && sourceIsUntouched()) loadInput(paired);
  }

  function removeResult(id: string) {
    const removed = results.find((item) => item.id === id);
    if (removed) {
      setOpenedResultFiles((current) =>
        current.filter((file) => file.name !== removed.fileName || file.dir !== removed.dir),
      );
    }
    setResults((current) => {
      const next = current.filter((item) => item.id !== id);
      setReferenceId((currentId) => (next.some((item) => item.id === currentId) ? currentId : next[0]?.id ?? ""));
      setActiveResultId((currentId) => (next.some((item) => item.id === currentId) ? currentId : next[0]?.id ?? ""));
      return next;
    });
  }

  function downloadInput() {
    triggerDownload(source, fileName, "text/plain;charset=utf-8");
  }

  /**
   * 계산 정리 마크다운 + 그 마크다운이 참조하는 PNG 파일 계획. 이미지는 마크다운 안에
   * 박아 넣지 않고 별도 파일로 내려받으므로, 마크다운이 쓰는 파일 이름과 실제로 만들어
   * 내려받는 파일 이름이 여기서부터 하나로 정해진다.
   */
  const summaryResult = useMemo(() => renderSummaryMarkdown({
    meta: summaryMeta,
    inputName: fileName,
    inputText: source,
    inputFile: inputFileInfo,
    cards,
    cases: results,
    referenceId,
    resultFiles: openedResultFiles,
    geometryImage,
  }), [summaryMeta, fileName, source, inputFileInfo, cards, results, referenceId, openedResultFiles, geometryImage]);
  const summaryMarkdown = summaryResult.markdown;
  // 한글·± 같은 다중바이트 문자가 많아 .length(UTF-16 코드 유닛)로는 실제 파일 크기와
  // 어긋난다. 다운로드되는 Blob 과 같은 기준(UTF-8 바이트)으로 재야 한다.
  const summaryByteSize = useMemo(
    () => new TextEncoder().encode(summaryMarkdown).length,
    [summaryMarkdown],
  );

  const [downloadingSummary, setDownloadingSummary] = useState(false);

  /**
   * 계산 정리 md · 형상 PNG · (케이스별) 스펙트럼 PNG 를 각각 별도 파일로 내려받는다.
   * 이미지를 마크다운에 박아 넣으면 일반 텍스트 편집기로 열었을 때 base64 덩어리가
   * 본문을 가로막으므로, 이미지는 항상 이름이 정해진 별도 파일로 받고 마크다운은
   * 그 파일 이름만 상대경로로 참조한다 — 같은 폴더에 두면 렌더러에서 그대로 보인다.
   */
  async function downloadSummary() {
    setDownloadingSummary(true);
    try {
      triggerDownload(
        summaryMarkdown,
        summaryFileName(fileName, undefined, summaryMeta.locale),
        "text/markdown;charset=utf-8",
      );
      // 브라우저가 "자동으로 여러 파일 다운로드" 방지 로직을 걸 때가 있어, 트리거를
      // 붙여 쏘면 뒤쪽 일부가 조용히 씹힐 수 있다. 파일 사이에 짧게 쉬어 각 다운로드가
      // 개별적으로 시작되게 한다.
      await wait(350);

      const { images } = summaryResult;
      if (images.geometry && geometryImage) {
        const blob = await dataUrlToBlob(geometryImage.dataUrl);
        triggerDownload(blob, images.geometry);
        await wait(350);
      }
      for (const spec of images.spectra) {
        const item = results.find((r) => r.id === spec.caseId);
        const svg = item ? renderSpectrumSvg(item.spectrum) : null;
        if (!svg) continue;
        const blob = await svgToPngBlob(svg, SPECTRUM_SVG_WIDTH, SPECTRUM_SVG_HEIGHT);
        triggerDownload(blob, spec.fileName);
        await wait(350);
      }
    } finally {
      setDownloadingSummary(false);
    }
  }

  function updateSummaryMeta(field: keyof SummaryMeta, value: string) {
    setSummaryMeta((current) => ({ ...current, [field]: value }));
  }

  function setSummaryIncludeImages(value: boolean) {
    setSummaryMeta((current) => ({ ...current, includeImages: value }));
  }

  function setSummaryLocale(locale: SummaryMeta["locale"]) {
    setSummaryMeta((current) => ({ ...current, locale }));
  }

  /**
   * 형상 미리보기 캔버스를 찍는다. 캔버스는 순수 함수로 다시 그릴 수 없으므로 이 시점에
   * 화면에 보이던 그대로를 스냅샷으로 둔다. "계산 정리" 탭을 열 때, 그리고 패널의
   * 수동 새로고침 버튼을 눌렀을 때만 부른다 — 팬/줌을 할 때마다 부르면 그때마다 PNG
   * 인코딩이 돌아 형상 미리보기 자체가 버벅이게 된다.
   */
  function captureGeometryImage() {
    const snapshot = geometryPreviewRef.current?.captureImage();
    if (snapshot) setGeometryImage(snapshot);
  }

  return (
    <main
      className={dropping ? "app-shell dropping" : "app-shell"}
      onDragOver={(event) => { event.preventDefault(); setDropping(true); }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDropping(false); }}
      onDrop={onDrop}
    >
      {dropping && (
        <div className="drop-veil" aria-hidden="true">
          <div>
            <strong>{t("여기에 놓으세요")}</strong>
            <span>{t("폴더를 놓으면 이름이 같은 입력문과 결과문을 자동으로 연결합니다.")}</span>
          </div>
        </div>
      )}
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
            aria-label={t("파일 이름")}
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
          />
          <span className="saved-dot" />
          <span>{t("편집 중")}</span>
        </div>
        <div className="top-actions">
          <div className="locale-toggle" role="group" aria-label="Interface language">
            <button
              type="button"
              className={uiLocale === "ko" ? "active" : ""}
              onClick={() => changeUiLocale("ko")}
            >한국어</button>
            <button
              type="button"
              className={uiLocale === "en" ? "active" : ""}
              onClick={() => changeUiLocale("en")}
            >English</button>
          </div>
          <div className="font-size-control" role="group" aria-label={t("글씨 크기 조절")}>
            <button
              type="button"
              aria-label={t("글씨 작게")}
              title={t("글씨 작게")}
              disabled={fontScale <= FONT_SCALE_MIN}
              onClick={() => changeFontScale(fontScale - FONT_SCALE_STEP)}
            >A−</button>
            <button
              type="button"
              className="font-size-value"
              aria-label={t("기본 글씨 크기로 되돌리기")}
              title={t("기본 글씨 크기로 되돌리기")}
              onClick={() => changeFontScale(100)}
            >{fontScale}%</button>
            <button
              type="button"
              aria-label={t("글씨 크게")}
              title={t("글씨 크게")}
              disabled={fontScale >= FONT_SCALE_MAX}
              onClick={() => changeFontScale(fontScale + FONT_SCALE_STEP)}
            >A+</button>
          </div>
          {/* 종류는 내용을 보고 가리므로 accept 로 거르지 않는다.
              필터를 걸면 확장자 없는 Serpent 입력문이 회색 처리돼 고를 수 없다. */}
          <input
            ref={fileInput}
            type="file"
            aria-label={t("SERPENT 입력문 선택")}
            hidden
            onChange={onPickInput}
          />
          <input
            ref={resultInput}
            type="file"
            aria-label={t("Serpent 결과 파일 선택")}
            multiple
            hidden
            onChange={onPickResults}
          />
          <button
            className="button ghost"
            title={t("Serpent 입력문을 엽니다. 같은 이름의 결과문이 이미 열려 있으면 연결합니다.")}
            onClick={() => fileInput.current?.click()}
          >
            <Icon>↥</Icon> {t("열기")}
          </button>
          <button
            className="button ghost"
            title={t("결과문(_res.m)을 엽니다. 여러 개를 골라 탭으로 비교할 수 있습니다.")}
            onClick={() => resultInput.current?.click()}
          >
            <Icon>◫</Icon> {t("결과 열기")}
          </button>
          <button className="button ghost" onClick={downloadInput}>
            <Icon>↓</Icon> {t("내보내기")}
          </button>
        </div>
      </header>

      {linkNotice && (
        <div className="link-notice" role="status">
          <span>{linkNotice}</span>
          <button aria-label={t("안내 닫기")} onClick={() => setLinkNotice("")}>×</button>
        </div>
      )}

      {/*
        형상 미리보기 폭은 CSS 변수로만 넘긴다. grid-template-columns 자체를 인라인으로
        고정하면 좁은 화면에서 사이드바·검사결과를 숨기는 아래 미디어 쿼리들과 트랙 개수가
        어긋나 요소들이 엉뚱한 칸에 배치된다 — 트랙 배치는 항상 CSS 쪽 책임으로 남긴다.
      */}
      <section
        className="workspace"
        style={{ "--geometry-width": `${geometryWidth}px` } as CSSProperties}
      >
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>{t("모델 구성")}</span>
            <button className="icon-button" aria-label={t("카드 추가")} onClick={() => setShowAdd(!showAdd)}>＋</button>
          </div>
          {showAdd && (
            <div className="add-menu">
              {Object.keys(CARD_TEMPLATES).map((key) => (
                <button key={key} onClick={() => addCard(key)}>
                  <Icon>＋</Icon>{t(formatKind(key as CardKind))}
                </button>
              ))}
            </div>
          )}
          <div className="sidebar-search">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              aria-label={t("카드 검색")}
              placeholder={t("이름 · 값으로 카드 찾기")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button className="search-clear" aria-label={t("검색어 지우기")} onClick={() => setQuery("")}>×</button>
            )}
          </div>
          <nav className="model-tree" aria-label={t("Serpent 카드")}>
            {groupedCards.map((group) => {
              const collapsed = !query && collapsedGroups.includes(group.name);
              return (
                <div className="tree-group" key={group.name}>
                  <button
                    className={collapsed ? "tree-label collapsed" : "tree-label"}
                    title={t(group.hint)}
                    aria-expanded={!collapsed}
                    onClick={() => toggleGroup(group.name)}
                  >
                    <span className="chevron" aria-hidden="true">▼</span>
                    <span className="group-icon" aria-hidden="true">{group.icon}</span>
                    <span>{t(group.name)}</span>
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
              <p className="tree-empty">{query ? t("'{q}'와 일치하는 카드가 없습니다.").replace("{q}", query) : t("카드가 없습니다.")}</p>
            )}
          </nav>
          <div className="project-health">
            <div className="health-row">
              <span>{t("모델 상태")}</span>
              <strong className={errors ? "bad" : "good"}>{errors ? t("{n} 오류").replace("{n}", String(errors)) : t("정상")}</strong>
            </div>
            <div className="health-meter"><span style={{ width: errors ? "64%" : "100%" }} /></div>
            <small>
              {query
                ? t("{shown} / {total}개 카드 표시 중").replace("{shown}", String(matchCount)).replace("{total}", String(cards.length))
                : t("{total}개 카드 · Serpent 2 형식").replace("{total}", String(cards.length))}
            </small>
          </div>
        </aside>

        <section className="editor-pane">
          <div className="editor-tabs">
            <button className={view === "builder" ? "active" : ""} onClick={() => setView("builder")}>
              {t("구조화 편집")}
            </button>
            <button className={view === "source" ? "active" : ""} onClick={() => setView("source")}>
              {t("원문 입력")}
            </button>
            <button className={view === "results" ? "active" : ""} onClick={() => setView("results")}>
              {t("결과 분석")}
              {results.length > 0 && <span className="tab-count">{results.length}</span>}
            </button>
            <button
              className={view === "summary" ? "active" : ""}
              onClick={() => { setView("summary"); captureGeometryImage(); }}
            >
              {t("계산 정리")}
            </button>
            <div className="undo-group">
              {/* 화면이 760px 이하로 좁아지면 형상 미리보기 패널 전체가 숨는다(공간이 없어서).
                  이 버튼은 그 폭에서만 CSS로 나타나 전체화면 오버레이로 다시 열어 준다. */}
              <button
                className="icon-button mobile-geometry-toggle"
                title={t("형상 미리보기 열기")}
                aria-label={t("형상 미리보기 열기")}
                onClick={() => setMobileGeometryOpen(true)}
              >◫</button>
              <button
                className="icon-button"
                title={sourcePast.length ? t("되돌리기 (Ctrl+Z) · {n}개").replace("{n}", String(sourcePast.length)) : t("되돌릴 편집이 없습니다")}
                aria-label={t("편집 되돌리기")}
                disabled={!sourcePast.length}
                onClick={undoSource}
              >⟲</button>
              <button
                className="icon-button"
                title={sourceFuture.length ? t("다시 실행 (Ctrl+Shift+Z) · {n}개").replace("{n}", String(sourceFuture.length)) : t("다시 실행할 편집이 없습니다")}
                aria-label={t("편집 다시 실행")}
                disabled={!sourceFuture.length}
                onClick={redoSource}
              >⟳</button>
              <button
                className="icon-button"
                title={t("샘플로 되돌리기")}
                onClick={() => {
                  if (
                    !sourceIsUntouched() &&
                    !window.confirm(t("지금 편집 중인 내용을 버리고 샘플 입력으로 되돌릴까요?"))
                  ) {
                    return;
                  }
                  loadedSource.current = SAMPLE_INPUT;
                  setSource(SAMPLE_INPUT);
                  resetSourceHistory();
                  setGeometrySource(SAMPLE_INPUT);
                  // 더 이상 그 파일의 내용이 아니므로 폴더·수정 시각을 들고 있으면 거짓말이 된다.
                  setInputFileInfo(undefined);
                }}
              >↶</button>
            </div>
          </div>

          {view === "summary" ? (
            <SummaryPanel
              meta={summaryMeta}
              onChange={updateSummaryMeta}
              onToggleImages={setSummaryIncludeImages}
              onChangeLocale={setSummaryLocale}
              markdown={summaryMarkdown}
              markdownSize={summaryByteSize}
              onDownload={downloadSummary}
              downloading={downloadingSummary}
              fileName={summaryFileName(fileName, undefined, summaryMeta.locale)}
              imagePlan={summaryResult.images}
              inputFile={inputFileInfo}
              resultCount={results.length}
              geometryImage={geometryImage}
              onRecaptureImage={captureGeometryImage}
              t={t}
            />
          ) : view === "results" ? (
            <ResultsPanel
              cases={results}
              referenceId={referenceId}
              activeId={activeResultId}
              onPickActive={pickActiveResult}
              onPickReference={setReferenceId}
              onOpen={() => resultInput.current?.click()}
              onRemove={removeResult}
              linkedInput={inputFor}
              onOpenLinkedInput={(file) => { loadInput(file); setView("builder"); }}
              detectorsFor={detectorsFor}
              t={t}
              uiLocale={uiLocale}
            />
          ) : view === "source" ? (
            <div className="source-editor">
              <div className="source-toolbar">
                <span>Serpent 2 input</span>
                <span>{source.split("\n").length} lines</span>
              </div>
              <textarea
                aria-label={t("Serpent 원문 입력")}
                spellCheck={false}
                value={source}
                onChange={(event) => updateSource(event.target.value, { coalesce: true })}
              />
            </div>
          ) : selected ? (
            <div className="form-editor">
              <div className="card-header">
                <div>
                  <span className="eyebrow">{t(cardCategory(selected))} · {t(formatKind(selected.kind))}</span>
                  <h1>{selected.label}</h1>
                  <p>{t("입력 카드의 값을 수정하면 Serpent 원문에 바로 반영됩니다.")}</p>
                </div>
                <span className="line-badge">LINE {selected.startLine}</span>
              </div>

              {selectedGuide && (
                <section className="card-guide" aria-label={t("Serpent 매뉴얼 안내")}>
                  <div className="guide-copy">
                    <span>{t("공식 매뉴얼 기반 안내")}</span>
                    <strong>{selectedGuide.title}</strong>
                    <p>{selectedGuide.description}</p>
                  </div>
                  <code>{selectedGuide.syntax}</code>
                  <div className="current-values">
                    <div className="current-values-head">
                      <span>{t("현재 입력값 해석")}</span>
                      <small>{t("입력값을 수정하면 설명도 즉시 갱신됩니다.")}</small>
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
                    {t("공식 문법 보기 ↗")}
                  </a>
                </section>
              )}

              <h2 className="form-section-title">{t("입력값 편집")}</h2>
              <div className="form-grid">
                {Object.entries(selectedData).map(([key, value]) => {
                  const wide = ["values", "region", "composition", "comment"].includes(key);
                  const hint = fieldHint(selected, key, selectedData, uiLocale);
                  return (
                    <label className={wide ? "field wide" : "field"} key={`${selected.id}-${key}`}>
                      <span>{fieldLabel(selected, key, uiLocale)}</span>
                      {key === "composition" ? (
                        <div className="composition-editor">
                          <textarea
                            value={value}
                            spellCheck={false}
                            onChange={(event) => handleField(key, event.target.value)}
                          />
                          <div className="composition-hints" aria-label={t("핵종 조성 해석")}>
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
                                        ? describeNuclide(info, uiLocale)
                                        : t("라이브러리 접미사(예: .09c)가 없어 해석할 수 없습니다.")}
                                    </span>
                                  </div>
                                );
                              })
                            ) : (
                              <p className="composition-hint-empty">
                                {t("핵종을 입력하면 원소·질량수·라이브러리를 해석해 표시합니다. 예: 92235.09c → 우라늄-235, 라이브러리 09c")}
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
                  <span>{t("생성된 입력 카드")}</span>
                  <small>{t("원문 입력 탭에서도 직접 수정할 수 있습니다.")}</small>
                </div>
                <code>{selected.lines.filter((line) => line.trim()).join("\n")}</code>
              </div>
            </div>
          ) : (
            <div className="empty-state">{t("편집할 카드를 선택하세요.")}</div>
          )}
        </section>

        <div
          className={resizingGeometry ? "pane-resizer active" : "pane-resizer"}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("형상 미리보기 폭 조절")}
          aria-valuenow={geometryWidth}
          aria-valuemin={GEOMETRY_WIDTH_MIN}
          aria-valuemax={GEOMETRY_WIDTH_MAX}
          tabIndex={0}
          onPointerDown={beginGeometryResize}
          onDoubleClick={resetGeometryWidth}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setGeometryWidth((width) => Math.min(GEOMETRY_WIDTH_MAX, width + 24));
            else if (event.key === "ArrowRight") setGeometryWidth((width) => Math.max(GEOMETRY_WIDTH_MIN, width - 24));
            else return;
            event.preventDefault();
          }}
        />

        <aside
          className={mobileGeometryOpen ? "geometry-pane mobile-open" : "geometry-pane"}
          aria-label={t("형상 미리보기")}
        >
          <div className="geometry-pane-heading">
            <span>{t("형상 미리보기")}</span>
            <div className="geometry-heading-actions">
              {mobileGeometryOpen && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("형상 미리보기 닫기")}
                  title={t("닫기")}
                  onClick={() => setMobileGeometryOpen(false)}
                >×</button>
              )}
              <button
                type="button"
                className={geometryStale ? "refresh-button stale" : "refresh-button"}
                onClick={refreshGeometry}
                disabled={!geometryStale}
                title={
                  geometryStale
                    ? t("입력이 바뀌었습니다. 눌러서 형상을 다시 그립니다.")
                    : t("형상이 최신 상태입니다.")
                }
              >
                <Icon>↻</Icon> {geometryStale ? t("새로고침 필요") : t("새로고침")}
              </button>
              <button
                type="button"
                className={`issues-button ${issuesTone}`}
                onClick={() => setShowIssues(true)}
                aria-haspopup="dialog"
              >
                <span className={issuesTone === "ok" ? "status-dot" : `status-dot ${issuesTone}`} />
                {t("검사 결과")} <strong>{issuesLabel}</strong>
              </button>
            </div>
          </div>
          <GeometryPreview
            ref={geometryPreviewRef}
            model={geometryModel}
            selectedSurfaceId={selected?.kind === "surface" ? selectedData.name : ""}
            t={t}
          />
        </aside>
      </section>

      {showIssues && (
        <div className="modal-veil" role="presentation" onClick={() => setShowIssues(false)}>
          <div
            className="issues-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("검사 결과")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="issues-modal-head">
              <span>{t("검사 결과")}</span>
              <button aria-label={t("닫기")} onClick={() => setShowIssues(false)}>×</button>
            </div>
            <div className="issues">
              <div className="issue-summary">
                <div className={errors ? "summary-icon error" : "summary-icon"}>{errors ? "!" : "✓"}</div>
                <div>
                  <strong>{errors ? t("입력을 확인해 주세요") : t("치명적인 오류가 발견되지 않았습니다")}</strong>
                  <span>{errors} errors · {issues.length - errors} warnings</span>
                </div>
              </div>
              <p className="issues-stale-note">
                {geometryStale
                  ? t("형상 관련 오류(겹침·빈틈)는 새로고침 이후 기준입니다. 방금 편집한 내용은 아직 반영되지 않았을 수 있습니다.")
                  : t("형상 겹침·빈틈 검사는 격자 표본점만 확인합니다. 아주 얇은 틈이나 국소적인 겹침은 표본 사이로 빠져나가 놓칠 수 있습니다.")}
              </p>
              {issues.length ? issues.map((issue, index) => (
                <button
                  className={`issue ${issue.level}`}
                  key={`${issue.message}-${index}`}
                  onClick={() => {
                    const cardId = issueCardId(issue);
                    if (cardId) { setSelectedId(cardId); setView("builder"); }
                    setShowIssues(false);
                  }}
                >
                  <span>{issue.level === "error" ? "×" : "!"}</span>
                  <div><strong>{issue.level === "error" ? t("오류") : t("권장 사항")}</strong><p>{issue.message}</p></div>
                </button>
              )) : (
                <div className="all-clear">{t("표본 검사에서 문제가 발견되지 않았습니다.")}</div>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="statusbar">
        <div><span className={errors ? "status-light error" : "status-light"} /> {errors ? t("검사 필요") : t("기본 검증 통과")}</div>
        <div className="status-center"><span>Surfaces {cards.filter((c) => c.kind === "surface").length}</span><span>Cells {cards.filter((c) => c.kind === "cell").length}</span><span>Materials {cards.filter((c) => c.kind === "material").length}</span></div>
        <button onClick={() => setLogOpen(!logOpen)}>⌃ {t("실행 콘솔")}</button>
      </footer>

      {logOpen && (
        <div className="console">
          <div className="console-head"><span>{t("입력 검사 콘솔")}</span><button onClick={() => setLogOpen(false)}>×</button></div>
          <pre>
{`SERPENT Studio validator
Reading ${fileName}...
Parsed ${cards.length} input cards.
${errors ? `Found ${errors} error(s) and ${issues.length - errors} warning(s).` : `No blocking errors found. ${issues.length} recommendation(s).`}

${t("브라우저 버전에서는 문법과 참조 무결성을 검사합니다.")}
${t("정식 계산 전에는 설치된 Serpent에서 입력 검사를 다시 수행하세요.")}`}
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

/** 형상 미리보기 캔버스를 밖에서(계산 정리 탭) 찍을 수 있도록 여는 손잡이. */
type GeometryPreviewHandle = {
  captureImage: () => SummaryGeometryImage | null;
};

const GeometryPreview = forwardRef<GeometryPreviewHandle, {
  model: GeometryModel;
  selectedSurfaceId: string;
  t: (ko: string) => string;
}>(function GeometryPreview({ model, selectedSurfaceId, t }, ref) {
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

  // 캔버스를 직접 읽는 쪽이 필요할 때만 부르는 명령형 손잡이라 useMemo/useState 로
  // 감쌀 이유가 없다 — 매 렌더마다 캔버스를 인코딩하지 않는다는 게 핵심이다.
  useImperativeHandle(ref, () => ({
    captureImage: () => {
      const element = canvas.current;
      if (!element || !element.width || !element.height) return null;
      return {
        dataUrl: element.toDataURL("image/png"),
        width: element.width,
        height: element.height,
        basis: basis.toUpperCase(),
      };
    },
  }), [basis]);

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
        // 이 덧칠은 제어드럼 흡수체처럼 래스터가 놓칠 만큼 얇은 호를 또렷하게 살리려는 것이다.
        // 그런데 pad 를 방위각 절단용으로만 쓰는 입력도 있다(예: r 0.01~200 으로 노심 전체를
        // 가로지르는 타일 구획용 pad). 그런 pad 안에는 서로 다른 셀이 잔뜩 들어 있어서
        // 중간 반경에서 뽑은 물질 하나로 칠해 버리면 멀쩡한 래스터를 통째로 덮어 버린다.
        // 래스터가 스스로 표현할 수 있는 두께라면 손대지 않는다.
        if (Math.abs((v[3] ?? 0) - (v[2] ?? 0)) * scale >= 2) continue;
        const { start, end } = padAngleRange(v);
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
        const radius = v[2] ?? 0;
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
        drawDimension(
          center,
          edge,
          `${activeSurface.id} · ${activeSurface.type === "sqc" ? t("반폭") : "R"} ${radius.toFixed(3)} cm`,
        );
      } else if (basis === "xy" && activeSurface.type === "pad") {
        const angular = padAngleRange(v);
        const angle = (((angular.start + angular.end) / 2) * Math.PI) / 180;
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
        drawDimension(center, edge, `${activeSurface.id} · ${t("단면")} R ${sectionRadius.toFixed(3)} cm`);
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
          const radius = v[2] ?? 0;
          const zMin = v.length >= 5 ? Math.min(v[3] ?? verticalMax - vSpan, v[4] ?? verticalMax) : verticalMax - vSpan;
          const zMax = v.length >= 5 ? Math.max(v[3] ?? verticalMax - vSpan, v[4] ?? verticalMax) : verticalMax;
          const zMiddle = (zMin + zMax) / 2;
          const leftX = toCanvas(centerCoordinate - radius, 0).x;
          const rightX = toCanvas(centerCoordinate + radius, 0).x;
          const topY = toCanvas(0, zMax).y;
          const bottomY = toCanvas(0, zMin).y;
          context.beginPath();
          context.rect(leftX, topY, rightX - leftX, bottomY - topY);
          context.stroke();
          drawDimension(
            toCanvas(centerCoordinate, zMiddle),
            toCanvas(centerCoordinate + radius, zMiddle),
            `${activeSurface.id} · R ${radius.toFixed(3)} cm`,
          );
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
      const axialRange = v.length >= 5 ? ` · z ${(v[3] ?? 0).toFixed(2)}…${(v[4] ?? 0).toFixed(2)}` : "";
      return {
        position: `(${(v[0] ?? 0).toFixed(2)}, ${(v[1] ?? 0).toFixed(2)})`,
        dimension: `R ${(v[2] ?? 0).toFixed(3)} · ${t("중심거리")} ${centerDistance.toFixed(3)}${axialRange}`,
      };
    }
    if (surface.type === "pad") {
      return {
        position: `(${(v[0] ?? 0).toFixed(2)}, ${(v[1] ?? 0).toFixed(2)})`,
        dimension: `R ${(v[2] ?? 0).toFixed(2)}–${(v[3] ?? 0).toFixed(2)} · ${v[4] ?? 0}°–${v[5] ?? 0}°`,
      };
    }
    if (surface.type === "pz") {
      return { position: `z = ${(v[0] ?? 0).toFixed(3)}`, dimension: `${t("원점거리")} ${Math.abs(v[0] ?? 0).toFixed(3)}` };
    }
    if (surface.type === "sph") {
      return {
        position: `(${(v[0] ?? 0).toFixed(1)}, ${(v[1] ?? 0).toFixed(1)}, ${(v[2] ?? 0).toFixed(1)})`,
        dimension: `R ${(v[3] ?? 0).toFixed(3)}`,
      };
    }
    if (surface.type === "sqc") {
      const cornerRadius = v[3];
      return {
        position: `(${(v[0] ?? 0).toFixed(2)}, ${(v[1] ?? 0).toFixed(2)})`,
        dimension: `${t("반폭")} ${(v[2] ?? 0).toFixed(3)}${Number.isFinite(cornerRadius) ? ` · ${t("모서리 R")} ${cornerRadius.toFixed(3)}` : ""}`,
      };
    }
    return { position: `${surface.type} = ${(v[0] ?? 0).toFixed(3)}`, dimension: `${t("원점거리")} ${Math.abs(v[0] ?? 0).toFixed(3)}` };
  }

  const hoverColor = hover ? materialColor(model, hover.material) : null;

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <span className="toolbar-label">{t("단면")}</span>
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
            aria-label={`${axisNames[2]} ${t("단면 위치")}`}
            onChange={(event) => setSlice(Number(event.target.value))}
          />
          <input
            type="number"
            step={0.1}
            value={Number(slice.toFixed(4))}
            aria-label={`${axisNames[2]} ${t("단면 좌표")}`}
            onChange={(event) => setSlice(Number(event.target.value))}
          />
          <span>cm</span>
        </label>
        <button
          type="button"
          className={showProblems ? "problem-toggle active" : "problem-toggle"}
          aria-pressed={showProblems}
          title={t("셀이 겹치거나 어떤 셀에도 속하지 않는 영역을 표시합니다.")}
          onClick={() => setShowProblems(!showProblems)}
        >
          <span className="problem-swatch" aria-hidden="true" />
          {t("문제 영역")}
        </button>
        <div className="zoom-control">
          <button onClick={() => changeZoom(1 / 1.4)} aria-label={t("축소")} title={t("축소")}>−</button>
          <span className="zoom-value">{(zoom * 100).toFixed(0)}%</span>
          <button onClick={() => changeZoom(1.4)} aria-label={t("확대")} title={t("확대")}>＋</button>
          <button onClick={resetView} title={t("전체 보기로 되돌리기")}>{t("전체")}</button>
        </div>
      </div>

      <div className={panning ? "canvas-wrap panning" : "canvas-wrap"} ref={wrap}>
        <canvas
          ref={canvas}
          aria-label={`${t("Serpent 입력문에서 생성한 {basis} 재료 평면도").replace("{basis}", basis.toUpperCase())}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onPointerLeave={(event) => { endPan(event); setHover(null); }}
        />
        <div className="canvas-hint">{t("휠 확대 · 드래그 이동")}</div>
      </div>

      <div className="canvas-readout">
        <span className="readout-axes">
          {t("가로 {h} · 세로 {v} · 단면 {a} = {z} cm")
            .replace("{h}", axisNames[0]).replace("{v}", axisNames[1])
            .replace("{a}", axisNames[2]).replace("{z}", String(Number(slice.toFixed(3))))}
        </span>
        {hover ? (
          <>
            <span>{axisNames[0]} <b>{hover.horizontal.toFixed(3)}</b></span>
            <span>{axisNames[1]} <b>{hover.vertical.toFixed(3)}</b></span>
            {hover.overlap.length > 1 && (
              <span className="readout-problem">{t("겹침")}: {hover.overlap.join(" · ")}</span>
            )}
            {hover.status === "undefined" && outsideDefined && (
              <span className="readout-problem">{t("빈틈 — 어떤 셀에도 속하지 않음")}</span>
            )}
            <span className="readout-material">
              <i style={{ background: hoverColor ? `rgb(${hoverColor.join(",")})` : "transparent" }} />
              {hover.material
                || (hover.status === "outside" ? t("outside (계산 영역 바깥)")
                  : hover.status === "unsupported" ? t("미지원 구조(lat 등)")
                  : t("정의되지 않은 공간"))}
            </span>
          </>
        ) : (
          <span className="readout-idle">{t("도면 위에 커서를 올리면 좌표와 물질이 표시됩니다.")}</span>
        )}
      </div>

      <div className="preview-details">
        <div className="legend-block">
          <div className="legend-title">
            <strong>{t("물질 색상")}</strong>
            <small>{t("클릭하면 해당 물질만 강조합니다.")}</small>
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
            {!usedMaterials.length && <span className="no-preview">{t("정의된 물질이 없습니다.")}</span>}
          </div>
          {showProblems && (
            <p className="problem-legend">
              <span className="problem-swatch hatched" aria-hidden="true" />
              {t("빗금은")} <strong>{t("셀 겹침")}</strong> — {t("Serpent는 오류 없이 먼저 정의된 셀만 사용합니다.")}
              <span className="problem-swatch solid" aria-hidden="true" />
              {t("단색은")} <strong>{t("빈틈")}</strong> — {t("실행 중 지오메트리 오류가 납니다.")}
              {!outsideDefined && ` (${t("outside 셀이 없어 빈틈 표시는 꺼져 있습니다.")})`}
            </p>
          )}
        </div>

        <div className="legend-block">
          <div className="legend-title">
            <strong>{t("{basis} 단면 경계 {n}개").replace("{basis}", basis.toUpperCase()).replace("{n}", String(visibleSurfaces.length))}</strong>
            <small>{t("행을 선택하면 도면에 치수가 표시됩니다.")}</small>
          </div>
          {visibleSurfaces.length ? (
            <table className="dimension-table">
              <thead>
                <tr>
                  <th>{t("경계")}</th><th>{t("형식")}</th><th>{t("기준 위치")}</th><th>{t("치수 / 거리")}</th>
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
            <p className="no-preview">{t("현재 단면과 교차하는 지원 표면이 없습니다.")}</p>
          )}
        </div>

        <p className="preview-note">
          {t("이 평면도는 결과 이미지가 아니라 입력문의 표면·셀 Boolean 조건과 물질 색을 픽셀별로 계산해 생성합니다.")}
          {" "}
          {t("직교 격자(lat type 1)와 유니버스 평행이동(trans)을 반영하며, 그 밖의 격자 형식과 회전 변환은 아직 지원하지 않습니다.")}
        </p>
      </div>
    </div>
  );
});

const SPECTRUM_WIDTH = 720;
const SPECTRUM_HEIGHT = 320;
const SPECTRUM_PAD = { left: 74, right: 18, top: 18, bottom: 54 };
/** Serpent 의 MICRO_E 는 MeV 단위지만, 노심 스펙트럼 그림은 관례적으로 eV 축을 쓴다. */
const EV_PER_MEV = 1e6;
/** 봉우리 아래로 이만큼의 decade 까지만 보여준다. 더 넓히면 통계잡음만 늘어난다. */
const SPECTRUM_DECADES = 5;

/**
 * 군 단위 중성자속을 로그-로그 계단 그래프 좌표로 환산한다.
 *
 * 축 관례는 노심해석 논문을 따랐다. 가로는 eV 로그축, 세로는 단위 렙서지당
 * 중성자속의 로그축이고, 군 데이터이므로 곡선이 아니라 계단으로 그린다.
 *
 * 들어온 배열의 정렬 방향은 믿지 않고 여기서 에너지 오름차순으로 세운다.
 * res.m 의 MICRO_E 는 구조에 따라 오름차순(기본 70군)일 때도, 내림차순
 * (누설 보정용 168군)일 때도 있다. 뒤집힌 배열을 그대로 쓰면 축 범위가 음수
 * 폭으로 계산되어 x축 눈금이 한 개도 생성되지 않고 계단도 역방향으로 그려진다.
 */
function buildSpectrumGeometry(bins: ResultCase["spectrum"]) {
  const usable = bins
    .filter((bin) => bin.perLethargy > 0)
    .slice()
    .sort((a, b) => a.low - b.low);
  if (usable.length < 2) return null;

  const width = SPECTRUM_WIDTH;
  const height = SPECTRUM_HEIGHT;
  const pad = SPECTRUM_PAD;
  const plotRight = width - pad.right;
  const plotBottom = height - pad.bottom;

  const eLow = Math.log10(usable[0].low * EV_PER_MEV);
  const eHigh = Math.log10(usable[usable.length - 1].high * EV_PER_MEV);
  const peak = Math.max(...usable.map((bin) => bin.perLethargy));
  const fluxHigh = Math.ceil(Math.log10(peak));
  const fluxLow = fluxHigh - SPECTRUM_DECADES;

  const x = (energyEv: number) =>
    pad.left + ((Math.log10(energyEv) - eLow) / (eHigh - eLow)) * (plotRight - pad.left);
  const y = (flux: number) => {
    const clamped = Math.min(fluxHigh, Math.max(fluxLow, Math.log10(flux)));
    return plotBottom - ((clamped - fluxLow) / (fluxHigh - fluxLow)) * (plotBottom - pad.top);
  };

  // 각 군을 사각형 구간으로 들고 있어야 계단 경로와 마우스 적중 판정을 함께 쓸 수 있다.
  const steps = usable.map((bin, index) => {
    const x1 = x(bin.low * EV_PER_MEV);
    const x2 = x(bin.high * EV_PER_MEV);
    return { index, bin, x1, x2, top: y(bin.perLethargy) };
  });

  const line: string[] = [];
  steps.forEach((step, index) => {
    line.push(`${index === 0 ? "M" : "L"}${step.x1.toFixed(1)} ${step.top.toFixed(1)}`);
    line.push(`L${step.x2.toFixed(1)} ${step.top.toFixed(1)}`);
  });
  const area = `${line.join(" ")} L${steps[steps.length - 1].x2.toFixed(1)} ${plotBottom} L${steps[0].x1.toFixed(1)} ${plotBottom} Z`;

  // 12 decade 를 넘나드는 가로축은 전부 찍으면 겹치므로 2 decade 간격으로 둔다.
  const xTicks: { at: number; exp: number; major: boolean }[] = [];
  for (let decade = Math.ceil(eLow); decade <= Math.floor(eHigh); decade += 1) {
    xTicks.push({ at: x(10 ** decade), exp: decade, major: decade % 2 === 0 });
  }

  const yTicks: { at: number; exp: number }[] = [];
  for (let decade = fluxLow; decade <= fluxHigh; decade += 1) {
    yTicks.push({ at: y(10 ** decade), exp: decade });
  }

  return { width, height, pad, plotRight, plotBottom, steps, line: line.join(" "), area, xTicks, yTicks };
}

/** 10ⁿ 형태의 눈금 라벨. SVG 에는 위첨자가 없으므로 tspan 으로 올린다. */
function TickPower({ x, y, exp, anchor }: { x: number; y: number; exp: number; anchor: "middle" | "end" }) {
  return (
    <text x={x} y={y} className="tick" textAnchor={anchor}>
      {/* 하이픈이 아니라 활자용 마이너스를 써야 지수가 제대로 읽힌다. */}
      10<tspan dy="-4" fontSize="8">{exp < 0 ? `−${Math.abs(exp)}` : exp}</tspan>
    </text>
  );
}

function formatFlux(value: number) {
  const exp = Math.floor(Math.log10(value));
  const mantissa = value / 10 ** exp;
  const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const superscript = `${Math.abs(exp)}`.split("").map((d) => digits[Number(d)]).join("");
  return `${mantissa.toFixed(2)} × 10${exp < 0 ? "⁻" : ""}${superscript}`;
}

function SpectrumChart({ bins, t }: { bins: ResultCase["spectrum"]; t: (ko: string) => string }) {
  const geometry = useMemo(() => buildSpectrumGeometry(bins), [bins]);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!geometry) return null;
  const { width, height, pad, plotRight, plotBottom, steps, xTicks, yTicks } = geometry;

  // 뷰포트 크기와 무관하게 동작하도록 화면 좌표를 viewBox 좌표로 되돌린다.
  function track(event: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const local = ((event.clientX - rect.left) / rect.width) * width;
    if (local < pad.left || local > plotRight) { setHover(null); return; }
    // 어느 군에도 정확히 걸치지 않아도 가장 가까운 군을 잡아준다.
    let nearest = 0;
    let best = Infinity;
    for (const step of steps) {
      const distance = local < step.x1 ? step.x1 - local : local > step.x2 ? local - step.x2 : 0;
      if (distance < best) { best = distance; nearest = step.index; }
    }
    setHover(nearest);
  }

  const active = hover !== null ? steps[hover] : null;

  return (
    <div className="spectrum-figure">
      <svg
        ref={svgRef}
        className="spectrum-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Neutron flux spectrum per unit lethargy"
        onPointerMove={track}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((tick) => (
          <line key={`gy-${tick.exp}`} x1={pad.left} y1={tick.at} x2={plotRight} y2={tick.at} className="grid" />
        ))}
        {xTicks.map((tick) => (
          <line key={`gx-${tick.exp}`} x1={tick.at} y1={pad.top} x2={tick.at} y2={plotBottom} className="grid" />
        ))}

        <path d={geometry.area} className="spectrum-area" />
        <path d={geometry.line} className="spectrum-line" />

        {active && (
          <g className="spectrum-cursor">
            <rect x={active.x1} y={pad.top} width={Math.max(1, active.x2 - active.x1)} height={plotBottom - pad.top} />
            <line x1={active.x1} y1={active.top} x2={active.x2} y2={active.top} />
          </g>
        )}

        <line x1={pad.left} y1={plotBottom} x2={plotRight} y2={plotBottom} className="axis" />
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={plotBottom} className="axis" />

        {xTicks.map((tick) => (
          <g key={`x-${tick.exp}`}>
            <line x1={tick.at} y1={plotBottom} x2={tick.at} y2={plotBottom + (tick.major ? 5 : 3)} className="axis" />
            {tick.major && <TickPower x={tick.at} y={plotBottom + 18} exp={tick.exp} anchor="middle" />}
          </g>
        ))}
        {yTicks.map((tick) => (
          <g key={`y-${tick.exp}`}>
            <line x1={pad.left - 5} y1={tick.at} x2={pad.left} y2={tick.at} className="axis" />
            <TickPower x={pad.left - 9} y={tick.at + 3} exp={tick.exp} anchor="end" />
          </g>
        ))}

        <text x={(pad.left + plotRight) / 2} y={height - 12} className="axis-title">Energy (eV)</text>
        <text
          x={16}
          y={(pad.top + plotBottom) / 2}
          className="axis-title"
          transform={`rotate(-90 16 ${(pad.top + plotBottom) / 2})`}
        >
          Flux per unit lethargy
        </text>
      </svg>

      <div className="spectrum-readout" role="status" aria-live="polite">
        {active ? (
          <>
            <strong>{formatFlux(active.bin.perLethargy)}</strong>
            <span>
              {t("그룹")} {active.index + 1} · {(active.bin.low * EV_PER_MEV).toExponential(2)} – {(active.bin.high * EV_PER_MEV).toExponential(2)} eV
            </span>
          </>
        ) : (
          <span className="spectrum-hint">{t("그래프 위에 마우스를 올리면 해당 에너지군의 값을 보여줍니다.")}</span>
        )}
      </div>

      <button className="link-button" onClick={() => setShowTable(!showTable)} aria-expanded={showTable}>
        {showTable ? t("표 닫기") : t("표로 보기")} ({t("{n}개 군").replace("{n}", String(steps.length))})
      </button>

      {showTable && (
        <div className="table-scroll spectrum-table-wrap">
          <table className="worth-table spectrum-table">
            <thead>
              <tr>
                <th>{t("군")}</th>
                <th>{t("하한 (eV)")}</th>
                <th>{t("상한 (eV)")}</th>
                <th>{t("렙서지당 중성자속")}</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => (
                <tr key={step.index} className={hover === step.index ? "is-reference" : ""}>
                  <td className="num">{step.index + 1}</td>
                  <td className="num">{(step.bin.low * EV_PER_MEV).toExponential(2)}</td>
                  <td className="num">{(step.bin.high * EV_PER_MEV).toExponential(2)}</td>
                  <td className="num">{step.bin.perLethargy.toExponential(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * 계산 정리 화면.
 *
 * 왼쪽은 브라우저가 알 수 없는 값(작성자, 실제 저장 경로 등)을 받는 짧은 폼이고,
 * 오른쪽은 실제로 내려받게 될 마크다운을 그대로 보여 준다. 미리보기와 파일이
 * 같은 문자열이라 "받아보니 다르더라" 하는 일이 없다.
 */
function SummaryPanel({
  meta,
  onChange,
  onToggleImages,
  onChangeLocale,
  markdown,
  markdownSize,
  onDownload,
  downloading,
  fileName,
  imagePlan,
  inputFile,
  resultCount,
  geometryImage,
  onRecaptureImage,
  t,
}: {
  meta: SummaryMeta;
  onChange: (field: keyof SummaryMeta, value: string) => void;
  onToggleImages: (value: boolean) => void;
  onChangeLocale: (locale: SummaryMeta["locale"]) => void;
  markdown: string;
  markdownSize: number;
  onDownload: () => void;
  downloading: boolean;
  fileName: string;
  imagePlan: SummaryImagePlan;
  inputFile: IngestedFile | undefined;
  resultCount: number;
  geometryImage: SummaryGeometryImage | undefined;
  onRecaptureImage: () => void;
  t: (ko: string) => string;
}) {
  const lines = markdown.split("\n").length;
  const companionFiles = [
    ...(imagePlan.geometry ? [imagePlan.geometry] : []),
    ...imagePlan.spectra.map((spec) => spec.fileName),
  ];

  return (
    <div className="summary-panel">
      <div className="summary-form">
        <div className="summary-intro">
          <div className="summary-intro-row">
            <h1>{t("계산 정리")}</h1>
            {/* 이 토글은 웹페이지가 아니라 내려받는 문서 자체의 언어를 고른다 — 앱 UI 언어와는
                다른 별개의 선택이라 상단의 앱 전체 토글과 서로 영향을 주지 않는다. */}
            <div className="locale-toggle" role="group" aria-label="Document language">
              <button
                type="button"
                className={meta.locale === "ko" ? "active" : ""}
                onClick={() => onChangeLocale("ko")}
              >한국어</button>
              <button
                type="button"
                className={meta.locale === "en" ? "active" : ""}
                onClick={() => onChangeLocale("en")}
              >English</button>
            </div>
          </div>
          <p>
            {t("나중에 같은 계산을 다시 돌릴 수 있도록 입력문 전문·파일 정보·결과를 하나의 마크다운으로 모읍니다.")}
          </p>
        </div>

        <label className="summary-field">
          <span>{t("제목")}</span>
          <input
            value={meta.title}
            placeholder={t("비우면 입력문 이름을 씁니다")}
            onChange={(event) => onChange("title", event.target.value)}
          />
        </label>

        <label className="summary-field">
          <span>{t("작성자")}</span>
          <input
            value={meta.analyst}
            placeholder={t("이름")}
            onChange={(event) => onChange("analyst", event.target.value)}
          />
        </label>

        <label className="summary-field wide">
          <span>{t("파일 위치")}</span>
          <textarea
            rows={2}
            value={meta.location}
            placeholder="/home/user/calc/v2c22/"
            onChange={(event) => onChange("location", event.target.value)}
          />
          <small>
            {t("브라우저는 보안상 실제 경로를 알려주지 않습니다. 재현하려면 계산을 돌린 디렉터리를 직접 적어야 합니다.")}
          </small>
        </label>

        <label className="summary-field wide">
          <span>{t("비고")}</span>
          <textarea
            rows={3}
            value={meta.notes}
            placeholder={t("이번 계산에서 바꾼 것, 확인할 것 등")}
            onChange={(event) => onChange("notes", event.target.value)}
          />
        </label>

        <div className="summary-field wide summary-images">
          <label className="summary-checkbox">
            <input
              type="checkbox"
              checked={meta.includeImages}
              onChange={(event) => onToggleImages(event.target.checked)}
            />
            <span>{t("형상·스펙트럼을 별도 PNG 파일로 함께 받기 (해상도 그대로)")}</span>
          </label>

          {meta.includeImages && (
            <div className="summary-thumb">
              {geometryImage ? (
                // 캔버스를 그 자리에서 찍은 data: URI 라 next/image 최적화 대상이 아니다.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={geometryImage.dataUrl}
                  alt={t("형상 미리보기 스냅샷")}
                  width={geometryImage.width}
                  height={geometryImage.height}
                />
              ) : (
                <div className="summary-thumb-empty">{t("형상 이미지 없음")}</div>
              )}
              <div className="summary-thumb-info">
                {geometryImage
                  ? <span>{geometryImage.basis} {t("단면")} · {geometryImage.width}×{geometryImage.height}px</span>
                  : <span>{t("탭을 열면 자동으로 찍습니다")}</span>}
                <button type="button" className="icon-button" onClick={onRecaptureImage} title={t("형상 미리보기를 다시 찍습니다")}>
                  <Icon>↻</Icon> {t("다시 캡처")}
                </button>
              </div>
              <small>
                {t("형상 미리보기를 새로고침하거나 단면·확대를 바꾼 뒤에는 여기서 다시 찍어야 최신 그림이 들어갑니다. 다운로드 버튼을 누르면 이 그림과 스펙트럼 그림이 마크다운과 함께 별도 PNG 파일로 내려받아집니다 — 같은 폴더에 두어야 마크다운 뷰어에서 그림이 보입니다.")}
              </small>
              {companionFiles.length > 0 && (
                <ul className="summary-companion-list">
                  {companionFiles.map((name) => <li key={name}><code>{name}</code></li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 주 동작이므로 폼을 스크롤하지 않아도 늘 보이게 폼 밖에 둔다. */}
      <div className="summary-actions">
        <div className="summary-status">
          <div className={inputFile ? "summary-chip ok" : "summary-chip warn"}>
            {inputFile
              ? t("입력문 파일 정보 있음{extra}").replace("{extra}", inputFile.lastModified ? t(" · 수정 시각 포함") : t(" · 수정 시각 없음"))
              : t("입력문을 파일로 열지 않아 폴더·수정 시각 없음")}
          </div>
          <div className={resultCount ? "summary-chip ok" : "summary-chip warn"}>
            {resultCount ? t("결과문 {n}건").replace("{n}", String(resultCount)) : t("결과문 없음 — 결과 절이 빕니다")}
          </div>
          <div className="summary-size">
            {lines.toLocaleString("en-US")}{t("줄")} · {markdownSize.toLocaleString("en-US")} bytes
            {companionFiles.length > 0 && ` · ${t("PNG {n}개 별도").replace("{n}", String(companionFiles.length))}`}
          </div>
        </div>
        <button className="button primary summary-download" onClick={onDownload} disabled={downloading}>
          <Icon>↓</Icon> {downloading ? t("내려받는 중…") : fileName}
        </button>
      </div>

      <div className="summary-preview">
        <div className="source-toolbar">
          <span>{t("미리보기 (내려받는 파일과 동일 — 그림은 별도 PNG 파일로 받습니다)")}</span>
          <span>Markdown</span>
        </div>
        <pre>{markdown}</pre>
      </div>
    </div>
  );
}

function ResultsPanel({
  cases,
  referenceId,
  activeId,
  onPickActive,
  onPickReference,
  onOpen,
  onRemove,
  linkedInput,
  onOpenLinkedInput,
  detectorsFor,
  t,
  uiLocale,
}: {
  cases: ResultCase[];
  referenceId: string;
  activeId: string;
  onPickActive: (id: string) => void;
  onPickReference: (id: string) => void;
  onOpen: () => void;
  onRemove: (id: string) => void;
  linkedInput: (item: ResultCase) => IngestedFile | undefined;
  onOpenLinkedInput: (file: IngestedFile) => void;
  detectorsFor: (item: ResultCase) => Detector[];
  t: (ko: string) => string;
  uiLocale: UiLocale;
}) {
  const valid = useMemo(() => cases.filter((item) => !item.error), [cases]);
  const active = valid.find((item) => item.id === activeId) ?? valid[0];
  const worth = buildWorthTable(valid, referenceId);
  const detectors = active ? detectorsFor(active) : [];
  // "gc" = res.m 의 INF_MICRO_FLX(군상수 생성 부산물), 그 외에는 det 검출기 이름.
  const [spectrumSource, setSpectrumSource] = useState("gc");

  if (!cases.length) {
    return (
      <div className="results-pane empty">
        <div className="results-empty">
          <span className="results-empty-mark">◫</span>
          <h2>{t("Serpent 결과 파일을 불러오세요")}</h2>
          <p>
            {t("계산이 끝나면 생기는")} <code>*_res.m</code> {t("파일을 열면 keff·반응도·지발중성자분율 같은 주요 결과가 자동으로 정리됩니다.")}
          </p>
          <ul className="results-empty-hint">
            <li>
              <strong>{t("여러 개를 한 번에")}</strong> {t("골라도 됩니다. 각각 탭으로 열리고, 기준 케이스 대비 반응도가(Δρ)를 표로 비교합니다.")}
            </li>
            <li>
              <strong>{t("입력문")}</strong>{t("은 상단")} <code>{t("열기")}</code> {t("로 따로 불러옵니다. 이름이 같으면 (")}<code>X</code> ↔ <code>X_res.m</code>{t(") 자동으로 연결됩니다.")}
            </li>
            <li>{t("Finder 에서 파일이나 폴더를 이 창에")} <strong>{t("끌어다 놓아도")}</strong> {t("됩니다.")}</li>
          </ul>
          <div className="results-empty-actions">
            <button className="button primary" onClick={onOpen}>
              <Icon>◫</Icon> {t("결과 파일 열기")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="results-pane">
      <div className="results-bar">
        <div className="results-tabs" role="tablist" aria-label={t("불러온 결과 파일")}>
          {cases.map((item) => (
            // 닫기 버튼을 탭 버튼 "안"에 role="button" span 으로 넣으면 유효하지 않은 HTML이고
            // (button 안의 button), 브라우저 대부분에서 Tab 키로 닫기에 도달할 수 없다.
            // 그래서 탭 선택 버튼과 닫기 버튼을 이 감싸는 요소의 형제로 둔다.
            <div
              key={item.id}
              className={`result-tab ${active?.id === item.id ? "active" : ""} ${item.error ? "broken" : item.worstStatus}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active?.id === item.id}
                className="result-tab-select"
                onClick={() => onPickActive(item.id)}
                title={item.dir ? `${item.dir}/${item.fileName}` : item.fileName}
              >
                <span className={`status-dot ${item.error ? "bad" : item.worstStatus}`} />
                <span className="result-tab-name">{item.label}</span>
                {/* 폴더가 다르면 이름이 겹칠 수 있으므로 마지막 폴더를 함께 보여준다. */}
                {item.dir && <span className="result-tab-dir">{item.dir.split("/").pop()}</span>}
              </button>
              <button
                type="button"
                className="result-tab-close"
                aria-label={t("{name} 닫기").replace("{name}", item.label)}
                title={t("닫기")}
                onClick={() => onRemove(item.id)}
              >×</button>
            </div>
          ))}
        </div>
        <button className="button ghost" onClick={onOpen}><Icon>＋</Icon> {t("추가")}</button>
      </div>

      {active?.error || !active ? (
        <p className="results-error">{tError(cases.find((item) => item.error)?.error ?? "결과를 읽을 수 없습니다.", uiLocale)}</p>
      ) : (
        <div className="results-body">
          <header className="results-head">
            <div>
              <span className="eyebrow">{active.version || "Serpent"} · {active.completeDate || t("완료 시각 미상")}</span>
              <h1>{active.inputName || active.fileName}</h1>
              <p>
                {t("{pop}개 입자 × {gen}회 활성 사이클")
                  .replace("{pop}", active.pop?.toLocaleString() ?? "?")
                  .replace("{gen}", String(active.activeCycles ?? "?"))}
                {active.cycles !== undefined && ` (${t("전체 {total}회 중 {skip}회 버림)").replace("{total}", String(active.cycles)).replace("{skip}", String(active.skip))}`}
                {active.runningTime !== undefined && ` · ${t("{min}분 소요").replace("{min}", (active.runningTime / 60).toFixed(1))}`}
              </p>
            </div>
            <div className="results-head-side">
              <span className={`health-badge ${active.worstStatus}`}>
                {active.worstStatus === "ok" ? t("검증 통과") : active.worstStatus === "warn" ? t("확인 필요") : t("결과 사용 주의")}
              </span>
              {(() => {
                const paired = linkedInput(active);
                if (!paired) return <span className="link-missing">{t("연결된 입력문 없음")}</span>;
                return (
                  <button className="linked-input" onClick={() => onOpenLinkedInput(paired)}>
                    <Icon>▤</Icon> {paired.name}
                  </button>
                );
              })()}
            </div>
          </header>

          <section className="metric-row" aria-label={t("핵심 결과")}>
            <div className="metric primary">
              <span>{t("실효증배계수")} k<sub>eff</sub></span>
              <strong>{active.keff ? formatNumber(active.keff.value, 5) : "—"}</strong>
              <small>
                ± {active.keff ? (active.keff.abs * 1e5).toFixed(1) : "—"} pcm · {active.keffEstimator}
              </small>
            </div>
            <div className="metric">
              <span>{t("반응도")} ρ</span>
              <strong>{active.rho ? active.rho.value.toFixed(1) : "—"}<em>pcm</em></strong>
              <small>± {active.rho ? active.rho.abs.toFixed(1) : "—"} pcm</small>
            </div>
            <div className="metric">
              <span>{t("반응도 (달러)")}</span>
              <strong>{active.dollars !== undefined ? active.dollars.toFixed(3) : "—"}<em>$</em></strong>
              <small>ρ / β<sub>eff</sub></small>
            </div>
            <div className="metric">
              <span>{t("지발중성자분율")} β<sub>eff</sub></span>
              <strong>{active.betaEff !== undefined ? (active.betaEff * 1e5).toFixed(0) : "—"}<em>pcm</em></strong>
              <small>{active.betaEff !== undefined ? formatNumber(active.betaEff, 6) : "—"}</small>
            </div>
            <div className="metric">
              <span>{t("중성자 세대시간")} Λ</span>
              <strong>{active.genTime !== undefined ? (active.genTime * 1e6).toFixed(2) : "—"}<em>μs</em></strong>
              <small>{active.genTimeEstimator || "—"}</small>
            </div>
          </section>

          {active.delayedGroups.length > 0 && (
            <section className="results-section">
              <h2>{t("지발중성자 {n}군 상수").replace("{n}", String(active.delayedGroups.length))}</h2>
              <p className="section-note">
                {t("β")}<sub>eff,i</sub> {t("비율은 각 군의 값을 전체")} β<sub>eff</sub>{t("로 나눈 값입니다.")}
                {" "}λ<sub>i</sub>{t("는 전구체 붕괴상수이며 단위는")} s<sup>−1</sup>{t("입니다.")}
                <span className="result-source"> {active.delayedSource}</span>
              </p>
              <div className="table-scroll">
                <table className="worth-table delayed-table">
                  <thead>
                    <tr>
                      <th>{t("전구체군")}</th>
                      <th>β<sub>eff,i</sub> (pcm)</th>
                      <th>β<sub>eff</sub> {t("비율")}</th>
                      <th>λ<sub>i</sub> (s<sup>−1</sup>)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.delayedGroups.map((row) => (
                      <tr key={row.group}>
                        <td>Group {row.group}</td>
                        <td className="num">
                          {(row.betaEff.value * 1e5).toFixed(3)}
                          <small>±{(row.betaEff.abs * 1e5).toFixed(3)}</small>
                        </td>
                        <td className="num">{(row.share * 100).toFixed(2)} %</td>
                        <td className="num">
                          {formatNumber(row.lambda.value, 6)}
                          <small>±{formatNumber(row.lambda.abs, 3)}</small>
                        </td>
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td>{t("전체 / 가중값")}</td>
                      <td className="num">{active.betaEff !== undefined ? (active.betaEff * 1e5).toFixed(3) : "—"}</td>
                      <td className="num">100.00 %</td>
                      <td className="num">
                        {active.lambdaEff ? formatNumber(active.lambdaEff.value, 6) : "—"}
                        {active.lambdaEff && <small>±{formatNumber(active.lambdaEff.abs, 3)}</small>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="result-error-note">{t("± 값은 res.m의 상대 표준편차를 절대 표준편차로 환산한 1σ입니다.")}</p>
            </section>
          )}

          <section className="results-section">
            <h2>{t("계산 건전성")}</h2>
            <p className="section-note">
              {t("값을 쓰기 전에 확인하는 항목입니다. 하나라도 실패하면 keff 자체를 신뢰할 수 없습니다.")}
            </p>
            <div className="check-grid">
              {active.checks.map((check) => {
                const translated = tCheck(check, uiLocale);
                return (
                  <div className={`check-item ${check.status}`} key={check.label}>
                    <span className={`status-dot ${check.status}`} />
                    <div>
                      <strong>{translated.label}</strong>
                      <small>{translated.detail}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {valid.length > 1 && (
            <section className="results-section">
              <h2>{t("기준 대비 반응도가 (Δρ)")}</h2>
              <p className="section-note">
                {t("제어드럼·제어봉 배치 연구의 최종 산출물입니다. 두 계산이 독립이므로 오차는 √(σ₁²+σ₂²)로 전파됩니다.")}
                {" "}{t("기준보다 반응도가 낮으면 음수(삽입 효과)입니다. Δρ($)는 케이스마다 다른")} β<sub>eff</sub>{t("가 아니라")}
                <strong> {t("기준 케이스의")} β<sub>eff</sub></strong>
                {(() => {
                  const referenceCase = worth.find((row) => row.isReference)?.case;
                  return referenceCase?.betaEff !== undefined
                    ? ` (${(referenceCase.betaEff * 1e5).toFixed(0)} pcm)`
                    : "";
                })()} {t("하나로 통일해 나눈 값입니다.")}
              </p>
              <label className="reference-picker">
                <span>{t("기준 케이스")}</span>
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
                      <th>{t("케이스")}</th>
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
                          {row.isReference && <span className="ref-tag">{t("기준")}</span>}
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
            <h2>{t("노심 물리 특성")}</h2>
            <div className="physics-grid">
              {active.physics.map((row) => (
                <div className="physics-item" key={row.label}>
                  <span>{tPhysicsLabel(row.label, uiLocale)}</span>
                  <strong>{row.value}</strong>
                  <small>{tPhysicsHint(row.hint, uiLocale)}</small>
                </div>
              ))}
            </div>
          </section>

          {(() => {
            // "gc" = res.m 안의 INF_MICRO_FLX(군상수 생성이 켜졌을 때 자동으로 딸려오는
            // 무한매질 스펙트럼). det 검출기는 사용자가 직접 정의해 별도 파일
            // (`[input]_det[idx].m`)에 저장되는 값이라 성격이 다르다 — 원하는 영역만
            // 골라 뽑을 수 있는 대신, 파일을 따로 열어야 보인다.
            const sources = [
              ...(active.spectrum.length ? [{ id: "gc", label: t("INF_MICRO_FLX (군상수)") }] : []),
              ...detectors.map((det) => ({ id: det.name, label: `det: ${det.name}` })),
            ];
            if (!sources.length) return null;
            const effective = sources.some((source) => source.id === spectrumSource)
              ? spectrumSource
              : sources[0].id;
            const bins = effective === "gc"
              ? active.spectrum
              : detectorToSpectrumBins(detectors.find((det) => det.name === effective)!);

            return (
              <section className="results-section">
                <h2>{t("중성자속 스펙트럼")}</h2>
                {sources.length > 1 ? (
                  <label className="reference-picker">
                    <span>{t("출처")}</span>
                    <select value={effective} onChange={(event) => setSpectrumSource(event.target.value)}>
                      {sources.map((source) => (
                        <option key={source.id} value={source.id}>{source.label}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <p className="section-note">
                  {effective === "gc" ? (
                    <>
                      {active.entries.get("GC_UNIVERSE_NAME")?.text
                        ? t("균질화 유니버스 '{name}'의 ").replace("{name}", active.entries.get("GC_UNIVERSE_NAME")?.text ?? "")
                        : ""}
                      {t("무한매질 스펙트럼(INF_MICRO_FLX)을 단위 렙서지당 값으로 환산한 결과입니다. 군상수 생성이 켜져 있을 때 자동으로 만들어지는 값이라, 그 유니버스가 전체 모델을 덮지 않으면 모델 전체가 아니라 그 영역만의 스펙트럼입니다.")}
                    </>
                  ) : (
                    <>
                      {t("검출기")} <code>{effective}</code>{t("의 에너지 구간별 값을 단위 렙서지당으로 환산한 결과입니다. det 파일 파싱은 VTT 공식 문서의 열 배치만 보고 작성했고 실제 Serpent 출력으로 검증하지는 못했습니다 — 정확한 값인지는 원본 det 파일과 대조해 보세요.")}
                    </>
                  )}
                </p>
                <SpectrumChart bins={bins} t={t} />
              </section>
            );
          })()}

          <p className="preview-note">
            {t("res.m 에서 값 뒤의 두 번째 숫자는 절대오차가 아니라")} <strong>{t("상대 표준편차")}</strong>{t("입니다.")}
            {" "}{t("이 화면의 ± 표기는 이미 값과 곱해 절대오차로 환산한 것입니다.")}
          </p>
        </div>
      )}
    </div>
  );
}
