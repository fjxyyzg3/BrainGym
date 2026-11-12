import { test } from "node:test";
import assert from "node:assert/strict";
import { NBackGame } from "../src/client/game.js";
// Alternating match/non-match is known independently of the generator.
const sequence = [
  0,
  ...Array.from({ length: 30 }, (_, i) => Math.floor((i + 1) / 2) % 9),
];
test("warmup ignores input; full window includes blank; duplicate input ignored", () => {
  const game = new NBackGame(1, sequence, 100);
  assert.equal(game.answer(500), false);
  assert.equal(game.tick(2600).lit, true);
  assert.equal(game.tick(3200).lit, false);
  assert.equal(game.answer(3200), true);
  assert.equal(game.answer(3300), false);
  assert.equal(game.tick(5100).answered, false);
});
test("a delayed tick advances by monotonic time and completes exactly 30 decisions", () => {
  const game = new NBackGame(1, sequence, 0);
  assert.equal(game.tick(10000).trial, 4);
  assert.equal(game.tick(31 * 2500).phase, "finished");
  assert.deepEqual(game.result, { tp: 0, fn: 15, fp: 0, tn: 15 });
  assert.equal(game.answer(31 * 2500), false);
});
test("correct responses give all hits and correct rejections", () => {
  const game = new NBackGame(1, sequence, 0);
  for (let i = 1; i < sequence.length; i++)
    if (sequence[i] === sequence[i - 1]) game.answer(i * 2500 + 600);
  game.tick(31 * 2500);
  assert.deepEqual(game.result, { tp: 15, fn: 0, fp: 0, tn: 15 });
});
test("abort never becomes a savable result; completed result survives later abort", () => {
  const game = new NBackGame(1, sequence, 0);
  game.abort();
  assert.equal(game.tick(100000).phase, "aborted");
  assert.equal(game.answer(4000), false);
  assert.equal(game.result, null);
  const finished = new NBackGame(1, sequence, 0);
  finished.tick(100000);
  finished.abort();
  assert.equal(finished.tick(100001).phase, "finished");
});
