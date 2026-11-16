import { test } from "node:test";
import assert from "node:assert/strict";
import { ROTATION_SHAPES } from "../src/shared/rotation-shapes.js";
import {
  isRotationShape,
  shapeKey,
  shapeOutline,
  rotationPair,
  outlinePath,
  type Shape,
  type Point,
} from "../src/shared/rotation-geometry.js";
import {
  generateRotationTrials,
  emptyRotationSummary,
  rotationGroupKey,
  validateRotationSummary,
  rotationMetrics,
  rotationGroupMetrics,
  canonicalRotationGroups,
} from "../src/shared/mental-rotation.js";
import { MentalRotationGame } from "../src/client/mental-rotation-game.js";

function randomSource(seed = 123) {
  let state = seed;
  return () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
const area = (p: readonly Point[]) =>
  p.reduce((s, [x, y], i) => {
    const [a, b] = p[(i + 1) % p.length];
    return s + x * b - y * a;
  }, 0) / 2;
function independentlyCheck(shape: Shape, size: number) {
  assert.equal(new Set(shape.map((p) => p.join(","))).size, size);
  const cells = new Set(shape.map((p) => p.join(","))),
    reached = new Set<string>(),
    queue = [shape[0]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i],
      key = `${x},${y}`;
    if (reached.has(key)) continue;
    reached.add(key);
    for (const p of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const)
      if (cells.has(p.join(",")) && !reached.has(p.join(","))) queue.push(p);
  }
  assert.equal(reached.size, size);
  const normalized = (s: Shape) => {
    const x = Math.min(...s.map((p) => p[0])),
      y = Math.min(...s.map((p) => p[1]));
    return s
      .map(([a, b]) => `${a - x},${b - y}`)
      .sort()
      .join(";");
  };
  const original = normalized(shape);
  let rotated = shape;
  for (let i = 0; i < 4; i++) {
    assert.notEqual(normalized(rotated.map(([x, y]) => [-x, y])), original);
    rotated = rotated.map(([x, y]) => [-y, x]);
    if (i < 3) assert.notEqual(normalized(rotated), original);
  }
  // Every empty cell inside the bounding box must reach its exterior by edge adjacency.
  const maxX = Math.max(...shape.map((p) => p[0])) + 1,
    maxY = Math.max(...shape.map((p) => p[1])) + 1;
  const outside = new Set<string>(),
    empty: [number, number][] = [[-1, -1]];
  for (let i = 0; i < empty.length; i++) {
    const [x, y] = empty[i],
      key = `${x},${y}`;
    if (
      outside.has(key) ||
      cells.has(key) ||
      x < -1 ||
      y < -1 ||
      x > maxX ||
      y > maxY
    )
      continue;
    outside.add(key);
    empty.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
  assert.equal(outside.size + cells.size, (maxX + 2) * (maxY + 2));
}
test("rotation generator balances classifications, deduplicates D4 silhouettes and bounds fallback", () => {
  for (const complexity of ["simple", "complex"] as const) {
    const shapes = ROTATION_SHAPES[complexity];
    assert.ok(shapes.length >= 16);
    assert.equal(new Set(shapes.map(shapeKey)).size, shapes.length);
    for (const shape of shapes) {
      independentlyCheck(shape, complexity === "simple" ? 6 : 10);
      assert.ok(isRotationShape(shape, shape.length));
    }
  }
  for (const random of [
    randomSource(),
    randomSource(2),
    randomSource(7),
    () => 0,
    () => 0.999999,
  ]) {
    for (const warmup of [false, true]) {
      const trials = generateRotationTrials(warmup, random);
      assert.equal(trials.length, warmup ? 8 : 32);
      assert.equal(
        new Set(trials.map((t) => shapeKey(t.shape))).size,
        trials.length,
      );
      const summary = emptyRotationSummary();
      for (const t of trials) {
        independentlyCheck(t.shape, t.complexity === "simple" ? 6 : 10);
        summary.groups.find((g) => rotationGroupKey(g) === rotationGroupKey(t))!
          .correct++;
        assert.equal(Math.abs(t.rotation), t.angle);
        assert.ok(
          Number.isInteger(t.baseTurns) && t.baseTurns >= 0 && t.baseTurns < 4,
        );
      }
      validateRotationSummary(summary, warmup);
      if (!warmup) assert.ok(summary.groups.every((g) => g.correct === 2));
    }
  }
  assert.deepEqual(
    generateRotationTrials(false, randomSource(1)),
    generateRotationTrials(false, randomSource(1)),
  );
  for (const value of [NaN, Infinity, -0.1, 1])
    assert.throws(
      () => generateRotationTrials(false, () => value),
      /随机源无效/,
    );
});
test("rotation geometry preserves area, chirality, shared scale and every signed angle", () => {
  for (const shape of [ROTATION_SHAPES.simple[0], ROTATION_SHAPES.complex[0]]) {
    for (const baseTurns of [0, 1, 2, 3])
      for (const angle of [45, 90, 135, 180])
        for (const sign of [-1, 1])
          for (const relation of ["rotation", "mirror"] as const) {
            const pair = rotationPair({
              shape,
              baseTurns,
              rotation: angle * sign,
              relation,
            });
            assert.ok(Math.abs(area(pair.reference) - shape.length) < 1e-8);
            assert.ok(
              Math.abs(
                area(pair.comparison) -
                  (relation === "mirror" ? -shape.length : shape.length),
              ) < 1e-8,
            );
            const [x, y, w, h] = pair.viewBox.split(" ").map(Number);
            assert.equal(w, h);
            for (const p of [...pair.reference, ...pair.comparison])
              assert.ok(p[0] > x && p[0] < x + w && p[1] > y && p[1] < y + h);
            assert.ok(outlinePath(pair.comparison).endsWith(" Z"));
          }
  }
  const ring: Shape = [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  assert.throws(() => shapeOutline(ring), /孔洞/);
  assert.equal(
    isRotationShape(
      [
        [0, 0],
        [1, 0],
        [2, 0],
        [0, 1],
        [1, 1],
        [2, 1],
      ],
      6,
    ),
    false,
  );
  assert.equal(
    isRotationShape([...ROTATION_SHAPES.simple[0].slice(0, 5), [100, 100]], 6),
    false,
  );
});
test("rotation summaries derive weighted metrics and reject inconsistent or overflowing groups", () => {
  const summary = emptyRotationSummary();
  for (const g of summary.groups) {
    g.correct = 2;
    g.correctRtTotalMs = 2000;
  }
  validateRotationSummary(summary);
  assert.deepEqual(rotationMetrics(summary), {
    score: 100,
    meanCorrectRtMs: 1000,
  });
  summary.groups[0] = {
    ...summary.groups[0],
    correct: 0,
    wrong: 2,
    correctRtTotalMs: 0,
  };
  summary.groups[1].correctRtTotalMs = 4000;
  assert.deepEqual(rotationMetrics(summary), {
    score: 93.75,
    meanCorrectRtMs: 32000 / 30,
  });
  assert.equal(
    rotationGroupMetrics(summary.groups.filter((g) => g.angle === 45)).correct,
    6,
  );
  const reversed = { groups: [...summary.groups].reverse() };
  assert.deepEqual(
    canonicalRotationGroups(reversed),
    canonicalRotationGroups(summary),
  );
  const long = structuredClone(summary);
  long.groups[1].correctRtTotalMs = 7200000;
  validateRotationSummary(long);
  for (const mutate of [
    (s: typeof summary) => s.groups.pop(),
    (s: typeof summary) => (s.groups[1] = s.groups[0]),
    (s: typeof summary) => (s.groups[0].correctRtTotalMs = 1),
    (s: typeof summary) => (s.groups[1].correctRtTotalMs = -1),
    (s: typeof summary) => (s.groups[1].correctRtTotalMs = 1.5),
    (s: typeof summary) => (s.groups[1].correctRtTotalMs = Infinity),
    (s: typeof summary) => (s.groups[1].correct = 3),
    (s: typeof summary) => {
      s.groups[1].correctRtTotalMs = Number.MAX_SAFE_INTEGER;
      s.groups[2].correctRtTotalMs = 1;
    },
  ]) {
    const bad = structuredClone(summary);
    mutate(bad);
    assert.throws(() => validateRotationSummary(bad));
  }
  for (const g of summary.groups) {
    g.correct = 0;
    g.wrong = 2;
    g.correctRtTotalMs = 0;
  }
  assert.deepEqual(rotationMetrics(summary), {
    score: 0,
    meanCorrectRtMs: null,
  });
});

test("rotation engine waits for receipts, has no deadline and enforces 800 ms feedback", () => {
  const trials = generateRotationTrials(false, randomSource());
  const game = new MentalRotationGame(trials);
  let state = game.tick(100);
  assert.equal(
    game.answer(trials[0].relation, 100, state.presentationId),
    false,
  );
  game.commit(state.presentationId, 100);
  game.commit(state.presentationId, 500); // Does not restart the clock.
  assert.equal(game.tick(60100).phase, "question");
  assert.equal(
    game.answer(trials[0].relation, 60100, state.presentationId),
    true,
  );
  assert.equal(
    game.answer(trials[0].relation, 60100, state.presentationId),
    false,
  );
  state = game.tick(60100);
  assert.equal(state.phase, "feedback");
  assert.deepEqual(state.trial, trials[0]);
  assert.equal(
    game.answer(trials[0].relation, 60100, state.presentationId),
    false,
  );
  assert.equal(game.tick(80000).phase, "feedback"); // Feedback has not been committed.
  game.commit(state.presentationId, 80000);
  game.commit(state.presentationId, 80050);
  assert.equal(game.tick(80799).phase, "feedback");
  state = game.tick(80800);
  assert.equal(state.phase, "question");
  assert.equal(state.trialIndex, 1);
  assert.equal(state.committed, false);
  assert.equal(game.tick(1000000).trialIndex, 1); // Late scheduling never consumes unseen trials.
  assert.equal(game.answer(trials[0].relation, 1000000, 0), false);
  game.commit(0, 1000000);
  assert.equal(game.tick(1000000).committed, false);
  game.abort();
  assert.equal(game.tick(1000000).phase, "aborted");
  assert.equal(game.result, null);
});
test("rotation engine freezes the last answer, computes only correct time and isolates snapshots", () => {
  for (const warmup of [true, false]) {
    const trials = generateRotationTrials(warmup, randomSource());
    const game = new MentalRotationGame(trials);
    let now = 0;
    for (let i = 0; i < trials.length; i++) {
      let s = game.tick(now);
      game.commit(s.presentationId, now);
      s.trial!.relation =
        s.trial!.relation === "mirror" ? "rotation" : "mirror";
      if (i === 0)
        assert.ok(
          game.answer(
            trials[i].relation === "mirror" ? "rotation" : "mirror",
            now + 500,
            s.presentationId,
          ),
        );
      else
        assert.ok(
          game.answer(trials[i].relation, now + 123.6, s.presentationId),
        );
      now += 500;
      if (i === trials.length - 1) {
        const result = game.result!;
        validateRotationSummary(result, warmup);
        assert.equal(
          rotationGroupMetrics(result.groups).correct,
          trials.length - 1,
        );
        assert.equal(rotationMetrics(result).meanCorrectRtMs, 124);
        result.groups[0].correct = 999;
        game.abort();
        assert.equal(game.tick(now).phase, "finished");
        assert.ok(!game.result!.groups.some((g) => g.correct === 999));
      } else {
        s = game.tick(now);
        game.commit(s.presentationId, now);
        now += 800;
      }
    }
  }
  const trials = generateRotationTrials(true, randomSource());
  assert.throws(
    () => new MentalRotationGame([...trials.slice(0, 7), trials[0]]),
    /题目无效/,
  );
  const game = new MentalRotationGame(trials);
  game.commit(0, 10);
  game.tick(9);
  assert.equal(game.tick(11).phase, "aborted");
  assert.equal(game.result, null);
});
