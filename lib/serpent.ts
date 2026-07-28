export type CardKind =
  | "title"
  | "surface"
  | "cell"
  | "material"
  | "source"
  | "detector"
  | "setting"
  | "plot"
  | "include"
  | "other";

export type SerpentCard = {
  id: string;
  kind: CardKind;
  keyword: string;
  label: string;
  lines: string[];
  startLine: number;
};

export type ValidationIssue = {
  level: "error" | "warning";
  message: string;
  cardId?: string;
};

const CARD_KEYWORDS = new Set([
  "branch",
  "casematrix",
  "cell",
  "coef",
  "datamesh",
  "dep",
  "det",
  "div",
  "dtrans",
  "ene",
  "ftrans",
  "fun",
  "gplot",
  "hisv",
  "ifc",
  "include",
  "lat",
  "mat",
  "mesh",
  "mflow",
  "mix",
  "mplot",
  "nest",
  "particle",
  "pbed",
  "phb",
  "pin",
  "plot",
  "rep",
  "sample",
  "sens",
  "set",
  "solid",
  "src",
  "strans",
  "surf",
  "therm",
  "thermstoch",
  "tme",
  "trans",
  "transa",
  "transb",
  "transv",
  "umsh",
  "utrans",
  "voro",
  "wwgen",
  "wwin",
]);

function stripComment(line: string) {
  const index = line.indexOf("%");
  return (index >= 0 ? line.slice(0, index) : line).trim();
}

function tokens(line: string) {
  return stripComment(line).match(/"[^"]*"|\S+/g) ?? [];
}

function primaryLine(card: SerpentCard) {
  return card.lines.find((line) => {
    const first = tokens(line)[0]?.toLowerCase();
    return first === card.keyword;
  }) ?? card.lines.find((line) => stripComment(line)) ?? "";
}

function kindFor(keyword: string): CardKind {
  if (keyword === "surf") return "surface";
  if (keyword === "cell") return "cell";
  if (keyword === "mat") return "material";
  if (keyword === "src") return "source";
  if (keyword === "det") return "detector";
  if (keyword === "set") return "setting";
  if (keyword === "plot" || keyword === "gplot") return "plot";
  if (keyword === "include") return "include";
  return "other";
}

function labelFor(keyword: string, line: string) {
  const parts = tokens(line);
  if (keyword === "set" && parts[1] === "title") {
    return parts.slice(2).join(" ").replaceAll('"', "") || "제목";
  }
  if (keyword === "include") return parts.slice(1).join(" ") || "include";
  if (keyword === "plot" || keyword === "gplot") return `${keyword} ${parts[1] ?? ""}`.trim();
  return `${keyword} ${parts[1] ?? ""}`.trim();
}

export function parseSerpentInput(input: string): SerpentCard[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const cards: SerpentCard[] = [];
  let pending: string[] = [];
  let current: SerpentCard | null = null;

  const flushCurrent = () => {
    if (!current) return;
    cards.push(current);
    current = null;
  };

  lines.forEach((line, index) => {
    const clean = stripComment(line);
    const first = clean.split(/\s+/)[0]?.toLowerCase();
    const startsCard =
      clean.length > 0 &&
      (CARD_KEYWORDS.has(first) || (first === "set" && tokens(line)[1] === "title"));

    if (startsCard) {
      flushCurrent();
      const keyword = first;
      const isTitle = keyword === "set" && tokens(line)[1] === "title";
      current = {
        id: `${keyword}-${index}-${cards.length}`,
        kind: isTitle ? "title" : kindFor(keyword),
        keyword,
        label: labelFor(keyword, line),
        lines: [...pending, line],
        startLine: index + 1,
      };
      pending = [];
      return;
    }

    if (current) {
      current.lines.push(line);
    } else {
      pending.push(line);
    }
  });

  flushCurrent();
  if (pending.some((line) => line.trim())) {
    cards.push({
      id: `preamble-${lines.length}`,
      kind: "other",
      keyword: "text",
      label: "기타 입력",
      lines: pending,
      startLine: Math.max(1, lines.length - pending.length + 1),
    });
  }
  return cards;
}

export function serializeCards(cards: SerpentCard[]) {
  return cards
    .flatMap((card) => card.lines)
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trimEnd()
    .concat("\n");
}

export function getCardData(card: SerpentCard): Record<string, string> {
  const content = primaryLine(card);
  const parts = tokens(content);
  const comment = content.includes("%") ? content.slice(content.indexOf("%") + 1).trim() : "";

  if (card.kind === "surface") {
    return { name: parts[1] ?? "", type: parts[2] ?? "", values: parts.slice(3).join(" "), comment };
  }
  if (card.kind === "cell") {
    return {
      name: parts[1] ?? "",
      universe: parts[2] ?? "0",
      material: parts[3] ?? "",
      region: parts.slice(4).join(" "),
      comment,
    };
  }
  if (card.kind === "material") {
    const firstLineIndex = card.lines.indexOf(content);
    return {
      name: parts[1] ?? "",
      density: parts[2] ?? "",
      options: parts.slice(3).join(" "),
      composition: card.lines
        .slice(firstLineIndex + 1)
        .filter((line) => stripComment(line))
        .join("\n"),
      comment,
    };
  }
  if (card.kind === "setting" || card.kind === "title") {
    return {
      name: parts[1] ?? "",
      values: parts.slice(2).join(" ").replaceAll('"', ""),
      comment,
    };
  }
  return { name: parts[1] ?? "", values: parts.slice(2).join(" "), comment };
}

function withComment(line: string, comment?: string) {
  return comment?.trim() ? `${line}  % ${comment.trim()}` : line;
}

export function updateCard(
  card: SerpentCard,
  data: Record<string, string>,
): SerpentCard {
  let primary = "";
  let continuation: string[] = [];

  if (card.kind === "surface") {
    primary = `surf ${data.name} ${data.type} ${data.values}`.trim();
  } else if (card.kind === "cell") {
    primary = `cell ${data.name} ${data.universe} ${data.material} ${data.region}`.trim();
  } else if (card.kind === "material") {
    primary = `mat ${data.name} ${data.density}${data.options ? ` ${data.options}` : ""}`.trim();
    continuation = data.composition?.split("\n") ?? [];
  } else if (card.kind === "title") {
    primary = `set title "${data.values}"`;
  } else if (card.kind === "setting") {
    primary = `set ${data.name} ${data.values}`.trim();
  } else {
    primary = `${card.keyword} ${data.name} ${data.values}`.trim();
  }

  const originalPrimary = primaryLine(card);
  const primaryIndex = card.lines.indexOf(originalPrimary);
  const leading = primaryIndex > 0 ? card.lines.slice(0, primaryIndex) : [];
  const lines = [...leading, withComment(primary, data.comment), ...continuation];
  return { ...card, label: labelFor(card.keyword, primary), lines };
}

export function validateSerpentInput(cards: SerpentCard[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const surfaces = new Set<string>();
  const materials = new Set<string>();
  const cellNames = new Set<string>();
  let hasOutside = false;

  const universes = new Set<string>();

  for (const card of cards) {
    const data = getCardData(card);
    if (card.kind === "surface") {
      if (!data.name || !("type" in data) || !data.type) {
        issues.push({ level: "error", message: "표면 이름과 형식이 필요합니다.", cardId: card.id });
      }
      if (surfaces.has(data.name)) {
        issues.push({ level: "error", message: `중복된 표면 이름: ${data.name}`, cardId: card.id });
      }
      surfaces.add(data.name);
    }
    // pin·lat·nest 카드와 셀의 소속 유니버스는 모두 fill 대상이 될 수 있다.
    if (["pin", "lat", "nest", "particle", "pbed", "umsh", "solid", "voro"].includes(card.keyword)) {
      universes.add(data.name);
    }
    if (card.kind === "cell") universes.add(data.universe ?? "0");
    if (card.kind === "material") {
      if (materials.has(data.name)) {
        issues.push({ level: "error", message: `중복된 물질 이름: ${data.name}`, cardId: card.id });
      }
      materials.add(data.name);
    }
    if (card.kind === "cell") {
      if (cellNames.has(data.name)) {
        issues.push({ level: "error", message: `중복된 셀 이름: ${data.name}`, cardId: card.id });
      }
      cellNames.add(data.name);
      if ("material" in data && data.material === "outside") hasOutside = true;
    }
  }

  for (const card of cards.filter((item) => item.kind === "cell")) {
    const data = getCardData(card);
    if (!("material" in data) || !("region" in data)) continue;
    if (
      data.material &&
      !["outside", "void", "fill"].includes(data.material) &&
      !materials.has(data.material)
    ) {
      issues.push({
        level: "error",
        message: `정의되지 않은 물질 '${data.material}'을 사용합니다.`,
        cardId: card.id,
      });
    }
    // fill 셀은 영역식 앞에 채울 유니버스 이름이 먼저 오므로 분리해서 검사한다.
    let region = data.region;
    if (data.material === "fill") {
      const [target = "", ...rest] = region.trim().split(/\s+/);
      region = rest.join(" ");
      if (target && !universes.has(target)) {
        issues.push({
          level: "error",
          message: `정의되지 않은 유니버스 '${target}'을 채웁니다.`,
          cardId: card.id,
        });
      }
    }

    const references = collectRegionReferences(parseRegion(region));
    for (const reference of references.surfaces) {
      if (!surfaces.has(reference)) {
        issues.push({
          level: "error",
          message: `정의되지 않은 표면 '${reference}'을 참조합니다.`,
          cardId: card.id,
        });
      }
    }
    for (const reference of references.cells) {
      if (!cellNames.has(reference)) {
        issues.push({
          level: "error",
          message: `정의되지 않은 셀 '${reference}'의 여집합을 사용합니다.`,
          cardId: card.id,
        });
      }
    }
  }

  if (!cards.some((card) => card.kind === "title")) {
    issues.push({ level: "warning", message: "모델 제목(set title)을 추가하는 것이 좋습니다." });
  }
  if (!hasOutside) {
    issues.push({ level: "warning", message: "outside 셀이 없습니다." });
  }
  if (!cards.some((card) => card.kind === "plot")) {
    issues.push({ level: "warning", message: "형상 확인을 위한 gplot 카드를 추가해 보세요." });
  }
  return issues;
}

export type GeometrySurface = {
  id: string;
  type: string;
  values: number[];
};

export type RegionNode =
  | { op: "always" }
  | { op: "never" }
  | { op: "surface"; name: string; positive: boolean }
  | { op: "cell"; name: string }
  | { op: "not"; node: RegionNode }
  | { op: "and"; nodes: RegionNode[] }
  | { op: "or"; nodes: RegionNode[] };

export type GeometryCell = {
  id: string;
  universe: string;
  material: string;
  fill: string;
  region: RegionNode;
};

export type PinLayer = {
  material: string;
  radius: number;
};

export type GeometryMaterial = {
  name: string;
  color: [number, number, number];
};

export type GeometryModel = {
  surfaces: Map<string, GeometrySurface>;
  cells: GeometryCell[];
  cellsByUniverse: Map<string, GeometryCell[]>;
  pins: Map<string, PinLayer[]>;
  materials: Map<string, GeometryMaterial>;
};

/**
 * 물질에 rgb 옵션이 없을 때 사용하는 기본 색상. Serpent는 임의 색을 배정하지만
 * 미리보기에서는 물질을 구분하는 것이 목적이므로 고정된 순서로 배정한다.
 */
const DEFAULT_MATERIAL_COLORS: [number, number, number][] = [
  [206, 92, 74],
  [79, 138, 194],
  [178, 190, 197],
  [222, 176, 82],
  [95, 173, 137],
  [150, 124, 202],
  [211, 134, 172],
  [116, 189, 203],
  [166, 180, 106],
  [197, 137, 94],
  [128, 150, 210],
  [200, 116, 116],
];

export const VOID_COLOR: [number, number, number] = [23, 42, 38];

export type PlotBasis = "xy" | "xz" | "yz";

export type PlotBounds = {
  horizontalMin: number;
  horizontalMax: number;
  verticalMin: number;
  verticalMax: number;
};

function regionTokens(region: string) {
  return region.match(/[():#]|[+-]?[A-Za-z0-9_.]+/g) ?? [];
}

/**
 * 셀의 영역 표현식을 Boolean 트리로 변환한다.
 * 공백 = 교집합, `:` = 합집합, `#` = 여집합, 괄호 = 그룹.
 */
export function parseRegion(region: string): RegionNode {
  const items = regionTokens(region);
  let index = 0;

  function parseUnion(): RegionNode {
    const nodes = [parseIntersection()];
    while (items[index] === ":") {
      index += 1;
      nodes.push(parseIntersection());
    }
    return nodes.length === 1 ? nodes[0] : { op: "or", nodes };
  }

  function parseIntersection(): RegionNode {
    const nodes: RegionNode[] = [];
    while (index < items.length && items[index] !== ":" && items[index] !== ")") {
      const node = parsePrimary();
      if (node) nodes.push(node);
    }
    if (!nodes.length) return { op: "always" };
    return nodes.length === 1 ? nodes[0] : { op: "and", nodes };
  }

  function parsePrimary(): RegionNode | null {
    const item = items[index];
    if (item === undefined) return null;
    if (item === "(") {
      index += 1;
      const node = parseUnion();
      if (items[index] === ")") index += 1;
      return node;
    }
    if (item === ")") {
      index += 1;
      return null;
    }
    if (item === "#") {
      index += 1;
      const node = parsePrimary();
      if (!node) return null;
      // `#name`은 셀 여집합, `#(...)`는 영역 여집합.
      if (node.op === "surface" && node.positive) {
        return { op: "not", node: { op: "cell", name: node.name } };
      }
      return { op: "not", node };
    }
    index += 1;
    const positive = !item.startsWith("-");
    return { op: "surface", name: item.replace(/^[+-]/, ""), positive };
  }

  const parsed = parseUnion();
  return items.length ? parsed : { op: "always" };
}

/** 영역식이 참조하는 표면 이름과 셀 이름(여집합)을 모은다. */
export function collectRegionReferences(node: RegionNode) {
  const surfaces = new Set<string>();
  const cells = new Set<string>();
  const walk = (item: RegionNode) => {
    if (item.op === "surface") surfaces.add(item.name);
    else if (item.op === "cell") cells.add(item.name);
    else if (item.op === "not") walk(item.node);
    else if (item.op === "and" || item.op === "or") item.nodes.forEach(walk);
  };
  walk(node);
  return { surfaces, cells };
}

export function parseGeometryModel(cards: SerpentCard[]): GeometryModel {
  const surfaces = new Map<string, GeometrySurface>();
  const materials = new Map<string, GeometryMaterial>();
  const pins = new Map<string, PinLayer[]>();
  const cells: GeometryCell[] = [];

  for (const card of cards) {
    const parts = tokens(primaryLine(card));
    if (card.kind === "surface" && parts.length >= 3) {
      surfaces.set(parts[1], {
        id: parts[1],
        type: parts[2].toLowerCase(),
        values: parts.slice(3).map(Number),
      });
    }

    if (card.kind === "material" && parts.length >= 3) {
      const rgbIndex = parts.findIndex((part) => part.toLowerCase() === "rgb");
      const rgb = rgbIndex >= 0 ? parts.slice(rgbIndex + 1, rgbIndex + 4).map(Number) : [];
      const fallback = DEFAULT_MATERIAL_COLORS[materials.size % DEFAULT_MATERIAL_COLORS.length];
      materials.set(parts[1], {
        name: parts[1],
        color: [
          Number.isFinite(rgb[0]) ? rgb[0] : fallback[0],
          Number.isFinite(rgb[1]) ? rgb[1] : fallback[1],
          Number.isFinite(rgb[2]) ? rgb[2] : fallback[2],
        ],
      });
    }

    if (card.kind === "cell" && parts.length >= 4) {
      const isFill = parts[3]?.toLowerCase() === "fill";
      const material = isFill ? "fill" : parts[3];
      const fill = isFill ? parts[4] ?? "" : "";
      const region = parts.slice(isFill ? 5 : 4).join(" ");
      cells.push({
        id: parts[1],
        universe: parts[2] ?? "0",
        material,
        fill,
        region: parseRegion(region),
      });
    }

    if (card.keyword === "pin" && parts.length >= 2) {
      // 핀 층은 카드 첫 줄에 이어 쓰거나 다음 줄들에 나눠 쓸 수 있다.
      const entries = card.lines.flatMap((line) => tokens(line)).slice(2);
      const layers: PinLayer[] = [];
      for (let position = 0; position < entries.length; position += 2) {
        const radius = Number(entries[position + 1]);
        layers.push({
          material: entries[position],
          radius: Number.isFinite(radius) ? radius : Infinity,
        });
      }
      pins.set(parts[1], layers);
    }
  }

  const cellsByUniverse = new Map<string, GeometryCell[]>();
  for (const cell of cells) {
    const bucket = cellsByUniverse.get(cell.universe);
    if (bucket) bucket.push(cell);
    else cellsByUniverse.set(cell.universe, [cell]);
  }

  return { surfaces, cells, cellsByUniverse, pins, materials };
}

export function materialColor(
  model: GeometryModel,
  name: string,
): [number, number, number] | null {
  if (!name || name === "outside") return null;
  if (name === "void") return VOID_COLOR;
  return model.materials.get(name)?.color ?? [126, 145, 137];
}

function angleInRange(angle: number, start: number, end: number) {
  const normalized = ((angle % 360) + 360) % 360;
  const a = ((start % 360) + 360) % 360;
  const b = ((end % 360) + 360) % 360;
  return a <= b ? normalized >= a && normalized <= b : normalized >= a || normalized <= b;
}

function surfaceValue(surface: GeometrySurface, x: number, y: number, z: number) {
  const v = surface.values;
  if (surface.type === "cyl" || surface.type === "cylz") {
    return Math.hypot(x - (v[0] ?? 0), y - (v[1] ?? 0)) - (v.at(-1) ?? 0);
  }
  if (surface.type === "sqc") {
    return Math.max(Math.abs(x - (v[0] ?? 0)), Math.abs(y - (v[1] ?? 0))) - (v.at(-1) ?? 0);
  }
  if (surface.type === "sph") {
    return Math.hypot(
      x - (v[0] ?? 0),
      y - (v[1] ?? 0),
      z - (v[2] ?? 0),
    ) - (v[3] ?? 0);
  }
  if (surface.type === "px") return x - (v[0] ?? 0);
  if (surface.type === "py") return y - (v[0] ?? 0);
  if (surface.type === "pz") return z - (v[0] ?? 0);
  if (surface.type === "pad") {
    const dx = x - (v[0] ?? 0);
    const dy = y - (v[1] ?? 0);
    const radius = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const inside =
      radius >= (v[2] ?? 0) &&
      radius <= (v[3] ?? 0) &&
      angleInRange(angle, v[4] ?? 0, v[5] ?? 360);
    return inside ? -1 : 1;
  }
  return 1;
}

function evaluateRegion(
  node: RegionNode,
  model: GeometryModel,
  universe: string,
  x: number,
  y: number,
  z: number,
): boolean {
  switch (node.op) {
    case "always":
      return true;
    case "never":
      return false;
    case "and":
      return node.nodes.every((item) => evaluateRegion(item, model, universe, x, y, z));
    case "or":
      return node.nodes.some((item) => evaluateRegion(item, model, universe, x, y, z));
    case "not":
      return !evaluateRegion(node.node, model, universe, x, y, z);
    case "cell": {
      const target = (model.cellsByUniverse.get(universe) ?? []).find((item) => item.id === node.name);
      return target ? evaluateRegion(target.region, model, universe, x, y, z) : false;
    }
    case "surface": {
      const surface = model.surfaces.get(node.name);
      if (!surface) return false;
      const value = surfaceValue(surface, x, y, z);
      return node.positive ? value > 0 : value < 0;
    }
  }
}

export function cellContains(
  model: GeometryModel,
  cell: GeometryCell,
  x: number,
  y: number,
  z: number,
) {
  return evaluateRegion(cell.region, model, cell.universe, x, y, z);
}

function pinMaterialAt(layers: PinLayer[], x: number, y: number) {
  const radius = Math.hypot(x, y);
  for (const layer of layers) {
    if (radius <= layer.radius) return layer.material;
  }
  return layers.at(-1)?.material ?? "";
}

function materialInUniverse(
  model: GeometryModel,
  universe: string,
  x: number,
  y: number,
  z: number,
  depth: number,
): string {
  if (depth > 8) return "";
  const pin = model.pins.get(universe);
  if (pin) return pinMaterialAt(pin, x, y);

  for (const cell of model.cellsByUniverse.get(universe) ?? []) {
    if (cell.material === "outside") continue;
    if (!cellContains(model, cell, x, y, z)) continue;
    if (cell.fill) return materialInUniverse(model, cell.fill, x, y, z, depth + 1);
    return cell.material;
  }
  return "";
}

/** 좌표가 속한 물질 이름. 빈 문자열은 정의되지 않은 공간(또는 outside)을 뜻한다. */
function rootUniverse(model: GeometryModel) {
  return model.cellsByUniverse.has("0") ? "0" : model.cells[0]?.universe ?? "0";
}

/** 좌표가 속한 물질 이름. 빈 문자열은 정의되지 않은 공간(또는 outside)을 뜻한다. */
export function materialAtPoint(model: GeometryModel, x: number, y: number, z: number) {
  return materialInUniverse(model, rootUniverse(model), x, y, z, 0);
}

export type PointStatus =
  /** 물질이 채워진 정상 영역 */
  | "material"
  /** outside 셀 — 계산 영역 바깥이므로 정상 */
  | "outside"
  /** 어떤 셀에도 속하지 않음 — Serpent 실행 시 지오메트리 오류가 난다 */
  | "undefined"
  /** lat 등 이 미리보기가 아직 해석하지 못하는 구조 — 판정 보류 */
  | "unsupported";

export type PointInfo = {
  material: string;
  status: PointStatus;
  /** 같은 지점에서 조건을 만족한 셀 이름들. 2개 이상이면 겹침이다. */
  overlap: string[];
};

/** 겹침이 없을 때 공유하는 빈 배열. 픽셀 단위 호출에서 불필요한 할당을 막는다. */
const NO_OVERLAP: string[] = [];

function classifyInUniverse(
  model: GeometryModel,
  universe: string,
  x: number,
  y: number,
  z: number,
  depth: number,
): PointInfo {
  if (depth > 8) return { material: "", status: "unsupported", overlap: NO_OVERLAP };
  const pin = model.pins.get(universe);
  if (pin) return { material: pinMaterialAt(pin, x, y), status: "material", overlap: NO_OVERLAP };

  // Serpent는 조건을 만족하는 첫 셀을 쓰고 멈추므로 겹쳐도 오류가 나지 않는다.
  // 여기서는 나머지 셀까지 모두 확인해 그 조용한 겹침을 드러낸다. 픽셀마다 호출되는
  // 경로라 겹침이 없는 정상적인 경우에는 배열을 만들지 않는다.
  let first: GeometryCell | null = null;
  let overlap: string[] = NO_OVERLAP;
  for (const cell of model.cellsByUniverse.get(universe) ?? []) {
    if (!cellContains(model, cell, x, y, z)) continue;
    if (!first) {
      first = cell;
      continue;
    }
    if (overlap === NO_OVERLAP) overlap = [first.id];
    overlap.push(cell.id);
  }
  if (!first) return { material: "", status: "undefined", overlap: NO_OVERLAP };

  if (first.material === "outside") return { material: "", status: "outside", overlap };
  if (first.fill) {
    // 격자(lat)처럼 정의를 찾을 수 없는 유니버스는 빈틈으로 오해하지 않도록 보류한다.
    const known = model.cellsByUniverse.has(first.fill) || model.pins.has(first.fill);
    if (!known) return { material: "", status: "unsupported", overlap };
    const inner = classifyInUniverse(model, first.fill, x, y, z, depth + 1);
    return {
      material: inner.material,
      status: inner.status,
      overlap: overlap.length ? overlap : inner.overlap,
    };
  }
  return { material: first.material, status: "material", overlap };
}

/** 좌표를 물질·상태·겹침 여부로 분류한다. materialAtPoint보다 느리지만 진단에 쓸 정보를 준다. */
export function classifyPoint(model: GeometryModel, x: number, y: number, z: number): PointInfo {
  return classifyInUniverse(model, rootUniverse(model), x, y, z, 0);
}

export function hasOutsideCell(model: GeometryModel) {
  return model.cells.some((cell) => cell.material === "outside");
}

function formatPoint(x: number, y: number, z: number) {
  return `${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}`;
}

/**
 * 형상 공간에 격자점을 뿌려 셀 겹침과 빈틈을 찾는다.
 * Serpent는 겹침을 조용히 넘기고 빈틈은 실행 중에야 오류를 내므로, 실행 전에 미리 잡아 준다.
 */
export function diagnoseGeometry(
  model: GeometryModel,
  cellCardIds?: Map<string, string>,
): ValidationIssue[] {
  if (!model.cells.length) return [];

  const xyBounds = geometryPlotBounds(model, "xy");
  const xzBounds = geometryPlotBounds(model, "xz");
  const [xMin, xMax] = [xyBounds.horizontalMin, xyBounds.horizontalMax];
  const [yMin, yMax] = [xyBounds.verticalMin, xyBounds.verticalMax];
  const [zMin, zMax] = [xzBounds.verticalMin, xzBounds.verticalMax];

  const planar = model.cells.length > 40 ? 28 : 44;
  const axial = 7;
  const cellsByName = new Map(model.cells.map((cell) => [cell.id, cell]));
  const outsideDefined = hasOutsideCell(model);

  const overlapExamples = new Map<string, { names: string[]; point: string }>();
  let undefinedCount = 0;
  let undefinedExample = "";
  let sampled = 0;

  for (let iz = 0; iz < axial; iz += 1) {
    const z = zMin + ((iz + 0.5) / axial) * (zMax - zMin);
    for (let iy = 0; iy < planar; iy += 1) {
      const y = yMin + ((iy + 0.5) / planar) * (yMax - yMin);
      for (let ix = 0; ix < planar; ix += 1) {
        const x = xMin + ((ix + 0.5) / planar) * (xMax - xMin);
        const info = classifyPoint(model, x, y, z);
        sampled += 1;

        if (info.overlap.length > 1) {
          const key = [...info.overlap].sort().join(" ");
          if (!overlapExamples.has(key)) {
            overlapExamples.set(key, { names: info.overlap, point: formatPoint(x, y, z) });
          }
        }
        // outside 셀이 없으면 바깥 공간 전체가 빈틈으로 잡히므로 별도 경고에 맡긴다.
        if (info.status === "undefined" && outsideDefined) {
          undefinedCount += 1;
          if (!undefinedExample) undefinedExample = formatPoint(x, y, z);
        }
      }
    }
  }

  const issues: ValidationIssue[] = [];

  for (const { names, point } of overlapExamples.values()) {
    const materials = new Set(names.map((name) => cellsByName.get(name)?.material ?? ""));
    const sameMaterial = materials.size === 1;
    const winner = names[0];
    issues.push({
      level: sameMaterial ? "warning" : "error",
      message: sameMaterial
        ? `셀 ${names.join(", ")}이(가) 겹칩니다 (예: ${point}). 물질이 같아 결과는 같지만 영역식을 정리하는 것이 좋습니다.`
        : `셀 ${names.join(", ")}이(가) 겹칩니다 (예: ${point}). Serpent는 오류 없이 먼저 정의된 '${winner}'만 사용하므로 결과가 조용히 달라집니다.`,
      cardId: cellCardIds?.get(winner),
    });
  }

  if (undefinedCount) {
    const share = ((undefinedCount / sampled) * 100).toFixed(1);
    issues.push({
      level: "error",
      message: `어떤 셀에도 속하지 않는 빈틈이 있습니다 (예: ${undefinedExample}, 표본의 ${share}%). Serpent 실행 중 해당 위치에서 지오메트리 오류가 발생합니다.`,
    });
  }

  return issues;
}

export function geometryPlotBounds(model: GeometryModel, basis: PlotBasis): PlotBounds {
  const xValues: number[] = [];
  const yValues: number[] = [];
  const zValues: number[] = [];

  for (const surface of model.surfaces.values()) {
    const v = surface.values;
    if (["cyl", "cylz", "pad", "sqc"].includes(surface.type)) {
      const radius = surface.type === "pad" ? (v[3] ?? 0) : (v.at(-1) ?? 0);
      xValues.push((v[0] ?? 0) - radius, (v[0] ?? 0) + radius);
      yValues.push((v[1] ?? 0) - radius, (v[1] ?? 0) + radius);
    }
    if (surface.type === "sph") {
      const radius = v[3] ?? 0;
      xValues.push((v[0] ?? 0) - radius, (v[0] ?? 0) + radius);
      yValues.push((v[1] ?? 0) - radius, (v[1] ?? 0) + radius);
      zValues.push((v[2] ?? 0) - radius, (v[2] ?? 0) + radius);
    }
    if (surface.type === "px") xValues.push(v[0] ?? 0);
    if (surface.type === "py") yValues.push(v[0] ?? 0);
    if (surface.type === "pz") zValues.push(v[0] ?? 0);
  }

  for (const layers of model.pins.values()) {
    const outer = layers.map((layer) => layer.radius).filter(Number.isFinite).at(-1);
    if (outer === undefined) continue;
    xValues.push(-outer, outer);
    yValues.push(-outer, outer);
  }

  const range = (values: number[], fallback = 1) => {
    if (!values.length) return [-fallback, fallback] as const;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.05, 0.1);
    return [min - padding, max + padding] as const;
  };
  const [xMin, xMax] = range(xValues);
  const [yMin, yMax] = range(yValues);
  const [zMin, zMax] = range(zValues, Math.max(Math.abs(xMin), Math.abs(xMax)));

  if (basis === "xy") {
    return { horizontalMin: xMin, horizontalMax: xMax, verticalMin: yMin, verticalMax: yMax };
  }
  if (basis === "xz") {
    return { horizontalMin: xMin, horizontalMax: xMax, verticalMin: zMin, verticalMax: zMax };
  }
  return { horizontalMin: yMin, horizontalMax: yMax, verticalMin: zMin, verticalMax: zMax };
}

// ---------------------------------------------------------------- nuclides

/** Z(1~118)별 원소 기호와 한글 명칭. ZAID의 앞 1~3자리(Z)를 원소로 표시하는 데 사용한다. */
const ELEMENTS: Record<number, { symbol: string; nameKo: string }> = {
  1: { symbol: "H", nameKo: "수소" }, 2: { symbol: "He", nameKo: "헬륨" },
  3: { symbol: "Li", nameKo: "리튬" }, 4: { symbol: "Be", nameKo: "베릴륨" },
  5: { symbol: "B", nameKo: "붕소" }, 6: { symbol: "C", nameKo: "탄소" },
  7: { symbol: "N", nameKo: "질소" }, 8: { symbol: "O", nameKo: "산소" },
  9: { symbol: "F", nameKo: "플루오린" }, 10: { symbol: "Ne", nameKo: "네온" },
  11: { symbol: "Na", nameKo: "나트륨" }, 12: { symbol: "Mg", nameKo: "마그네슘" },
  13: { symbol: "Al", nameKo: "알루미늄" }, 14: { symbol: "Si", nameKo: "규소" },
  15: { symbol: "P", nameKo: "인" }, 16: { symbol: "S", nameKo: "황" },
  17: { symbol: "Cl", nameKo: "염소" }, 18: { symbol: "Ar", nameKo: "아르곤" },
  19: { symbol: "K", nameKo: "칼륨" }, 20: { symbol: "Ca", nameKo: "칼슘" },
  21: { symbol: "Sc", nameKo: "스칸듐" }, 22: { symbol: "Ti", nameKo: "티타늄" },
  23: { symbol: "V", nameKo: "바나듐" }, 24: { symbol: "Cr", nameKo: "크로뮴" },
  25: { symbol: "Mn", nameKo: "망가니즈" }, 26: { symbol: "Fe", nameKo: "철" },
  27: { symbol: "Co", nameKo: "코발트" }, 28: { symbol: "Ni", nameKo: "니켈" },
  29: { symbol: "Cu", nameKo: "구리" }, 30: { symbol: "Zn", nameKo: "아연" },
  31: { symbol: "Ga", nameKo: "갈륨" }, 32: { symbol: "Ge", nameKo: "저마늄" },
  33: { symbol: "As", nameKo: "비소" }, 34: { symbol: "Se", nameKo: "셀레늄" },
  35: { symbol: "Br", nameKo: "브로민" }, 36: { symbol: "Kr", nameKo: "크립톤" },
  37: { symbol: "Rb", nameKo: "루비듐" }, 38: { symbol: "Sr", nameKo: "스트론튬" },
  39: { symbol: "Y", nameKo: "이트륨" }, 40: { symbol: "Zr", nameKo: "지르코늄" },
  41: { symbol: "Nb", nameKo: "나이오븀" }, 42: { symbol: "Mo", nameKo: "몰리브데넘" },
  43: { symbol: "Tc", nameKo: "테크네튬" }, 44: { symbol: "Ru", nameKo: "루테늄" },
  45: { symbol: "Rh", nameKo: "로듐" }, 46: { symbol: "Pd", nameKo: "팔라듐" },
  47: { symbol: "Ag", nameKo: "은" }, 48: { symbol: "Cd", nameKo: "카드뮴" },
  49: { symbol: "In", nameKo: "인듐" }, 50: { symbol: "Sn", nameKo: "주석" },
  51: { symbol: "Sb", nameKo: "안티모니" }, 52: { symbol: "Te", nameKo: "텔루륨" },
  53: { symbol: "I", nameKo: "아이오딘" }, 54: { symbol: "Xe", nameKo: "제논" },
  55: { symbol: "Cs", nameKo: "세슘" }, 56: { symbol: "Ba", nameKo: "바륨" },
  57: { symbol: "La", nameKo: "란타넘" }, 58: { symbol: "Ce", nameKo: "세륨" },
  59: { symbol: "Pr", nameKo: "프라세오디뮴" }, 60: { symbol: "Nd", nameKo: "네오디뮴" },
  61: { symbol: "Pm", nameKo: "프로메튬" }, 62: { symbol: "Sm", nameKo: "사마륨" },
  63: { symbol: "Eu", nameKo: "유로퓸" }, 64: { symbol: "Gd", nameKo: "가돌리늄" },
  65: { symbol: "Tb", nameKo: "터븀" }, 66: { symbol: "Dy", nameKo: "디스프로슘" },
  67: { symbol: "Ho", nameKo: "홀뮴" }, 68: { symbol: "Er", nameKo: "어븀" },
  69: { symbol: "Tm", nameKo: "툴륨" }, 70: { symbol: "Yb", nameKo: "이터븀" },
  71: { symbol: "Lu", nameKo: "루테튬" }, 72: { symbol: "Hf", nameKo: "하프늄" },
  73: { symbol: "Ta", nameKo: "탄탈럼" }, 74: { symbol: "W", nameKo: "텅스텐" },
  75: { symbol: "Re", nameKo: "레늄" }, 76: { symbol: "Os", nameKo: "오스뮴" },
  77: { symbol: "Ir", nameKo: "이리듐" }, 78: { symbol: "Pt", nameKo: "백금" },
  79: { symbol: "Au", nameKo: "금" }, 80: { symbol: "Hg", nameKo: "수은" },
  81: { symbol: "Tl", nameKo: "탈륨" }, 82: { symbol: "Pb", nameKo: "납" },
  83: { symbol: "Bi", nameKo: "비스무트" }, 84: { symbol: "Po", nameKo: "폴로늄" },
  85: { symbol: "At", nameKo: "아스타틴" }, 86: { symbol: "Rn", nameKo: "라돈" },
  87: { symbol: "Fr", nameKo: "프랑슘" }, 88: { symbol: "Ra", nameKo: "라듐" },
  89: { symbol: "Ac", nameKo: "악티늄" }, 90: { symbol: "Th", nameKo: "토륨" },
  91: { symbol: "Pa", nameKo: "프로트악티늄" }, 92: { symbol: "U", nameKo: "우라늄" },
  93: { symbol: "Np", nameKo: "넵투늄" }, 94: { symbol: "Pu", nameKo: "플루토늄" },
  95: { symbol: "Am", nameKo: "아메리슘" }, 96: { symbol: "Cm", nameKo: "퀴륨" },
  97: { symbol: "Bk", nameKo: "버클륨" }, 98: { symbol: "Cf", nameKo: "캘리포늄" },
  99: { symbol: "Es", nameKo: "아인슈타이늄" }, 100: { symbol: "Fm", nameKo: "페르뮴" },
  101: { symbol: "Md", nameKo: "멘델레븀" }, 102: { symbol: "No", nameKo: "노벨륨" },
  103: { symbol: "Lr", nameKo: "로렌슘" }, 104: { symbol: "Rf", nameKo: "러더포듐" },
  105: { symbol: "Db", nameKo: "더브늄" }, 106: { symbol: "Sg", nameKo: "시보귬" },
  107: { symbol: "Bh", nameKo: "보륨" }, 108: { symbol: "Hs", nameKo: "하슘" },
  109: { symbol: "Mt", nameKo: "마이트너륨" }, 110: { symbol: "Ds", nameKo: "다름슈타튬" },
  111: { symbol: "Rg", nameKo: "뢴트게늄" }, 112: { symbol: "Cn", nameKo: "코페르니슘" },
  113: { symbol: "Nh", nameKo: "니호늄" }, 114: { symbol: "Fl", nameKo: "플레로븀" },
  115: { symbol: "Mc", nameKo: "모스코븀" }, 116: { symbol: "Lv", nameKo: "리버모륨" },
  117: { symbol: "Ts", nameKo: "테네신" }, 118: { symbol: "Og", nameKo: "오가네손" },
};

/** ZAID(.02c 등) 라이브러리 접미사 문자가 뜻하는 데이터 종류. */
const LIBRARY_TYPE_LABELS: Record<string, string> = {
  c: "연속에너지 중성자 단면적",
  d: "이산 반응 중성자 데이터",
  y: "핵분열 생성물 수율 데이터",
  t: "열중성자 산란 S(α,β) 데이터",
  p: "연속에너지 광자(광원자) 데이터",
  u: "광핵반응 데이터",
  e: "연속에너지 전자 수송 데이터",
  m: "다군(multigroup) 중성자 데이터",
  g: "다군(multigroup) 감마 데이터",
};

export type NuclideInfo = {
  token: string;
  /** S(α,β) 열산란 라이브러리처럼 ZA 숫자가 아니라 이름으로 식별되는 항목인지 여부. */
  isThermalName: boolean;
  /** 천연 동위원소 구성(질량수 0)인지 여부. */
  isNatural: boolean;
  z?: number;
  a?: number;
  element?: string;
  elementNameKo?: string;
  /** 질량수가 해당 원소의 실제 동위원소 범위에서 벗어나 이성체(metastable) 표기로 추정되는지. */
  massSuspect: boolean;
  libraryId: string;
  libraryType: string;
  libraryTypeLabel: string;
};

/**
 * "92235.09c" 같은 ZAID 토큰을 원소·질량수·라이브러리 정보로 분해한다.
 * 앞부분이 숫자가 아니면(lwtr.10t 등) 이름 기반 S(α,β) 라이브러리로 간주한다.
 */
export function parseNuclideId(raw: string): NuclideInfo | null {
  const token = raw.trim();
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const idPart = token.slice(0, dot);
  const suffixMatch = token.slice(dot + 1).match(/^(\d+)([a-zA-Z]+)$/);
  if (!idPart || !suffixMatch) return null;
  const [, libraryId, libraryType] = suffixMatch;
  const libraryTypeLabel = LIBRARY_TYPE_LABELS[libraryType.toLowerCase()] ?? `미확인 접미사 '${libraryType}'`;

  if (!/^\d+$/.test(idPart)) {
    return { token, isThermalName: true, isNatural: false, massSuspect: false, libraryId, libraryType, libraryTypeLabel };
  }

  const za = Number(idPart);
  const z = Math.floor(za / 1000);
  const a = za % 1000;
  const entry = ELEMENTS[z];
  const isNatural = a === 0;
  // 알려진 동위원소는 대략 A ∈ [Z, 3Z+60] 범위에 있다; 벗어나면 이성체(m) 인코딩일 가능성이 크다.
  const massSuspect = !isNatural && (a < z || a > z * 3 + 60);

  return {
    token,
    isThermalName: false,
    isNatural,
    z,
    a,
    element: entry?.symbol,
    elementNameKo: entry?.nameKo,
    massSuspect,
    libraryId,
    libraryType,
    libraryTypeLabel,
  };
}

/** parseNuclideId 결과를 한 줄짜리 한글 설명으로 요약한다. */
export function describeNuclide(info: NuclideInfo): string {
  const library = `라이브러리 ${info.libraryId}${info.libraryType} — ${info.libraryTypeLabel} (ID ${info.libraryId})`;

  if (info.isThermalName) {
    return `S(α,β) 열산란 라이브러리 '${info.token.slice(0, info.token.lastIndexOf("."))}' · ${library}`;
  }
  if (!info.element) {
    return `Z=${info.z} — 등록되지 않은 원소 번호입니다. · ${library}`;
  }
  const massLabel = info.isNatural
    ? `${info.element} 천연 동위원소 구성 (모든 동위원소 자연 존재비 반영)`
    : info.massSuspect
      ? `${info.element}, 인코딩된 질량수 ${info.a} — 실제 동위원소 범위를 벗어나 이성체·준안정 상태(m) 표기로 추정됩니다. 정확한 핵종은 라이브러리 문서를 확인하세요.`
      : `${info.element}-${info.a}`;
  const nameKo = info.elementNameKo ? `${info.elementNameKo}, Z=${info.z}` : `Z=${info.z}`;
  return `${massLabel} (${nameKo}) · ${library}`;
}

export const SAMPLE_INPUT = `% ================================================================
% SERPENT Studio sample — simplified PWR fuel pin
% ================================================================

set title "PWR Fuel Pin"

% --- Surfaces
surf fuel   cyl 0.0 0.0 0.4096
surf gap    cyl 0.0 0.0 0.4180
surf clad   cyl 0.0 0.0 0.4750
surf bound  sqc 0.0 0.0 0.6300

% --- Cells
cell fuel_cell  0 fuel     -fuel
cell gap_cell   0 helium    fuel -gap
cell clad_cell  0 zircaloy  gap  -clad
cell moderator  0 water     clad -bound
cell outside    0 outside   bound

% --- Materials
mat fuel -10.297  burn 1
92235.09c  4.90000E-02
92238.09c  9.51000E-01
8016.09c   2.00000E+00

mat helium -0.0016
2004.09c   1.0

mat zircaloy -6.55
40000.09c  1.0

mat water -0.740
1001.09c   2.0
8016.09c   1.0

% --- Calculation settings
set pop 5000 100 20
set bc 2
gplot 3 700 700
`;
