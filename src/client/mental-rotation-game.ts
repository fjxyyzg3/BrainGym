import type { RotationRelation, RotationSummary } from "../shared/contracts";
import {
  emptyRotationSummary,
  rotationGroupKey,
  validateRotationSummary,
  ROTATION_FEEDBACK_MS,
  type RotationTrial,
} from "../shared/mental-rotation";
import { isRotationShape, shapeKey } from "../shared/rotation-geometry";

export interface RotationSnapshot {
  phase: "question" | "feedback" | "finished" | "aborted";
  trialIndex: number;
  presentationId: number;
  committed: boolean;
  trial: RotationTrial | null;
  feedback: { kind: "correct" | "wrong"; relation: RotationRelation } | null;
}
export class MentalRotationGame {
  private phase: RotationSnapshot["phase"] = "question";
  private index = 0;
  private receipt = 0;
  private started: number | null = null;
  private lastNow = -Infinity;
  private feedback: RotationSnapshot["feedback"] = null;
  private summary = emptyRotationSummary();
  private outcome: RotationSummary | null = null;
  private trials: RotationTrial[];
  completedAtMono: number | null = null;
  constructor(trials: RotationTrial[]) {
    try {
      if (![8, 32].includes(trials.length)) throw new Error();
      const counts = emptyRotationSummary(),
        seen = new Set<string>();
      for (const t of trials) {
        const group = counts.groups.find(
          (g) => rotationGroupKey(g) === rotationGroupKey(t),
        );
        if (
          !group ||
          !isRotationShape(t.shape, t.complexity === "simple" ? 6 : 10) ||
          Math.abs(t.rotation) !== t.angle ||
          !Number.isInteger(t.baseTurns) ||
          t.baseTurns < 0 ||
          t.baseTurns > 3 ||
          seen.has(shapeKey(t.shape))
        )
          throw new Error();
        seen.add(shapeKey(t.shape));
        group.wrong++;
      }
      validateRotationSummary(counts, trials.length === 8);
    } catch {
      throw new Error("心理旋转题目无效");
    }
    this.trials = structuredClone(trials);
  }
  private observe(now: number) {
    if (!Number.isFinite(now) || now < this.lastNow) {
      this.abort();
      return false;
    }
    this.lastNow = now;
    return true;
  }
  tick(now: number): RotationSnapshot {
    if (
      this.observe(now) &&
      this.phase === "feedback" &&
      this.started !== null &&
      now - this.started >= ROTATION_FEEDBACK_MS
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
    return {
      phase: this.phase,
      trialIndex: this.index,
      presentationId: this.receipt,
      committed: this.started !== null,
      trial: ["question", "feedback"].includes(this.phase)
        ? structuredClone(this.trials[this.index])
        : null,
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
  answer(
    relation: RotationRelation,
    now: number,
    presentationId: number,
  ): boolean {
    if (presentationId !== this.receipt) return false;
    const state = this.tick(now);
    if (
      state.phase !== "question" ||
      this.started === null ||
      !["rotation", "mirror"].includes(relation)
    )
      return false;
    const t = this.trials[this.index],
      group = this.summary.groups.find(
        (g) => rotationGroupKey(g) === rotationGroupKey(t),
      )!;
    const correct = relation === t.relation,
      elapsed = Math.round(now - this.started);
    const total =
      this.summary.groups.reduce((sum, g) => sum + g.correctRtTotalMs, 0) +
      elapsed;
    if (
      correct &&
      (!Number.isSafeInteger(elapsed) ||
        elapsed < 0 ||
        !Number.isSafeInteger(total))
    ) {
      this.abort();
      return false;
    }
    group[correct ? "correct" : "wrong"]++;
    if (correct) group.correctRtTotalMs += elapsed;
    this.feedback = {
      kind: correct ? "correct" : "wrong",
      relation: t.relation,
    };
    this.phase = "feedback";
    this.receipt++;
    this.started = null;
    if (this.index === this.trials.length - 1) {
      this.outcome = structuredClone(this.summary);
      this.completedAtMono = now;
    }
    return true;
  }
  abort(): void {
    this.phase = this.outcome ? "finished" : "aborted";
    this.started = null;
    this.trials = [];
  }
  get result(): RotationSummary | null {
    return this.outcome ? structuredClone(this.outcome) : null;
  }
}
