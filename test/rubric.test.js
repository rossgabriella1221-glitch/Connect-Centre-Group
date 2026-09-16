import test from "node:test";
import assert from "node:assert/strict";
import { rubric, flatRubric, maxScore, calculate } from "../lib/rubric.js";

test("workbook structure is preserved", () => {
  assert.equal(rubric.length, 11);
  assert.equal(flatRubric.length, 40);
  assert.equal(maxScore, 200);
  assert.deepEqual(rubric.map(section => section.items.length), [4,5,3,5,3,2,2,4,4,5,3]);
});

test("perfect evaluation totals 200", () => {
  const results = flatRubric.map(item => ({ id: item.id, score: 5, comment: "Pass", evidence: "Evidence" }));
  const total = calculate(results);
  assert.equal(total.score, 200);
  assert.equal(total.percentage, 100);
});

test("workbook sample totals 190", () => {
  const misses = new Set(["g4", "x1"]);
  const results = flatRubric.map(item => ({ id: item.id, score: misses.has(item.id) ? 0 : 5 }));
  assert.equal(calculate(results).score, 190);
});
