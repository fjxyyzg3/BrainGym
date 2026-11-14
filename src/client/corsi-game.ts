import {
  CORSI_BACKWARD,
  isCorsiGameId,
  type CorsiGameId,
  type CorsiSummary,
} from "../shared/contracts.js";
import {
  CORSI_PHASE_MS,
  CORSI_LATE_MS,
  generateCorsiSequence,
} from "../shared/corsi.js";

export interface CorsiSnapshot {
  phase:
    | "preparing"
    | "presenting"
    | "recalling"
    | "feedback"
    | "finished"
    | "aborted";
  length: number;
  trial: 1 | 2;
  slot: number;
  presentationId: number;
  cell: number | null;
  enteredCount: number;
  correct: boolean | null;
  levelPassed: boolean;
  reason: string;
}
export class CorsiGame {
  private phase: CorsiSnapshot["phase"] = "preparing";
  private length: number;
  private trial: 1 | 2 = 1;
  private sequence: number[] = [];
  private firstSequence: number[] | undefined;
  private controller: AbortController | null = null;
  private startedAt: number | null = null;
  private committed = -1;
  private slot = 0;
  private presentationId = 0;
  private entered = 0;
  private possible = true;
  private correct: boolean | null = null;
  private passed = false;
  private firstTrialCorrect = false;
  private maxFirstTryLength = 0;
  private outcome: (CorsiSummary & { game: CorsiGameId }) | null = null;
  private reason = "";
  constructor(
    private game: CorsiGameId,
    private startLength: number,
    private random = Math.random,
  ) {
    if (
      !isCorsiGameId(game) ||
      !Number.isSafeInteger(startLength) ||
      startLength < 2
    )
      throw new Error("顺序记忆配置无效");
    this.length = startLength;
  }
  async prepare(): Promise<void> {
    if (this.phase !== "preparing" || this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const sequence = await generateCorsiSequence(this.length, {
        random: this.random,
        signal: controller.signal,
        previous: this.trial === 2 ? this.firstSequence : undefined,
      });
      if (controller.signal.aborted || this.phase !== "preparing") return;
      this.sequence = sequence;
      if (this.trial === 1) this.firstSequence = sequence;
      this.startedAt = null;
      this.committed = -1;
      this.slot = 0;
      this.presentationId++;
      this.entered = 0;
      this.possible = true;
      this.correct = null;
      this.phase = "presenting";
    } catch (error) {
      this.abort((error as Error).message || "序列准备失败");
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
  tick(now: number): CorsiSnapshot {
    if (this.phase === "presenting" && this.startedAt !== null) {
      const slot = Math.floor((now - this.startedAt) / CORSI_PHASE_MS);
      const end = this.length * 2;
      if (
        !Number.isFinite(now) ||
        slot < 0 ||
        slot > this.committed + 1 ||
        (now - (this.startedAt + Math.min(slot, end) * CORSI_PHASE_MS) >
          CORSI_LATE_MS &&
          slot > this.committed)
      ) {
        this.abort("展示中断：存在漏展示或调度延迟");
      } else if (slot >= end) {
        if (this.committed !== end - 1) this.abort("最后留空未完整提交");
        else {
          this.slot = end;
          this.phase = "recalling";
        }
      } else this.slot = slot;
    }
    if (
      this.phase === "recalling" &&
      this.committed < this.length * 2 &&
      this.startedAt !== null &&
      now - (this.startedAt + this.length * 1000) > CORSI_LATE_MS
    )
      this.abort("复现展示延迟");
    return {
      phase: this.phase,
      length: this.length,
      trial: this.trial,
      slot: this.slot,
      presentationId: this.presentationId,
      cell:
        this.phase === "presenting" && this.slot % 2 === 0
          ? this.sequence[this.slot / 2]
          : null,
      enteredCount: this.entered,
      correct: this.correct,
      levelPassed: this.passed,
      reason: this.reason,
    };
  }
  commit(presentationId: number, slot: number, now: number): void {
    if (
      presentationId !== this.presentationId ||
      (this.phase !== "presenting" && this.phase !== "recalling")
    )
      return;
    if (this.startedAt === null) {
      if (slot !== 0 || !Number.isFinite(now)) return;
      this.startedAt = now;
      this.committed = 0;
      return;
    }
    if (slot === this.committed) return;
    if (
      slot !== this.committed + 1 ||
      slot !== this.slot ||
      now - (this.startedAt + slot * CORSI_PHASE_MS) > CORSI_LATE_MS ||
      now < this.startedAt + slot * CORSI_PHASE_MS
    ) {
      this.abort("展示提交无效");
      return;
    }
    this.committed = slot;
  }
  answer(cell: number, now: number): boolean {
    const state = this.tick(now);
    if (
      state.phase !== "recalling" ||
      this.committed !== this.length * 2 ||
      !Number.isInteger(cell) ||
      cell < 0 ||
      cell > 8
    )
      return false;
    const index =
      this.game === CORSI_BACKWARD
        ? this.length - 1 - this.entered
        : this.entered;
    if (cell !== this.sequence[index]) this.possible = false;
    this.entered++;
    if (this.entered === this.length) this.settle(this.possible);
    return true;
  }
  giveUp(now: number): boolean {
    if (
      this.tick(now).phase !== "recalling" ||
      this.committed !== this.length * 2
    )
      return false;
    this.settle(false);
    return true;
  }
  private settle(correct: boolean): void {
    this.correct = correct;
    this.passed ||= correct;
    if (this.trial === 1) {
      if (this.length === this.startLength) this.firstTrialCorrect = correct;
      if (correct) this.maxFirstTryLength = this.length;
    }
    if (this.trial === 2 && !this.passed) {
      this.outcome = {
        game: this.game,
        startLength: this.startLength,
        failedLength: this.length,
        firstTrialCorrect: this.firstTrialCorrect,
        maxFirstTryLength: this.maxFirstTryLength,
      };
      this.phase = "finished";
      this.sequence = [];
      this.firstSequence = undefined;
    } else this.phase = "feedback";
  }
  async next(): Promise<void> {
    if (this.phase !== "feedback") return;
    if (this.trial === 1) this.trial = 2;
    else {
      this.length++;
      this.trial = 1;
      this.passed = false;
      this.firstSequence = undefined;
    }
    this.phase = "preparing";
    this.sequence = [];
    await this.prepare();
  }
  abort(reason = "本局已结束"): void {
    if (this.phase === "finished") return;
    this.phase = "aborted";
    this.reason = reason;
    this.controller?.abort();
    this.sequence = [];
    this.firstSequence = undefined;
  }
  get result() {
    return this.outcome ? { ...this.outcome } : null;
  }
}
