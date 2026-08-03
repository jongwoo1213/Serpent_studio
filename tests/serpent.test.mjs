import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPoint,
  diagnoseGeometry,
  geometryPlotBounds,
  getCardData,
  materialAtPoint,
  padAngleRange,
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

test("a point exactly on a splitting surface belongs to one side, not an undefined gap", () => {
  // 실제 사례: pz 26005 가 정확히 z=0 에 있고, 위/아래 두 셀이 그 표면을 기준으로
  // 나뉘어 있었다. 이전 코드는 표면 값이 정확히 0일 때 양쪽 부호 판정(>0, <0)에
  // 모두 실패해 z=0 단면 전체가 "빈틈"으로 렌더링됐다.
  const src = [
    "surf bound cyl 0 0 5",
    "surf mid pz 0",
    "mat a -1\n1001.09c 1",
    "mat b -1\n1001.09c 1",
    "cell lower 0 a -bound -mid",
    "cell upper 0 b -bound mid",
    "cell out 0 outside bound",
  ].join("\n");
  const model = parseGeometryModel(parseSerpentInput(src));

  const onPlane = classifyPoint(model, 0, 0, 0);
  assert.notEqual(onPlane.status, "undefined");
  assert.equal(onPlane.material, "b");
  assert.deepEqual(diagnoseGeometry(model), []);
});

test("square lattice type 1 maps input rows top-to-bottom and evaluates local universes", () => {
  const src = [
    "surf inf inf",
    "surf box sqc 0 0 2",
    "mat a -1 rgb 10 20 30\n1001.09c 1",
    "mat b -1 rgb 40 50 60\n1001.09c 1",
    "mat c -1 rgb 70 80 90\n1001.09c 1",
    "mat d -1 rgb 100 110 120\n1001.09c 1",
    "cell ca A a -inf",
    "cell cb B b -inf",
    "cell cc C c -inf",
    "cell cd D d -inf",
    "lat L 1 0 0 2 2 2",
    "A B",
    "C D",
    "cell root 0 fill L -box",
    "cell outer 0 outside box",
  ].join("\n");
  const model = parseGeometryModel(parseSerpentInput(src));

  assert.equal(materialAtPoint(model, -1, 1, 0), "a");
  assert.equal(materialAtPoint(model, 1, 1, 0), "b");
  assert.equal(materialAtPoint(model, -1, -1, 0), "c");
  assert.equal(materialAtPoint(model, 1, -1, 0), "d");
  assert.equal(classifyPoint(model, 1, 1, 0).status, "material");
  assert.deepEqual(diagnoseGeometry(model), []);
});

test("legacy universe trans applies the inverse translation before evaluating filled cells", () => {
  const src = [
    "surf local cyl 0 0 1",
    "surf outer cyl 5 0 2",
    "mat fuel -1\n1001.09c 1",
    "mat air -0.001\n7014.09c 1",
    "cell inner shifted fuel -local",
    "cell rest shifted air local",
    "trans shifted 5 0 0",
    "cell root 0 fill shifted -outer",
    "cell outside 0 outside outer",
  ].join("\n");
  const model = parseGeometryModel(parseSerpentInput(src));

  assert.equal(materialAtPoint(model, 5, 0, 0), "fuel");
  assert.equal(materialAtPoint(model, 6.5, 0, 0), "air");
  assert.equal(classifyPoint(model, 5, 0, 0).status, "material");
  assert.deepEqual(diagnoseGeometry(model), []);
});

test("sqc uses its third value as half-width and its optional fourth value as corner radius", () => {
  const src = [
    "surf rounded sqc 0 0 2 0.5",
    "surf outer sqc 0 0 3",
    "mat fuel -1\n1001.09c 1",
    "mat air -0.001\n7014.09c 1",
    "cell fuel-cell 0 fuel -rounded",
    "cell air-cell 0 air rounded -outer",
    "cell outside 0 outside outer",
  ].join("\n");
  const model = parseGeometryModel(parseSerpentInput(src));

  assert.equal(materialAtPoint(model, 1.8, 1.8, 0), "fuel");
  assert.equal(materialAtPoint(model, 1.9, 1.9, 0), "air");
  assert.equal(materialAtPoint(model, 2.5, 0, 0), "air");
  assert.deepEqual(diagnoseGeometry(model), []);
});

test("finite cylz uses the third value as radius and the last two values as z limits", () => {
  const src = [
    "surf drum cylz 19.049 108.033 18 -108.49 108.49",
    "surf outer cylz 19.049 108.033 30 -120 120",
    "mat steel -8\n26000.09c 1",
    "mat air -0.001\n7014.09c 1",
    "cell steel-cell 0 steel -drum",
    "cell air-cell 0 air drum -outer",
    "cell outside 0 outside outer",
  ].join("\n");
  const model = parseGeometryModel(parseSerpentInput(src));

  assert.equal(materialAtPoint(model, 19.049 + 17.9, 108.033, 0), "steel");
  assert.equal(materialAtPoint(model, 19.049 + 18.1, 108.033, 0), "air");
  assert.equal(materialAtPoint(model, 19.049, 108.033, 109), "air");

  const xyBounds = geometryPlotBounds(model, "xy");
  assert.ok(xyBounds.horizontalMax < 55, `unexpected XY maximum: ${xyBounds.horizontalMax}`);
  const xzBounds = geometryPlotBounds(model, "xz");
  assert.ok(xzBounds.verticalMin < -108 && xzBounds.verticalMax > 108);
});

test("pad angles follow Serpent convention and place the sector toward the core exterior", () => {
  const rightPad = [109.7, 0, 15, 18, 225, 135];
  const upperPad = [19.049, 108.033, 15, 18, 145, 55];

  assert.deepEqual(padAngleRange(rightPad), { start: 315, end: 405, sweep: 90 });
  assert.deepEqual(padAngleRange(upperPad), { start: 35, end: 125, sweep: 90 });

  const src = [
    "surf padright pad 109.7 0 15 18 225 135",
    "surf drumright cylz 109.7 0 18",
    "mat absorber -2.52\n5010.09c 1",
    "mat moderator -3.5\n12000.09c 1",
    "cell absorbercell 0 absorber -padright",
    "cell moderatorcell 0 moderator -drumright padright",
    "cell outsidecell 0 outside drumright",
  ].join("\n");
  const model = parseGeometryModel(parseSerpentInput(src));

  assert.equal(materialAtPoint(model, 109.7 + 16.5, 0, 0), "absorber");
  assert.equal(materialAtPoint(model, 109.7 - 16.5, 0, 0), "moderator");
});

test("a 5-parameter cylz is a truncated cylinder: radius is the third value, not the last", () => {
  // 회귀 방지: 예전에는 마지막 값(축방향 상한)을 반지름으로 읽어서, 반지름 2인
  // 원통이 반지름 50인 것처럼 부풀어 주변 셀과 전부 겹쳐 보였다.
  const src = [
    "surf pin  cylz 0 0 2 -50 50",
    "surf tank cylz 0 0 10",
    "surf top  pz 60",
    "surf bot  pz -60",
    "mat fuel -1\n1001.09c 1",
    "mat water -1\n1001.09c 1",
    "cell pin-cell 0 fuel -pin",
    "cell water-cell 0 water pin -tank bot -top",
    "cell outside-cell 0 outside tank : -bot : top",
  ].join("\n");
  const model = parseGeometryModel(parseSerpentInput(src));

  // 반지름 2 안쪽(원통 축방향 범위 내)은 연료.
  assert.equal(materialAtPoint(model, 0, 0, 0), "fuel");
  assert.equal(materialAtPoint(model, 1.9, 0, 0), "fuel");
  // 반지름 2 밖은 물 — 예전 버그에서는 여기까지 연료로 잡혔다.
  assert.equal(materialAtPoint(model, 5, 0, 0), "water");
  // 축방향으로 잘렸으므로 z=55 에서는 원통 중심축이라도 연료가 아니다.
  assert.equal(materialAtPoint(model, 0, 0, 55), "water");
  assert.deepEqual(diagnoseGeometry(model), []);
});

test("cylx and cyly place their radius third and truncate along their own axis", () => {
  // cylx: y0 z0 r [x0 x1] / cyly: x0 z0 r [y0 y1]
  const src = [
    "surf bx cylx 0 0 2 -5 5",
    "surf by cyly 0 0 2 -5 5",
    "surf box sph 0 0 0 20",
    "mat a -1\n1001.09c 1",
    "mat b -1\n1001.09c 1",
    "mat air -0.001\n7014.09c 1",
    "cell ca 0 a -bx",
    "cell cb 0 b bx -by",
    "cell cair 0 air bx by -box",
    "cell cout 0 outside box",
  ].join("\n");
  const model = parseGeometryModel(parseSerpentInput(src));

  // x축 원통: (x=0, y=0, z=0) 은 안쪽, x=8 은 축방향 절단 밖.
  assert.equal(materialAtPoint(model, 0, 0, 0), "a");
  assert.equal(materialAtPoint(model, 8, 0, 0), "air");
  // y축 원통: x축 원통 밖이면서 y축 원통 안쪽인 지점.
  assert.equal(materialAtPoint(model, 0, 4, 0), "b");
  // 두 원통 모두 반지름이 2이므로, 반경 방향으로 3 떨어지면 둘 다 밖이다.
  assert.equal(materialAtPoint(model, 0, 3, 3), "air");
});
