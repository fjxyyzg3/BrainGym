import type { CorsiSummary } from "./contracts.js";

export const CORSI_PHASE_MS = 500;
export const CORSI_LATE_MS = 100;
export const CORSI_FUTURE_MS = 5000;
export const CORSI_BATCH = 256;

export function validateCorsiSummary(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("顺序记忆统计无效");
  const p = value as CorsiSummary;
  const {
    startLength: s,
    failedLength: f,
    maxFirstTryLength: m,
    firstTrialCorrect: first,
  } = p;
  if (
    ![s, f, m].every(Number.isSafeInteger) ||
    s < 2 ||
    f < s ||
    m < 0 ||
    typeof first !== "boolean" ||
    (m !== 0 && (m < s || m >= f)) ||
    (f === s && (first || m !== 0)) ||
    (first && (f === s || m < s)) ||
    (!first && m === s) ||
    !Number.isSafeInteger(2 * (f - s + 1))
  )
    throw new Error("顺序记忆统计不一致");
}
export function corsiScore(p: CorsiSummary): number {
  validateCorsiSummary(p);
  return p.failedLength === p.startLength ? 0 : p.failedLength - 1;
}
export function nextCorsiStart(p: CorsiSummary): number {
  validateCorsiSummary(p);
  return p.firstTrialCorrect
    ? p.maxFirstTryLength
    : Math.max(2, p.startLength - 1);
}
export function validCorsiTime(
  completedAt: string,
  receivedAt: number,
): boolean {
  const time = Date.parse(completedAt);
  return (
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(completedAt) &&
    Number.isFinite(time) &&
    new Date(time).toISOString() === completedAt &&
    time <= receivedAt + CORSI_FUTURE_MS
  );
}
export function corsiCompletedAt(
  serverNow: number,
  anchorMono: number,
  now: number,
): string {
  if (![serverNow, anchorMono, now].every(Number.isFinite) || now < anchorMono)
    throw new Error("本局计时异常，无法保存");
  return new Date(serverNow + Math.floor(now - anchorMono)).toISOString();
}
export async function yieldCorsiTask(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (scheduler?.yield) await scheduler.yield();
  else await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
export async function generateCorsiSequence(
  length: number,
  options: {
    random?: () => number;
    signal?: AbortSignal;
    previous?: readonly number[];
    yieldTask?: () => Promise<void>;
  } = {},
): Promise<number[]> {
  if (
    !Number.isSafeInteger(length) ||
    length < 2 ||
    !Number.isSafeInteger(length * 1000)
  )
    throw new Error("当前设备无法安全表示该长度，请恢复起点后重试");
  // A conservative working-memory budget, not a gameplay level limit. Check
  // before allocating; never turn an untrusted length into a huge array.
  const memory = (
    globalThis.performance as
      | (Performance & {
          memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number };
        })
      | undefined
  )?.memory;
  const budget = memory
    ? Math.min(
        256 * 1024 * 1024,
        Math.max(0, (memory.jsHeapSizeLimit - memory.usedJSHeapSize) / 4),
      )
    : 64 * 1024 * 1024;
  if (length * 16 + (options.previous?.length ?? 0) * 8 > budget)
    throw new Error("当前设备资源不足，无法准备该序列；可恢复起点后重试");
  const random = options.random ?? Math.random;
  const yieldTask = options.yieldTask ?? yieldCorsiTask;
  const check = () => {
    if (options.signal?.aborted) throw new Error("序列准备已取消");
  };
  for (;;) {
    check();
    const sequence: number[] = [];
    let differs = options.previous?.length !== length;
    for (let base = 0; base < length; base += CORSI_BATCH) {
      check();
      const end = Math.min(length, base + CORSI_BATCH);
      for (let i = base; i < end; i++) {
        const sample = random();
        if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
          throw new Error("随机源无效");
        let cell = Math.floor(sample * (i === 0 ? 9 : 8));
        if (i > 0 && cell >= sequence[i - 1]) cell++;
        sequence.push(cell);
        if (options.previous?.[i] !== cell) differs = true;
      }
      if (end < length) await yieldTask();
    }
    check();
    if (differs) return sequence;
    await yieldTask(); // Rejection sampling keeps the second trial distinct.
  }
}
