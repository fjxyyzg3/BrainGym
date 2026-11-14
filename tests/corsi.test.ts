import { test } from "node:test";
import assert from "node:assert/strict";
import * as contracts from "../src/shared/contracts.js";

async function modules() {
  assert.equal(
    (contracts as unknown as Record<string, unknown>).CORSI_FORWARD,
    "corsi-forward",
    "缺少已批准的 Corsi 游戏合同",
  );
  return {
    ...(await import("../src/shared/corsi.js")),
    ...(await import("../src/client/corsi-game.js")),
  };
}
function random() {
  let state = 1234567;
  return () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
type Engine = InstanceType<
  (typeof import("../src/client/corsi-game.js"))["CorsiGame"]
>;
function present(game: Engine, start: number) {
  const cells: number[] = [];
  const length = game.tick(start).length;
  for (let slot = 0; slot <= length * 2; slot++) {
    const now = start + slot * 500;
    const state = game.tick(now);
    assert.notEqual(state.phase, "aborted", state.reason);
    assert.equal(state.slot, slot);
    if (slot < length * 2 && slot % 2 === 0) cells.push(state.cell!);
    game.commit(state.presentationId, slot, now);
  }
  assert.equal(game.tick(start + length * 1000).phase, "recalling");
  return { cells, now: start + length * 1000 };
}

test("Corsi has two independent identities", async () => {
  await modules();
  assert.equal(contracts.CORSI_BACKWARD, "corsi-backward");
  assert(contracts.isCorsiGameId(contracts.CORSI_FORWARD));
  assert(!contracts.isNBackGameId(contracts.CORSI_FORWARD));
});

test("span and next start follow all four approved examples", async () => {
  const { corsiScore, nextCorsiStart, validateCorsiSummary } = await modules();
  for (const [
    startLength,
    failedLength,
    firstTrialCorrect,
    maxFirstTryLength,
    score,
    next,
  ] of [
    [4, 6, true, 4, 5, 4],
    [5, 7, false, 6, 6, 4],
    [5, 5, false, 0, 0, 4],
    [2, 2, false, 0, 0, 2],
  ] as const) {
    const summary = {
      startLength,
      failedLength,
      firstTrialCorrect,
      maxFirstTryLength,
    };
    validateCorsiSummary(summary);
    assert.equal(corsiScore(summary), score);
    assert.equal(nextCorsiStart(summary), next);
  }
  for (const patch of [
    { startLength: 1 },
    { failedLength: 3 },
    { firstTrialCorrect: "true" },
    { maxFirstTryLength: 5 },
    { maxFirstTryLength: 3 },
    { failedLength: Infinity },
    { startLength: 4.5 },
    { startLength: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.throws(() =>
      validateCorsiSummary({
        startLength: 4,
        failedLength: 5,
        firstTrialCorrect: true,
        maxFirstTryLength: 4,
        ...patch,
      }),
    );
  assert.throws(() =>
    validateCorsiSummary({
      startLength: 4,
      failedLength: 5,
      firstTrialCorrect: false,
      maxFirstTryLength: 4,
    }),
  );
});

test("sequences exceed nine, exclude adjacent cells and differ within a level", async () => {
  const { generateCorsiSequence } = await modules();
  const rng = random();
  const first = await generateCorsiSequence(20, { random: rng });
  const second = await generateCorsiSequence(20, {
    random: rng,
    previous: first,
  });
  assert.equal(first.length, 20);
  assert.notDeepEqual(first, second);
  assert(
    first.every(
      (cell, i) => cell >= 0 && cell <= 8 && (i === 0 || cell !== first[i - 1]),
    ),
  );
  assert(new Set(first).size < first.length);
  assert.deepEqual(await generateCorsiSequence(2, { random: () => 0 }), [0, 1]);
});

test("preparation yields in bounded batches and cancellation or resource failure is safe", async () => {
  const { generateCorsiSequence, CorsiGame } = await modules();
  const controller = new AbortController();
  let draws = 0;
  await assert.rejects(
    generateCorsiSequence(1000, {
      random: () => {
        draws++;
        return 0.2;
      },
      signal: controller.signal,
      yieldTask: async () => controller.abort(),
    }),
    /取消/,
  );
  assert(draws <= 256);
  await assert.rejects(generateCorsiSequence(4294967297), /资源/);
  const game = new CorsiGame(contracts.CORSI_FORWARD, 4294967297);
  await game.prepare();
  assert.equal(game.tick(0).phase, "aborted");
  assert.equal(game.result, null);
});

for (const direction of ["corsi-forward", "corsi-backward"] as const) {
  test(`${direction}: complete input, feedback and two trials govern progression`, async () => {
    const { CorsiGame } = await modules();
    const game = new CorsiGame(direction, 2, random());
    await game.prepare();
    assert.equal(game.answer(0, 0), false);
    let { cells, now } = present(game, 0);
    if (direction === "corsi-backward") cells.reverse();
    assert(game.answer(cells[0], now));
    assert.equal(game.tick(now).correct, null);
    assert(game.answer(cells[1], now));
    assert.equal(game.tick(now).phase, "feedback");
    assert.equal(game.tick(now).trial, 1);
    assert.equal(game.tick(now).correct, true);
    assert.equal(game.answer(0, now), false);
    await game.next();
    assert.equal(game.tick(now).length, 2);
    const second = present(game, now);
    assert.notDeepEqual(
      second.cells,
      direction === "corsi-backward" ? [...cells].reverse() : cells,
    );
    game.giveUp(second.now);
    await game.next();
    assert.equal(game.tick(second.now).length, 3);
    const third = present(game, second.now);
    game.giveUp(third.now);
    await game.next();
    const fourth = present(game, third.now);
    game.giveUp(fourth.now);
    assert.equal(game.tick(fourth.now).phase, "finished");
    assert.deepEqual(game.result, {
      game: direction,
      startLength: 2,
      failedLength: 3,
      firstTrialCorrect: true,
      maxFirstTryLength: 2,
    });
    game.abort();
    assert.equal(game.tick(fourth.now + 10000).phase, "finished");
  });
}

test("mistake is hidden until whole response; give up counts only once", async () => {
  const { CorsiGame } = await modules();
  const game = new CorsiGame(contracts.CORSI_FORWARD, 2, random());
  await game.prepare();
  const { cells, now } = present(game, 0);
  game.answer((cells[0] + 1) % 9, now);
  assert.equal(game.tick(now).correct, null);
  game.answer(cells[1], now);
  assert.equal(game.tick(now).correct, false);
  await game.next();
  const second = present(game, now);
  assert(game.giveUp(second.now));
  assert.equal(game.giveUp(second.now), false);
  assert.equal(game.result?.failedLength, 2);
});

test("crossing length nine does not finish the challenge", async () => {
  const { CorsiGame } = await modules();
  const game = new CorsiGame(contracts.CORSI_FORWARD, 9, random());
  await game.prepare();
  const first = present(game, 0);
  for (const cell of first.cells) game.answer(cell, first.now);
  await game.next();
  const second = present(game, first.now);
  game.giveUp(second.now);
  await game.next();
  assert.equal(game.tick(second.now).length, 10);
  assert.equal(game.result, null);
});

test("presentation requires every commit and enforces the 100ms boundary", async () => {
  const { CorsiGame } = await modules();
  for (const delay of [100, 101]) {
    const game = new CorsiGame(contracts.CORSI_FORWARD, 2, random());
    await game.prepare();
    const first = game.tick(0);
    game.commit(first.presentationId, 0, 0);
    const blank = game.tick(500 + delay);
    game.commit(first.presentationId, 1, 500 + delay);
    assert.equal(
      game.tick(500 + delay).phase,
      delay === 100 ? "presenting" : "aborted",
    );
    if (delay === 101) assert.equal(game.result, null);
    void blank;
  }
  const game = new CorsiGame(contracts.CORSI_FORWARD, 2, random());
  await game.prepare();
  const first = game.tick(0);
  game.commit(first.presentationId, 0, 0);
  assert.equal(game.tick(1000).phase, "aborted");
  assert.equal(game.answer(0, 1000), false);
  assert.equal(game.result, null);
});

test("missing last blank or a late recall commit aborts; feedback abort has no result", async () => {
  const { CorsiGame } = await modules();
  for (const failure of ["blank", "recall"] as const) {
    const game = new CorsiGame(contracts.CORSI_FORWARD, 2, random());
    await game.prepare();
    for (let slot = 0; slot < 4; slot++) {
      const state = game.tick(slot * 500);
      if (failure !== "blank" || slot !== 3)
        game.commit(state.presentationId, slot, slot * 500);
    }
    const state = game.tick(2000);
    if (failure === "recall") game.commit(state.presentationId, 4, 2101);
    assert.equal(game.tick(2101).phase, "aborted");
  }
  const game = new CorsiGame(contracts.CORSI_FORWARD, 2, random());
  await game.prepare();
  const trial = present(game, 0);
  game.giveUp(trial.now);
  game.abort();
  assert.equal(game.result, null);
  await game.next();
  assert.equal(game.tick(10000).phase, "aborted");
});
