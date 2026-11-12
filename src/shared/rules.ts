import type { Counts } from "./contracts.js";
export const TRIALS = 30;
export const STEP_MS = 2500;
export const LIT_MS = 500;
export function assertLevel(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error("N 必须为 1～5");
}
export function generateSequence(n: number, random = Math.random): number[] {
  assertLevel(n);
  for (;;) {
    const cells = Array.from({ length: n }, () => Math.floor(random() * 9));
    let matches = 0;
    for (let i = n; i < n + TRIALS; i++) {
      const previous = cells[i - n];
      if (random() < 0.3) {
        cells.push(previous);
        matches++;
      } else {
        const other = Math.floor(random() * 8);
        cells.push(other >= previous ? other + 1 : other);
      }
    }
    if (matches > 0 && matches < TRIALS) return cells;
  }
}
export function validateCounts(counts: Counts): void {
  const values = [counts.tp, counts.fn, counts.fp, counts.tn];
  if (
    values.some((x) => !Number.isInteger(x) || x < 0) ||
    values.reduce((a, b) => a + b, 0) !== TRIALS ||
    counts.tp + counts.fn === 0 ||
    counts.tn + counts.fp === 0
  )
    throw new Error("无效的对局统计");
}
export function score(counts: Counts): number {
  validateCounts(counts);
  return (
    (100 *
      (counts.tp / (counts.tp + counts.fn) +
        counts.tn / (counts.tn + counts.fp))) /
    2
  );
}
