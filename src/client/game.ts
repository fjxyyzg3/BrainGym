import type { Counts } from "../shared/contracts.js";
import { assertLevel, TRIALS, STEP_MS, LIT_MS } from "../shared/rules.js";
export interface GameSnapshot {
  phase: "warmup" | "playing" | "finished" | "aborted";
  cell: number | null;
  lit: boolean;
  trial: number;
  answered: boolean;
}
export class NBackGame {
  private answers = new Set<number>();
  private ended = false;
  private aborted = false;
  private counts: Counts | null = null;
  constructor(
    private n: number,
    private sequence: number[],
    private startedAt: number,
  ) {
    assertLevel(n);
    if (
      sequence.length !== n + TRIALS ||
      sequence.some((x) => !Number.isInteger(x) || x < 0 || x > 8)
    )
      throw new Error("无效的题目序列");
  }
  tick(now: number): GameSnapshot {
    const elapsed = Math.max(0, now - this.startedAt);
    const index = Math.floor(elapsed / STEP_MS);
    if (!this.aborted && !this.ended && index >= this.sequence.length) {
      this.ended = true;
      this.counts = { tp: 0, fn: 0, fp: 0, tn: 0 };
      for (let i = this.n; i < this.sequence.length; i++) {
        const match = this.sequence[i] === this.sequence[i - this.n];
        const answered = this.answers.has(i);
        this.counts[
          match ? (answered ? "tp" : "fn") : answered ? "fp" : "tn"
        ]++;
      }
    }
    if (this.aborted || this.ended)
      return {
        phase: this.aborted ? "aborted" : "finished",
        cell: null,
        lit: false,
        trial: TRIALS,
        answered: false,
      };
    return {
      phase: index < this.n ? "warmup" : "playing",
      cell: this.sequence[index],
      lit: elapsed % STEP_MS < LIT_MS,
      trial: index < this.n ? index + 1 : index - this.n + 1,
      answered: this.answers.has(index),
    };
  }
  answer(now: number): boolean {
    const state = this.tick(now);
    if (state.phase !== "playing" || state.answered) return false;
    this.answers.add(Math.floor(Math.max(0, now - this.startedAt) / STEP_MS));
    return true;
  }
  abort(): void {
    if (!this.ended) this.aborted = true;
  }
  get result(): Counts | null {
    return this.counts ? { ...this.counts } : null;
  }
}
