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
  "cell",
  "surf",
  "mat",
  "src",
  "det",
  "set",
  "plot",
  "gplot",
  "include",
  "trans",
  "transa",
  "transv",
  "pin",
  "nest",
  "lat",
  "div",
  "dep",
  "branch",
  "coef",
  "ene",
  "fun",
  "mesh",
  "ifc",
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
    const referenced = data.region.match(/[A-Za-z_][\w.-]*|\d+/g) ?? [];
    for (const reference of referenced) {
      if (!surfaces.has(reference)) {
        issues.push({
          level: "error",
          message: `정의되지 않은 표면 '${reference}'을 참조합니다.`,
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

export type GeometryCell = {
  id: string;
  material: string;
  terms: number[];
};

export type GeometryMaterial = {
  name: string;
  color: [number, number, number];
};

export type GeometryModel = {
  surfaces: Map<string, GeometrySurface>;
  cells: GeometryCell[];
  materials: Map<string, GeometryMaterial>;
};

export type PlotBasis = "xy" | "xz" | "yz";

export type PlotBounds = {
  horizontalMin: number;
  horizontalMax: number;
  verticalMin: number;
  verticalMax: number;
};

export function parseGeometryModel(cards: SerpentCard[]): GeometryModel {
  const surfaces = new Map<string, GeometrySurface>();
  const materials = new Map<string, GeometryMaterial>();
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
      const rgb = rgbIndex >= 0
        ? parts.slice(rgbIndex + 1, rgbIndex + 4).map(Number)
        : [126, 145, 137];
      materials.set(parts[1], {
        name: parts[1],
        color: [
          Number.isFinite(rgb[0]) ? rgb[0] : 126,
          Number.isFinite(rgb[1]) ? rgb[1] : 145,
          Number.isFinite(rgb[2]) ? rgb[2] : 137,
        ],
      });
    }

    if (card.kind === "cell" && parts.length >= 5) {
      const terms = parts
        .slice(4)
        .map((part) => Number(part.replace(/[():]/g, "")))
        .filter((value) => Number.isInteger(value) && value !== 0);
      cells.push({ id: parts[1], material: parts[3], terms });
    }
  }

  return { surfaces, cells, materials };
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

function cellContains(
  cell: GeometryCell,
  surfaces: Map<string, GeometrySurface>,
  x: number,
  y: number,
  z: number,
) {
  return cell.terms.every((term) => {
    const surface = surfaces.get(String(Math.abs(term)));
    if (!surface) return false;
    const value = surfaceValue(surface, x, y, z);
    return term < 0 ? value < 0 : value > 0;
  });
}

export function materialAtPoint(model: GeometryModel, x: number, y: number, z: number) {
  for (const cell of model.cells) {
    if (cell.material === "outside") continue;
    if (cellContains(cell, model.surfaces, x, y, z)) return cell.material;
  }
  return "";
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

export const SAMPLE_INPUT = `% ================================================================
% SERPENT Studio sample — simplified PWR fuel pin
% ================================================================

set title "PWR Fuel Pin"

% --- Surfaces
surf fuel   cyl 0.0 0.0 0.4096
surf clad   cyl 0.0 0.0 0.4750
surf bound  sqc 0.0 0.0 0.6300

% --- Cells
cell fuel_cell  0 fuel     -fuel
cell gap_cell   0 helium    fuel -clad
cell clad_cell  0 zircaloy  clad -bound
cell moderator  0 water     bound
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
