import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPoint,
  diagnoseGeometry,
  getCardData,
  materialAtPoint,
  parseGeometryModel,
  parseSerpentInput,
  SAMPLE_INPUT,
  serializeCards,
  updateCard,
  validateSerpentInput,
} from "../lib/serpent.ts";

function firstErrors(issues) {
  return issues.filter((issue) => issue.level === "error").map((issue) => issue.message);
}

test("parseSerpentInput splits SAMPLE_INPUT into the expected cards", () => {
  const cards = parseSerpentInput(SAMPLE_INPUT);
  const kinds = cards.map((card) => card.kind);
  assert.ok(kinds.includes("title"));
  assert.equal(kinds.filter((kind) => kind === "surface").length, 4);
  assert.equal(kinds.filter((kind) => kind === "cell").length, 5);
  assert.equal(kinds.filter((kind) => kind === "material").length, 4);
});

test("SAMPLE_INPUT has no validation errors (only the optional-card warnings)", () => {
  const issues = validateSerpentInput(parseSerpentInput(SAMPLE_INPUT));
  assert.deepEqual(firstErrors(issues), []);
});

test("updateCard keeps trailing comments and blank lines after a surface card", () => {
  const src = "surf a cyl 0 0 1\n% IMPORTANT: surface B\n\nsurf b cyl 0 0 2\n";
  const cards = parseSerpentInput(src);
  const a = cards.find((card) => getCardData(card).name === "a");
  const edited = updateCard(a, { ...getCardData(a), values: "0 0 1.5" });
  const next = cards.map((card) => (card.id === a.id ? edited : card));
  const out = serializeCards(next);
  assert.match(out, /% IMPORTANT: surface B/);
  assert.match(out, /surf a cyl 0 0 1\.5/);
  assert.match(out, /surf b cyl 0 0 2/);
});

test("updateCard keeps trailing comments after a material's composition block", () => {
  const src = [
    "mat fuel -10.0",
    "  92235.09c  0.05",
    "  92238.09c  0.95",
    "% end of fuel composition",
    "",
    "surf s cyl 0 0 1",
    "",
  ].join("\n");
  const cards = parseSerpentInput(src);
  const mat = cards.find((card) => getCardData(card).name === "fuel");
  const data = getCardData(mat);
  const edited = updateCard(mat, { ...data, density: "-10.5" });
  const next = cards.map((card) => (card.id === mat.id ? edited : card));
  const out = serializeCards(next);
  assert.match(out, /mat fuel -10\.5/);
  assert.match(out, /% end of fuel composition/);
  assert.match(out, /92235\.09c  0\.05/);
});

test("updateCard does not choke on block comments (/* ... */) inside a composition list", () => {
  // stripComment only understands `%`; a C-style block comment inside the nuclide
  // list ends up as part of getCardData's `composition` string. Editing the card
  // must not crash and must not silently invent a nuclide line from the comment.
  const src = [
    "mat b4c -2.52",
    "  5010.01c  -0.15",
    "/************************",
    " * Geometry definitions *",
    " ************************/",
    "",
    "surf s cyl 0 0 1",
    "",
  ].join("\n");
  const cards = parseSerpentInput(src);
  const mat = cards.find((card) => getCardData(card).name === "b4c");
  const data = getCardData(mat);
  const edited = updateCard(mat, { ...data, density: "-2.60" });
  const next = cards.map((card) => (card.id === mat.id ? edited : card));
  const out = serializeCards(next);
  assert.match(out, /mat b4c -2\.60/);
  assert.match(out, /Geometry definitions/);
});

test("validateSerpentInput flags a non-numeric surface value", () => {
  const src = "surf s cyl banana\ncell c 0 fuel -s\ncell o 0 outside s\nmat fuel -1\n1001.09c 1.0\n";
  const errors = firstErrors(validateSerpentInput(parseSerpentInput(src)));
  assert.ok(errors.some((message) => message.includes("숫자가 아닌 값")), errors.join(" | "));
});

test("validateSerpentInput flags a cell with no region expression", () => {
  const src = "surf s cyl 0 0 1\ncell c 0 fuel\ncell o 0 outside s\nmat fuel -1\n1001.09c 1.0\n";
  const errors = firstErrors(validateSerpentInput(parseSerpentInput(src)));
  assert.ok(errors.some((message) => message.includes("영역식이 없습니다")), errors.join(" | "));
});

test("validateSerpentInput flags a non-numeric material density", () => {
  const src = "mat fuel banana\n92235.09c 1.0\nsurf s cyl 0 0 1\ncell c 0 fuel -s\ncell o 0 outside s\n";
  const errors = firstErrors(validateSerpentInput(parseSerpentInput(src)));
  assert.ok(errors.some((message) => message.includes("밀도가 숫자가 아닙니다")), errors.join(" | "));
});

test("validateSerpentInput flags a non-numeric nuclide fraction", () => {
  const src = "mat fuel -10\n92235.09c banana\nsurf s cyl 0 0 1\ncell c 0 fuel -s\ncell o 0 outside s\n";
  const errors = firstErrors(validateSerpentInput(parseSerpentInput(src)));
  assert.ok(errors.some((message) => message.includes("분율이 숫자가 아닙니다")), errors.join(" | "));
});

test("validateSerpentInput flags unbalanced parentheses in a region expression", () => {
  const src = [
    "surf s cyl 0 0 1",
    "surf t cyl 0 0 2",
    "mat fuel -1\n1001.09c 1.0",
    "cell c 0 fuel (-s -t",
    "cell o 0 outside t",
  ].join("\n");
  const errors = firstErrors(validateSerpentInput(parseSerpentInput(src)));
  assert.ok(errors.some((message) => message.includes("괄호가 맞지 않습니다")), errors.join(" | "));
});

test("classifyPoint / materialAtPoint agree on SAMPLE_INPUT and the model has no gaps or overlaps", () => {
  const model = parseGeometryModel(parseSerpentInput(SAMPLE_INPUT));

  // 연료 반지름(0.4096) 안쪽은 fuel, 감속재 영역(clad~bound)은 water 여야 한다.
  assert.equal(materialAtPoint(model, 0, 0, 0), "fuel");
  assert.equal(materialAtPoint(model, 0.5, 0, 0), "water");

  const inside = classifyPoint(model, 0.1, 0, 0);
  assert.equal(inside.material, "fuel");
  assert.equal(inside.status, "material");
  assert.equal(inside.overlap.length, 0);

  assert.deepEqual(diagnoseGeometry(model), []);
});
