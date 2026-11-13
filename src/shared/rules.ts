import {
  GAME,
  TRIPLE_GAME,
  type Counts,
  type Dimension,
  type GameCounts,
} from "./contracts.js";
export const TRIALS = 30;
export const STEP_MS = 2500;
export const LIT_MS = 500;
export function assertLevel(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error("N 必须为 1～5");
}
export function generateSequence(n: number, random = Math.random): number[] {
  return generateChannel(n, 9, random);
}
export interface ColorStimulus {
  cell: number;
  color: number;
}
export function generateColorSequence(
  n: number,
  random = Math.random,
): ColorStimulus[] {
  const positions = generateChannel(n, 9, random);
  const colors = generateChannel(n, 6, random);
  return positions.map((cell, i) => ({ cell, color: colors[i] }));
}
export interface TripleStimulus extends ColorStimulus {
  number: number;
}
export function generateTripleSequence(
  n: number,
  random = Math.random,
): TripleStimulus[] {
  const colors = generateColorSequence(n, random);
  const numbers = generateChannel(n, 9, random);
  return colors.map((stimulus, i) => ({ ...stimulus, number: numbers[i] + 1 }));
}
function generateChannel(
  n: number,
  symbols: number,
  random: () => number,
): number[] {
  assertLevel(n);
  for (;;) {
    const cells = Array.from({ length: n }, () =>
      Math.floor(random() * symbols),
    );
    let matches = 0;
    for (let i = n; i < n + TRIALS; i++) {
      const previous = cells[i - n];
      if (random() < 0.3) {
        cells.push(previous);
        matches++;
      } else {
        const other = Math.floor(random() * (symbols - 1));
        cells.push(other >= previous ? other + 1 : other);
      }
    }
    if (matches > 0 && matches < TRIALS) return cells;
  }
}
export function scoreResult(result: GameCounts): number {
  const channels = resultChannels(result);
  return (
    channels.reduce((total, channel) => total + score(channel.counts), 0) /
    channels.length
  );
}
export function resultChannels(
  result: GameCounts,
): { dimension: Dimension; counts: Counts }[] {
  if (result.game === GAME) return [{ dimension: "position", counts: result }];
  const channels: { dimension: Dimension; counts: Counts }[] = [
    { dimension: "position", counts: result.position },
    { dimension: "color", counts: result.color },
  ];
  if (result.game === TRIPLE_GAME)
    channels.push({ dimension: "number", counts: result.number });
  return channels;
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
