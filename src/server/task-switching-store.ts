import type { DatabaseSync } from "node:sqlite";
import {
  TASK_SWITCHING_GAME,
  type TaskSwitchingResultInput,
  type TaskSwitchingSavedResult,
  type TaskSwitchingHistory,
} from "../shared/contracts.js";
import {
  validateTaskSwitchingSummary,
  taskSwitchingMetrics,
} from "../shared/task-switching.js";
import { AppError } from "./errors.js";

type Row = { payload: string; received_at: string };
export function parseTaskSwitchingResult(
  value: unknown,
): TaskSwitchingResultInput {
  const p = value as TaskSwitchingResultInput;
  try {
    validateTaskSwitchingSummary(value);
    const id = /^[a-f0-9-]{36}$/i;
    if (
      p.game !== TASK_SWITCHING_GAME ||
      p.version !== 1 ||
      typeof p.resultId !== "string" ||
      !id.test(p.resultId) ||
      typeof p.startedByUserId !== "string" ||
      !id.test(p.startedByUserId) ||
      typeof p.completedAt !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.completedAt) ||
      !Number.isFinite(Date.parse(p.completedAt)) ||
      new Date(p.completedAt).toISOString() !== p.completedAt
    )
      throw new Error();
  } catch {
    throw new AppError(400, "INVALID_RESULT", "规则切换对局数据无效");
  }
  const group = (g: TaskSwitchingResultInput["repeat"]) => ({
    correct: g.correct,
    wrong: g.wrong,
    timeout: g.timeout,
    correctRtTotalMs: g.correctRtTotalMs,
  });
  return {
    resultId: p.resultId,
    startedByUserId: p.startedByUserId,
    game: TASK_SWITCHING_GAME,
    version: 1,
    repeat: group(p.repeat),
    switch: group(p.switch),
    completedAt: p.completedAt,
  };
}
function toResult(row: Row): TaskSwitchingSavedResult {
  const payload = JSON.parse(row.payload) as TaskSwitchingResultInput;
  return {
    ...payload,
    ...taskSwitchingMetrics(payload),
    receivedAt: row.received_at,
  };
}
export class TaskSwitchingRepository {
  constructor(private db: DatabaseSync) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS task_switching_results(
        user_id TEXT NOT NULL REFERENCES users(id),result_id TEXT NOT NULL,game TEXT NOT NULL,version INTEGER NOT NULL,
        payload TEXT NOT NULL,score REAL NOT NULL,correct_rt_total_ms INTEGER NOT NULL,
        completed_at TEXT NOT NULL,received_at TEXT NOT NULL,PRIMARY KEY(user_id,result_id));
        CREATE INDEX IF NOT EXISTS task_switching_history ON task_switching_results(user_id,game,version,completed_at DESC,received_at DESC,result_id DESC);
        CREATE INDEX IF NOT EXISTS task_switching_best ON task_switching_results(user_id,game,version,score DESC,correct_rt_total_ms,received_at,result_id);
        COMMIT;`);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  find(userId: string, resultId: string) {
    const row = this.db
      .prepare(
        "SELECT payload,received_at FROM task_switching_results WHERE user_id=? AND result_id=?",
      )
      .get(userId, resultId) as Row | undefined;
    return row ? { serialized: row.payload, result: toResult(row) } : null;
  }
  saveNew(
    userId: string,
    p: TaskSwitchingResultInput,
    now: number,
  ): TaskSwitchingSavedResult {
    const row = {
      payload: JSON.stringify(p),
      received_at: new Date(now).toISOString(),
    };
    this.db
      .prepare("INSERT INTO task_switching_results VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        userId,
        p.resultId,
        TASK_SWITCHING_GAME,
        1,
        row.payload,
        taskSwitchingMetrics(p).score,
        p.repeat.correctRtTotalMs + p.switch.correctRtTotalMs,
        p.completedAt,
        row.received_at,
      );
    return toResult(row);
  }
  history(userId: string, page: number): TaskSwitchingHistory {
    const total = this.db
      .prepare(
        "SELECT count(*) AS count FROM task_switching_results WHERE user_id=? AND game=? AND version=1",
      )
      .get(userId, TASK_SWITCHING_GAME)!.count as number;
    const rows = this.db
      .prepare(
        "SELECT payload,received_at FROM task_switching_results WHERE user_id=? AND game=? AND version=1 ORDER BY completed_at DESC,received_at DESC,result_id DESC LIMIT 20 OFFSET ?",
      )
      .all(userId, TASK_SWITCHING_GAME, (page - 1) * 20) as Row[];
    return { items: rows.map(toResult), page, pageSize: 20, total };
  }
  bests(userId: string): TaskSwitchingSavedResult[] {
    // Equal accuracy means equal correct counts in fixed 40-trial games, so sums order means exactly.
    const row = this.db
      .prepare(
        "SELECT payload,received_at FROM task_switching_results WHERE user_id=? AND game=? AND version=1 ORDER BY score DESC,correct_rt_total_ms ASC,received_at ASC,result_id ASC LIMIT 1",
      )
      .get(userId, TASK_SWITCHING_GAME) as Row | undefined;
    return row ? [toResult(row)] : [];
  }
}
