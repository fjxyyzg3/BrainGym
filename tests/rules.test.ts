import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateSequence,
  score,
  validateCounts,
} from "../src/shared/rules.js";

function rng(seed = 19) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
test("all levels contain N warmup plus 30 valid trials with both classes", () => {
  for (let n = 1; n <= 5; n++) {
    const seq = generateSequence(n, rng(n));
    assert.equal(seq.length, n + 30);
    assert.ok(seq.every((x) => Number.isInteger(x) && x >= 0 && x < 9));
    const positives = seq.slice(n).filter((x, i) => x === seq[i]).length;
    assert.ok(positives > 0 && positives < 30);
  }
});
test("30% threshold: 0.299 matches; 0.301 excludes the previous N position", () => {
  for (const [value, matches] of [
    [0.299, true],
    [0.301, false],
  ] as const) {
    let calls = 0;
    const fallback = rng();
    const seq = generateSequence(1, () => (++calls === 2 ? value : fallback()));
    assert.equal(seq[1] === seq[0], matches);
  }
});
test("degenerate all-match sequence is regenerated and target totals vary", () => {
  let calls = 0;
  const fallback = rng();
  const seq = generateSequence(1, () => (++calls <= 31 ? 0 : fallback()));
  assert.ok(calls > 31);
  assert.ok(seq.slice(1).some((x, i) => x !== seq[i]));
  const totals = new Set(
    Array.from({ length: 20 }, (_, i) => {
      const s = generateSequence(2, rng(i + 1));
      return s.slice(2).filter((x, j) => x === s[j]).length;
    }),
  );
  assert.ok(totals.size > 1);
});
test("balanced score measures both classes and uses unrounded values", () => {
  assert.equal(score({ tp: 9, fn: 0, tn: 21, fp: 0 }), 100);
  assert.equal(score({ tp: 0, fn: 9, tn: 0, fp: 21 }), 0);
  assert.equal(score({ tp: 0, fn: 9, tn: 21, fp: 0 }), 50);
  assert.ok(
    Math.abs(
      score({ tp: 2, fn: 5, tn: 20, fp: 3 }) - (100 * (2 / 7 + 20 / 23)) / 2,
    ) < 1e-10,
  );
});
test("invalid levels and aggregates are rejected", () => {
  assert.throws(() => generateSequence(0));
  for (const counts of [
    { tp: -1, fn: 10, tn: 21, fp: 0 },
    { tp: 0, fn: 0, tn: 30, fp: 0 },
    { tp: 1.5, fn: 7.5, tn: 21, fp: 0 },
    { tp: 9, fn: 0, tn: 20, fp: 0 },
  ]) {
    assert.throws(() => validateCounts(counts));
  }
});
