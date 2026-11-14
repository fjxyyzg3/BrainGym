import type { StroopColor, StroopSummary } from "../shared/contracts";
import {
  emptyStroopCounts,
  STROOP_DEADLINE_MS,
  STROOP_FEEDBACK_MS,
  type StroopTrial,
} from "../shared/stroop";

export interface StroopSnapshot {
  phase: "question" | "feedback" | "finished" | "aborted";
  trialIndex: number;
  presentationId: number;
  committed: boolean;
  trial: StroopTrial | null;
  feedback: { kind: "correct" | "wrong" | "timeout"; ink: StroopColor } | null;
}
export class StroopGame {
  private phase: StroopSnapshot["phase"] = "question";
  private index = 0;
  private receipt = 0;
  private started: number | null = null;
  private lastNow = -Infinity;
  private feedback: StroopSnapshot["feedback"] = null;
  private summary: StroopSummary = {
    congruent: emptyStroopCounts(),
    incongruent: emptyStroopCounts(),
  };
  private outcome: StroopSummary | null = null;
  completedAtMono: number | null = null;
  private trials: StroopTrial[];
  constructor(trials: StroopTrial[]) {
    if (
      ![8, 40].includes(trials.length) ||
      trials.some(
        (t) => ![0, 1, 2, 3].includes(t.ink) || ![0, 1, 2, 3].includes(t.word),
      ) ||
      trials.filter((t) => t.ink === t.word).length !==
        (trials.length === 8 ? 2 : 10)
    )
      throw new Error("颜色干扰题目无效");
    this.trials = trials.map((t) => ({ ...t }));
  }
  private observe(now: number) {
    if (!Number.isFinite(now) || now < this.lastNow) {
      this.abort();
      return false;
    }
    this.lastNow = now;
    return true;
  }
  tick(now: number): StroopSnapshot {
    if (this.observe(now) && this.started !== null) {
      if (this.phase === "question" && now - this.started >= STROOP_DEADLINE_MS)
        this.settle("timeout", now);
      else if (
        this.phase === "feedback" &&
        now - this.started >= STROOP_FEEDBACK_MS
      ) {
        if (this.outcome) this.phase = "finished";
        else {
          this.index++;
          this.receipt++;
          this.phase = "question";
          this.feedback = null;
          this.started = null;
        }
      }
    }
    return {
      phase: this.phase,
      trialIndex: this.index,
      presentationId: this.receipt,
      committed: this.started !== null,
      trial: this.phase === "question" ? { ...this.trials[this.index] } : null,
      feedback: this.feedback ? { ...this.feedback } : null,
    };
  }
  commit(presentationId: number, now: number): void {
    if (
      presentationId !== this.receipt ||
      this.started !== null ||
      !["question", "feedback"].includes(this.phase)
    )
      return;
    if (this.observe(now)) this.started = now;
  }
  answer(color: StroopColor, now: number, presentationId: number): boolean {
    if (presentationId !== this.receipt) return false;
    const state = this.tick(now);
    if (
      state.phase !== "question" ||
      this.started === null ||
      ![0, 1, 2, 3].includes(color)
    )
      return false;
    this.settle(
      color === this.trials[this.index].ink ? "correct" : "wrong",
      now,
    );
    return true;
  }
  private settle(kind: "correct" | "wrong" | "timeout", now: number) {
    const trial = this.trials[this.index];
    const group =
      trial.ink === trial.word
        ? this.summary.congruent
        : this.summary.incongruent;
    group[kind]++;
    if (kind === "correct")
      group.correctRtTotalMs += Math.round(now - this.started!);
    this.feedback = { kind, ink: trial.ink };
    this.phase = "feedback";
    this.receipt++;
    this.started = null;
    if (this.index === this.trials.length - 1) {
      this.outcome = structuredClone(this.summary);
      this.completedAtMono = now;
    }
  }
  abort(): void {
    this.phase = this.outcome ? "finished" : "aborted";
    this.started = null;
    this.trials = [];
  }
  get result(): StroopSummary | null {
    return this.outcome ? structuredClone(this.outcome) : null;
  }
}
