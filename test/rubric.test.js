import test from "node:test";
import assert from "node:assert/strict";
import { rubric, flatRubric, fullMaxScore, calculate } from "../lib/rubric.js";

test("PDF evaluation structure is preserved", () => {
  assert.equal(rubric.length, 8); assert.equal(flatRubric.length, 30); assert.equal(fullMaxScore, 150);
  assert.deepEqual(rubric.map(section => section.items.length), [6,4,3,7,2,3,3,2]);
});
test("perfect fully applicable evaluation totals 150", () => {
  const total = calculate(flatRubric.map(item => ({ id: item.id, score: 5 })));
  assert.equal(total.score, 150); assert.equal(total.max, 150); assert.equal(total.percentage, 100);
});
test("PDF sample reproduces 123 out of 135 and 91.11 percent", () => {
  const misses = new Set(["r3", "p2"]); const notApplicable = new Set(["e3", "p6", "p7"]);
  const total = calculate(flatRubric.map(item => ({ id: item.id, score: notApplicable.has(item.id) ? "na" : misses.has(item.id) ? 0 : item.id === "t2" ? 3 : 5 })));
  assert.equal(total.score, 123); assert.equal(total.max, 135); assert.equal(total.percentage, 91.11);
});
