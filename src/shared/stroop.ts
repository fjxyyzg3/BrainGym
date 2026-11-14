import type {
  StroopColor,
  StroopCounts,
  StroopMetrics,
  StroopSummary,
} from "./contracts.js";

export const STROOP_COLORS = [
  { name: "红", value: "#ff8b94" },
  { name: "蓝", value: "#76bcff" },
  { name: "绿", value: "#68d9ad" },
  { name: "黄", value: "#f6d65d" },
] as const;
export const STROOP_DEADLINE_MS = 3000;
export const STROOP_FEEDBACK_MS = 300;
export interface StroopTrial {
  ink: StroopColor;
  word: StroopColor;
}
export function generateStroopTrials(
  warmup = false,
  random = Math.random,
): StroopTrial[] {
  const pick = (n: number) => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("随机源无效");
    return Math.floor(value * n);
  };
  const types = Array.from(
    { length: warmup ? 8 : 40 },
    (_, i) => i < (warmup ? 2 : 10),
  );
  for (let i = types.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [types[i], types[j]] = [types[j], types[i]];
  }
  return types.map((congruent) => {
    const ink = pick(4) as StroopColor;
    const other = congruent ? ink : pick(3);
    const word = (
      congruent ? ink : other >= ink ? other + 1 : other
    ) as StroopColor;
    return { ink, word };
  });
}
export const emptyStroopCounts = (): StroopCounts => ({
  correct: 0,
  wrong: 0,
  timeout: 0,
  correctRtTotalMs: 0,
});
export function validateStroopSummary(
  value: unknown,
  warmup = false,
): asserts value is StroopSummary {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("统计无效");
  const s = value as StroopSummary;
  for (const [g, total] of [
    [s.congruent, warmup ? 2 : 10],
    [s.incongruent, warmup ? 6 : 30],
  ] as const) {
    if (
      !g ||
      typeof g !== "object" ||
      Array.isArray(g) ||
      ![g.correct, g.wrong, g.timeout, g.correctRtTotalMs].every(
        (x) => Number.isSafeInteger(x) && x >= 0,
      ) ||
      g.correct + g.wrong + g.timeout !== total ||
      g.correctRtTotalMs > g.correct * STROOP_DEADLINE_MS
    )
      throw new Error("统计无效");
  }
}
export function stroopGroupMetrics(g: StroopCounts) {
  const total = g.correct + g.wrong + g.timeout;
  return {
    score: total ? (100 * g.correct) / total : 0,
    meanCorrectRtMs: g.correct ? g.correctRtTotalMs / g.correct : null,
  };
}
export function stroopMetrics(s: StroopSummary): StroopMetrics {
  const a = stroopGroupMetrics(s.congruent),
    b = stroopGroupMetrics(s.incongruent);
  const total = {
    correct: s.congruent.correct + s.incongruent.correct,
    wrong: s.congruent.wrong + s.incongruent.wrong,
    timeout: s.congruent.timeout + s.incongruent.timeout,
    correctRtTotalMs:
      s.congruent.correctRtTotalMs + s.incongruent.correctRtTotalMs,
  };
  return {
    ...stroopGroupMetrics(total),
    interferenceMs:
      a.meanCorrectRtMs === null || b.meanCorrectRtMs === null
        ? null
        : b.meanCorrectRtMs - a.meanCorrectRtMs,
  };
}
