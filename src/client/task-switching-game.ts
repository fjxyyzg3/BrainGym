import type {
  TaskSwitchingAnswer,
  TaskSwitchingRule,
  TaskSwitchingSummary,
} from "../shared/contracts";
import {
  emptyTaskSwitchingCounts,
  TASK_SWITCHING_DEADLINE_MS,
  TASK_SWITCHING_FEEDBACK_MS,
  TASK_SWITCHING_NUMBERS,
  taskSwitchingAnswer,
  type TaskSwitchingTrial,
} from "../shared/task-switching";

export interface TaskSwitchingSnapshot {
  phase: "question" | "feedback" | "finished" | "aborted";
  trialIndex: number;
  presentationId: number;
  committed: boolean;
  trial: TaskSwitchingTrial | null;
  feedback: {
    kind: "correct" | "wrong" | "timeout";
    answer: TaskSwitchingAnswer;
    rule: TaskSwitchingRule;
  } | null;
}
export class TaskSwitchingGame {
  private phase: TaskSwitchingSnapshot["phase"] = "question";
  private index = 0;
  private receipt = 0;
  private started: number | null = null;
  private lastNow = -Infinity;
  private feedback: TaskSwitchingSnapshot["feedback"] = null;
  private summary: TaskSwitchingSummary = {
    repeat: emptyTaskSwitchingCounts(),
    switch: emptyTaskSwitchingCounts(),
  };
  private outcome: TaskSwitchingSummary | null = null;
  completedAtMono: number | null = null;
  private trials: TaskSwitchingTrial[];
  constructor(trials: TaskSwitchingTrial[]) {
    if (
      ![9, 41].includes(trials.length) ||
      trials.some(
        (t) =>
          !["parity", "magnitude"].includes(t.rule) ||
          !(TASK_SWITCHING_NUMBERS as readonly number[]).includes(t.number),
      ) ||
      trials.slice(1).filter((t, i) => t.rule !== trials[i].rule).length !==
        (trials.length === 9 ? 4 : 20)
    )
      throw new Error("规则切换题目无效");
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
  tick(now: number): TaskSwitchingSnapshot {
    if (this.observe(now) && this.started !== null) {
      if (
        this.phase === "question" &&
        now - this.started >= TASK_SWITCHING_DEADLINE_MS
      )
        this.settle("timeout", now);
      else if (
        this.phase === "feedback" &&
        now - this.started >= TASK_SWITCHING_FEEDBACK_MS
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
  answer(
    answer: TaskSwitchingAnswer,
    now: number,
    presentationId: number,
  ): boolean {
    if (presentationId !== this.receipt) return false;
    const state = this.tick(now);
    if (
      state.phase !== "question" ||
      this.started === null ||
      ![0, 1].includes(answer)
    )
      return false;
    this.settle(
      answer === taskSwitchingAnswer(this.trials[this.index])
        ? "correct"
        : "wrong",
      now,
    );
    return true;
  }
  private settle(kind: "correct" | "wrong" | "timeout", now: number) {
    const trial = this.trials[this.index];
    if (this.index > 0) {
      const group =
        trial.rule === this.trials[this.index - 1].rule
          ? this.summary.repeat
          : this.summary.switch;
      group[kind]++;
      if (kind === "correct")
        group.correctRtTotalMs += Math.round(now - this.started!);
    }
    this.feedback = {
      kind,
      answer: taskSwitchingAnswer(trial),
      rule: trial.rule,
    };
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
  get result(): TaskSwitchingSummary | null {
    return this.outcome ? structuredClone(this.outcome) : null;
  }
}
