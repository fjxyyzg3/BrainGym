import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskSwitchingSummary } from "../src/client/TaskSwitchingSummary.js";
import {
  generateTaskSwitchingTrials,
  taskSwitchingAnswer,
  TASK_SWITCHING_NUMBERS,
  taskSwitchingMetrics,
  validateTaskSwitchingSummary,
} from "../src/shared/task-switching.js";
import { TaskSwitchingGame } from "../src/client/task-switching-game.js";

test("结果与记录的汇总同时显示整体次数和两类统计", () => {
  const html = renderToStaticMarkup(
    createElement(TaskSwitchingSummary, {
      summary: {
        repeat: { correct: 7, wrong: 5, timeout: 8, correctRtTotalMs: 700 },
        switch: { correct: 12, wrong: 4, timeout: 4, correctRtTotalMs: 2400 },
      },
    }),
  );
  assert.match(html, /<th scope="row">整体<\/th>/);
  assert.match(html, /<td>19<\/td><td>9<\/td><td>12<\/td>/);
  assert.match(html, /<th scope="row">重复题<\/th>/);
  assert.match(html, /<th scope="row">切换题<\/th>/);
});

test("规则切换题序列固定转换配额，八个数字等概率候选并允许重复", () => {
  for (const warmup of [false, true]) {
    for (let digit = 0; digit < 8; digit++) {
      const deck = generateTaskSwitchingTrials(warmup, () => (digit + 0.1) / 8);
      assert.equal(deck.length, warmup ? 9 : 41);
      assert.equal(
        deck.slice(1).filter((t, i) => t.rule !== deck[i].rule).length,
        warmup ? 4 : 20,
      );
      assert.ok(deck.every((t) => t.number === TASK_SWITCHING_NUMBERS[digit]));
      assert.equal(deck[0].rule, digit < 4 ? "parity" : "magnitude");
    }
  }
  for (const value of [-1, 1, Infinity, NaN])
    assert.throws(() => generateTaskSwitchingTrials(false, () => value));
  for (const number of TASK_SWITCHING_NUMBERS) {
    assert.equal(
      taskSwitchingAnswer({ rule: "parity", number }),
      number % 2 === 1 ? 0 : 1,
    );
    assert.equal(
      taskSwitchingAnswer({ rule: "magnitude", number }),
      number < 5 ? 0 : 1,
    );
  }
  assert.throws(
    () =>
      new TaskSwitchingGame(
        generateTaskSwitchingTrials().map((t) => ({ ...t, number: 5 })),
      ),
  );
  assert.throws(
    () =>
      new TaskSwitchingGame(
        Array.from({ length: 41 }, () => ({ rule: "parity", number: 1 })),
      ),
  );
});

test("分类指标按正确数加权，保留负差，拒绝非法摘要", () => {
  const s = {
    repeat: { correct: 5, wrong: 5, timeout: 10, correctRtTotalMs: 5000 },
    switch: { correct: 15, wrong: 0, timeout: 5, correctRtTotalMs: 7500 },
  };
  validateTaskSwitchingSummary(s);
  assert.deepEqual(taskSwitchingMetrics(s), {
    score: 50,
    meanCorrectRtMs: 625,
    switchCostMs: -500,
  });
  const zero = { correct: 0, wrong: 0, timeout: 20, correctRtTotalMs: 0 };
  assert.deepEqual(taskSwitchingMetrics({ repeat: zero, switch: zero }), {
    score: 0,
    meanCorrectRtMs: null,
    switchCostMs: null,
  });
  assert.equal(taskSwitchingMetrics({ ...s, repeat: zero }).switchCostMs, null);
  for (const patch of [
    null,
    [],
    { ...zero, correctRtTotalMs: 1 },
    { ...s.repeat, correct: -1 },
    { ...s.repeat, correct: 1.5 },
    { ...s.repeat, correctRtTotalMs: 15001 },
    { ...s.repeat, correctRtTotalMs: NaN },
    { ...zero, timeout: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.throws(() => validateTaskSwitchingSummary({ ...s, repeat: patch }));
  }
  assert.throws(() => validateTaskSwitchingSummary(null));
});

test("回执之前不计时，重复／旧回执不重置，首次输入与期限相等边界正确", () => {
  const game = new TaskSwitchingGame(
    generateTaskSwitchingTrials(true, () => 0),
  );
  const s = game.tick(0);
  assert.equal(game.answer(0, 1000, s.presentationId), false);
  game.commit(s.presentationId, 2000);
  game.commit(s.presentationId, 3000);
  assert.equal(game.answer(0, 4999.6, s.presentationId), true);
  assert.equal(game.answer(1, 4999.6, s.presentationId), false);
  const f = game.tick(9000);
  assert.equal(f.phase, "feedback");
  assert.equal(game.tick(100000).trialIndex, 0);
  game.commit(s.presentationId, 100000);
  assert.equal(game.tick(100001).phase, "feedback");
  game.commit(f.presentationId, 100010);
  assert.equal(game.tick(100309).phase, "feedback");
  const next = game.tick(100310);
  assert.equal(next.trialIndex, 1);
  assert.equal(game.answer(0, 100310, s.presentationId), false);
  assert.equal(game.answer(0, 100310, next.presentationId), false);
  game.commit(next.presentationId, 100400);
  assert.equal(game.answer(0, 103400, next.presentationId), false);
  assert.equal(game.tick(500000).feedback?.kind, "timeout");
  assert.equal(game.tick(500000).trialIndex, 1);
});

test("起始题无论正误或超时都不计分，后续错误不改变相邻规则分类", () => {
  for (const first of ["correct", "wrong", "timeout"]) {
    const deck = generateTaskSwitchingTrials(false, () => 0.42);
    const game = new TaskSwitchingGame(deck);
    const expected = {
      repeat: { correct: 0, wrong: 0, timeout: 0, correctRtTotalMs: 0 },
      switch: { correct: 0, wrong: 0, timeout: 0, correctRtTotalMs: 0 },
    };
    let now = 0;
    for (let i = 0; i < deck.length; i++) {
      now = Math.ceil(now);
      const s = game.tick(now);
      game.commit(s.presentationId, now);
      const kind =
        i === 0
          ? first
          : i % 3 === 0
            ? "wrong"
            : i % 3 === 1
              ? "timeout"
              : "correct";
      if (kind === "timeout") now += 3000;
      else {
        now += 100.4;
        const correct = taskSwitchingAnswer(deck[i]);
        assert.equal(
          game.answer(
            kind === "correct" ? correct : correct === 0 ? 1 : 0,
            now,
            s.presentationId,
          ),
          true,
        );
      }
      const f = game.tick(now);
      assert.equal(f.feedback?.kind, kind);
      if (i > 0) {
        const group =
          deck[i].rule === deck[i - 1].rule ? expected.repeat : expected.switch;
        group[kind as "correct" | "wrong" | "timeout"]++;
        if (kind === "correct") group.correctRtTotalMs += 100;
      }
      game.commit(f.presentationId, now);
      now += 301;
      game.tick(now);
    }
    assert.deepEqual(game.result, expected);
    validateTaskSwitchingSummary(game.result);
    const copy = game.result!;
    copy.repeat.correct = 999;
    assert.deepEqual(game.result, expected);
    game.abort();
    assert.equal(game.tick(now).phase, "finished");
    assert.deepEqual(game.result, expected);
  }
});

test("末题反馈期间已有冻结结果，未完成中断或倒退时钟不能生成结果", () => {
  const deck = generateTaskSwitchingTrials(true, () => 0);
  const game = new TaskSwitchingGame(deck);
  let now = 0;
  for (let i = 0; i < deck.length; i++) {
    const s = game.tick(now);
    game.commit(s.presentationId, now);
    game.answer(taskSwitchingAnswer(deck[i]), now + 100, s.presentationId);
    const f = game.tick(now + 100);
    if (i === deck.length - 1) break;
    game.commit(f.presentationId, now + 100);
    now += 400;
  }
  assert.equal(game.completedAtMono, now + 100);
  assert.equal(game.result!.repeat.correct, 4);
  assert.equal(game.result!.switch.correct, 4);
  assert.equal(
    game.result!.repeat.correctRtTotalMs + game.result!.switch.correctRtTotalMs,
    800,
  );
  game.abort();
  assert.equal(game.tick(now + 1000).phase, "finished");
  const partial = new TaskSwitchingGame(deck);
  partial.tick(10);
  assert.equal(partial.tick(9).phase, "aborted");
  assert.equal(partial.result, null);
  const aborted = new TaskSwitchingGame(deck);
  aborted.abort();
  assert.equal(aborted.tick(0).phase, "aborted");
  assert.equal(aborted.result, null);
});
