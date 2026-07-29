import assert from "node:assert/strict";
import test from "node:test";
import { classifyFile, ingest, pairKey } from "../lib/pairing.ts";

const RESULT_TEXT = "IMP_KEFF (idx, [1: 2]) = [ 1.05000E+00 5.0E-05 ];\n";
const INPUT_TEXT = "set title \"case\"\nsurf s cyl 0 0 1\ncell c 0 fuel -s\n";

test("classifyFile recognizes a result file by content, not just the _res.m suffix", () => {
  assert.equal(classifyFile("anything", RESULT_TEXT), "result");
  assert.equal(classifyFile("case_res.m", RESULT_TEXT), "result");
});

test("classifyFile recognizes an extensionless Serpent input by its cards", () => {
  assert.equal(classifyFile("case", INPUT_TEXT), "input");
});

test("classifyFile ignores Serpent sidecar output (.out, .seed, _dep.m)", () => {
  assert.equal(classifyFile("case.out", "anything"), "ignored");
  assert.equal(classifyFile("case.seed", "12345"), "ignored");
  assert.equal(classifyFile("case_dep.m", "some text with no card keywords"), "ignored");
});

test("ingest pairs a result and input file that share a name and directory", () => {
  const batch = ingest([
    { name: "case_res.m", dir: "campaign/P1", text: RESULT_TEXT },
    { name: "case", dir: "campaign/P1", text: INPUT_TEXT },
  ]);
  assert.equal(batch.results.length, 1);
  assert.equal(batch.inputs.length, 1);
  const key = pairKey(batch.results[0], "result");
  assert.equal(batch.inputByKey.get(key)?.name, "case");
});

test("ingest keeps same-named files in different directories separate", () => {
  const batch = ingest([
    { name: "case_res.m", dir: "campaign/P1", text: RESULT_TEXT },
    { name: "case", dir: "campaign/P2", text: INPUT_TEXT },
  ]);
  const key = pairKey(batch.results[0], "result");
  // 입력문은 P2 에 있고 결과문은 P1 에 있으므로 이름이 같아도 짝지어지면 안 된다.
  assert.equal(batch.inputByKey.has(key), false);
});
