import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateStroopTrials,
  validateStroopSummary,
  stroopMetrics,
} from "../src/shared/stroop.js";
import { StroopGame } from "../src/client/stroop-game.js";

test("Stroop decks preserve exact quotas and valid equal-probability color choices", () => {
  let seed = 19;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (const warmup of [false, true]) {
    const deck = generateStroopTrials(warmup, random);
    assert.equal(deck.length, warmup ? 8 : 40);
    assert.equal(deck.filter((x) => x.ink === x.word).length, warmup ? 2 : 10);
    assert.ok(
      deck.every(
        (x) => [0, 1, 2, 3].includes(x.ink) && [0, 1, 2, 3].includes(x.word),
      ),
    );
    assert.deepEqual([...new Set(deck.map((x) => x.ink))].sort(), [0, 1, 2, 3]);
  }
  assert.equal(generateStroopTrials(false, () => 0).length, 40);
  assert.throws(() => generateStroopTrials(false, () => 1));
});

test("Stroop metrics weight correct trials, preserve negative differences and absent reaction data", () => {
  const s = {
    congruent: { correct: 5, wrong: 5, timeout: 0, correctRtTotalMs: 5000 },
    incongruent: { correct: 15, wrong: 0, timeout: 15, correctRtTotalMs: 7500 },
  };
  validateStroopSummary(s);
  assert.deepEqual(stroopMetrics(s), {
    score: 50,
    meanCorrectRtMs: 625,
    interferenceMs: -500,
  });
  const zero = { correct: 0, wrong: 0, timeout: 10, correctRtTotalMs: 0 };
  assert.deepEqual(
    stroopMetrics({ congruent: zero, incongruent: { ...zero, timeout: 30 } }),
    { score: 0, meanCorrectRtMs: null, interferenceMs: null },
  );
  assert.throws(() =>
    validateStroopSummary({
      ...s,
      congruent: { ...zero, correctRtTotalMs: 1 },
    }),
  );
  assert.throws(() =>
    validateStroopSummary({
      ...s,
      congruent: { ...s.congruent, correctRtTotalMs: NaN },
    }),
  );
});

test("Stroop starts at commit, ignores duplicate receipts and admits only the first answer", () => {
  const game = new StroopGame(generateStroopTrials(true, () => 0));
  const s = game.tick(10000);
  assert.equal(game.answer(s.trial!.ink, 10000, s.presentationId), false);
  game.commit(s.presentationId, 11000);
  game.commit(s.presentationId, 12000);
  assert.equal(game.answer(s.trial!.ink, 13999, s.presentationId), true);
  assert.equal(game.answer(s.trial!.ink, 13999, s.presentationId), false);
  const feedback = game.tick(99999);
  assert.equal(feedback.phase, "feedback");
  assert.equal(feedback.feedback?.kind, "correct");
  game.commit(s.presentationId, 99999);
  assert.equal(game.tick(100000).phase, "feedback");
  game.commit(feedback.presentationId, 100000);
  assert.equal(game.tick(100299).phase, "feedback");
  const next = game.tick(100300);
  assert.equal(next.trialIndex, 1);
  assert.equal(game.answer(next.trial!.ink, 100300, s.presentationId), false);
  assert.equal(
    game.answer(next.trial!.ink, 100300, next.presentationId),
    false,
  );
});

test("Stroop deadline equality is timeout; long delays cannot consume unseen trials", () => {
  const game = new StroopGame(generateStroopTrials(true, () => 0));
  const s = game.tick(0);
  game.commit(s.presentationId, 100);
  assert.equal(game.answer(s.trial!.ink, 3100, s.presentationId), false);
  assert.equal(game.tick(500000).feedback?.kind, "timeout");
  assert.equal(game.tick(500000).trialIndex, 0);
  assert.equal(game.result, null);
});

test("Stroop complete summaries survive abort during final feedback, earlier games do not", () => {
  const deck = generateStroopTrials(true, () => 0);
  const game = new StroopGame(deck);
  let now = 0;
  for (let i = 0; i < deck.length; i++) {
    const s = game.tick(now);
    game.commit(s.presentationId, now);
    game.answer(deck[i].ink, now + 100.4, s.presentationId);
    const f = game.tick(now + 100.4);
    game.commit(f.presentationId, now + 110);
    if (i < deck.length - 1) {
      now += 410;
      game.tick(now);
    }
  }
  assert.equal(game.completedAtMono, now + 100.4);
  assert.equal(game.result!.congruent.correct, 2);
  assert.equal(game.result!.incongruent.correct, 6);
  assert.equal(
    game.result!.congruent.correctRtTotalMs +
      game.result!.incongruent.correctRtTotalMs,
    800,
  );
  game.abort();
  assert.ok(game.result);
  assert.equal(game.tick(now + 1000).phase, "finished");
  const partial = new StroopGame(deck);
  partial.abort();
  assert.equal(partial.tick(0).phase, "aborted");
  assert.equal(partial.result, null);
});
