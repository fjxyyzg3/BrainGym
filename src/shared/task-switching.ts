import type {
  TaskSwitchingAnswer,
  TaskSwitchingCounts,
  TaskSwitchingMetrics,
  TaskSwitchingRule,
  TaskSwitchingSummary,
} from "./contracts.js";

export const TASK_SWITCHING_NUMBERS = [1, 2, 3, 4, 6, 7, 8, 9] as const;
export const TASK_SWITCHING_DEADLINE_MS = 3000;
export const TASK_SWITCHING_FEEDBACK_MS = 300;
export const TASK_SWITCHING_LABELS = {
  parity: ["奇数", "偶数"],
  magnitude: ["小于 5", "大于 5"],
} as const;
export const TASK_SWITCHING_RULE_NAMES = {
  parity: "判断奇偶",
  magnitude: "比较大小",
} as const;
export interface TaskSwitchingTrial {
  rule: TaskSwitchingRule;
  number: number;
}
export function taskSwitchingAnswer(
  trial: TaskSwitchingTrial,
): TaskSwitchingAnswer {
  return trial.rule === "parity"
    ? trial.number % 2 === 1
      ? 0
      : 1
    : trial.number < 5
      ? 0
      : 1;
}
export function generateTaskSwitchingTrials(
  warmup = false,
  random = Math.random,
): TaskSwitchingTrial[] {
  const pick = (n: number) => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("随机源无效");
    return Math.floor(value * n);
  };
  const quota = warmup ? 4 : 20;
  const switches = Array.from({ length: quota * 2 }, (_, i) => i < quota);
  for (let i = switches.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [switches[i], switches[j]] = [switches[j], switches[i]];
  }
  let rule: TaskSwitchingRule = pick(2) === 0 ? "parity" : "magnitude";
  const digit = () =>
    TASK_SWITCHING_NUMBERS[pick(TASK_SWITCHING_NUMBERS.length)];
  const trials: TaskSwitchingTrial[] = [{ rule, number: digit() }];
  for (const switched of switches) {
    if (switched) rule = rule === "parity" ? "magnitude" : "parity";
    trials.push({ rule, number: digit() });
  }
  return trials;
}
export const emptyTaskSwitchingCounts = (): TaskSwitchingCounts => ({
  correct: 0,
  wrong: 0,
  timeout: 0,
  correctRtTotalMs: 0,
});
export function validateTaskSwitchingSummary(
  value: unknown,
  warmup = false,
): asserts value is TaskSwitchingSummary {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("统计无效");
  const s = value as TaskSwitchingSummary;
  for (const g of [s.repeat, s.switch]) {
    if (
      !g ||
      typeof g !== "object" ||
      Array.isArray(g) ||
      ![g.correct, g.wrong, g.timeout, g.correctRtTotalMs].every(
        (x) => Number.isSafeInteger(x) && x >= 0,
      ) ||
      g.correct + g.wrong + g.timeout !== (warmup ? 4 : 20) ||
      g.correctRtTotalMs > g.correct * TASK_SWITCHING_DEADLINE_MS
    )
      throw new Error("统计无效");
  }
}
export function taskSwitchingGroupMetrics(g: TaskSwitchingCounts) {
  const total = g.correct + g.wrong + g.timeout;
  return {
    score: total ? (100 * g.correct) / total : 0,
    meanCorrectRtMs: g.correct ? g.correctRtTotalMs / g.correct : null,
  };
}
export function taskSwitchingTotals(
  s: TaskSwitchingSummary,
): TaskSwitchingCounts {
  return {
    correct: s.repeat.correct + s.switch.correct,
    wrong: s.repeat.wrong + s.switch.wrong,
    timeout: s.repeat.timeout + s.switch.timeout,
    correctRtTotalMs: s.repeat.correctRtTotalMs + s.switch.correctRtTotalMs,
  };
}
export function taskSwitchingMetrics(
  s: TaskSwitchingSummary,
): TaskSwitchingMetrics {
  const a = taskSwitchingGroupMetrics(s.repeat),
    b = taskSwitchingGroupMetrics(s.switch);
  return {
    ...taskSwitchingGroupMetrics(taskSwitchingTotals(s)),
    switchCostMs:
      a.meanCorrectRtMs === null || b.meanCorrectRtMs === null
        ? null
        : b.meanCorrectRtMs - a.meanCorrectRtMs,
  };
}
