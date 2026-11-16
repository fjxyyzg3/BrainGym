import type { DatabaseSync } from "node:sqlite";
import {
  ROTATION_GAME,
  type RotationResultInput,
  type RotationSavedResult,
  type RotationHistory,
} from "../shared/contracts.js";
import {
  validateRotationSummary,
  canonicalRotationGroups,
  rotationMetrics,
} from "../shared/mental-rotation.js";
import { AppError } from "./errors.js";

type Row = { payload: string; received_at: string };
export function parseRotationResult(value: unknown): RotationResultInput {
  const p = value as RotationResultInput;
  try {
    validateRotationSummary(value);
    const id = /^[a-f0-9-]{36}$/i;
    if (
      p.game !== ROTATION_GAME ||
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
    throw new AppError(400, "INVALID_RESULT", "心理旋转对局数据无效");
  }
  return {
    resultId: p.resultId,
    startedByUserId: p.startedByUserId,
    game: ROTATION_GAME,
    version: 1,
    groups: canonicalRotationGroups(p),
    completedAt: p.completedAt,
  };
}
function toResult(row: Row): RotationSavedResult {
  const payload = JSON.parse(row.payload) as RotationResultInput;
  return {
    ...payload,
    ...rotationMetrics(payload),
    receivedAt: row.received_at,
  };
}
export class RotationRepository {
  constructor(private db: DatabaseSync) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS mental_rotation_results(
        user_id TEXT NOT NULL REFERENCES users(id),result_id TEXT NOT NULL,game TEXT NOT NULL,version INTEGER NOT NULL,
        payload TEXT NOT NULL,score REAL NOT NULL,correct_rt_total_ms INTEGER NOT NULL,
        completed_at TEXT NOT NULL,received_at TEXT NOT NULL,PRIMARY KEY(user_id,result_id));
        CREATE INDEX IF NOT EXISTS mental_rotation_history ON mental_rotation_results(user_id,game,version,completed_at DESC,received_at DESC,result_id DESC);
        CREATE INDEX IF NOT EXISTS mental_rotation_best ON mental_rotation_results(user_id,game,version,score DESC,correct_rt_total_ms,received_at,result_id);
        COMMIT;`);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  find(userId: string, resultId: string) {
    const row = this.db
      .prepare(
        "SELECT payload,received_at FROM mental_rotation_results WHERE user_id=? AND result_id=?",
      )
      .get(userId, resultId) as Row | undefined;
    return row ? { serialized: row.payload, result: toResult(row) } : null;
  }
  saveNew(
    userId: string,
    p: RotationResultInput,
    now: number,
  ): RotationSavedResult {
    const row = {
      payload: JSON.stringify(p),
      received_at: new Date(now).toISOString(),
    };
    this.db
      .prepare("INSERT INTO mental_rotation_results VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        userId,
        p.resultId,
        ROTATION_GAME,
        1,
        row.payload,
        rotationMetrics(p).score,
        p.groups.reduce((sum, g) => sum + g.correctRtTotalMs, 0),
        p.completedAt,
        row.received_at,
      );
    return toResult(row);
  }
  history(userId: string, page: number): RotationHistory {
    const total = this.db
      .prepare(
        "SELECT count(*) AS count FROM mental_rotation_results WHERE user_id=? AND game=? AND version=1",
      )
      .get(userId, ROTATION_GAME)!.count as number;
    const rows = this.db
      .prepare(
        "SELECT payload,received_at FROM mental_rotation_results WHERE user_id=? AND game=? AND version=1 ORDER BY completed_at DESC,received_at DESC,result_id DESC LIMIT 20 OFFSET ?",
      )
      .all(userId, ROTATION_GAME, (page - 1) * 20) as Row[];
    return { items: rows.map(toResult), page, pageSize: 20, total };
  }
  bests(userId: string): RotationSavedResult[] {
    // At equal accuracy in fixed-length sessions, sums compare mean correct times exactly.
    const row = this.db
      .prepare(
        "SELECT payload,received_at FROM mental_rotation_results WHERE user_id=? AND game=? AND version=1 ORDER BY score DESC,correct_rt_total_ms ASC,received_at ASC,result_id ASC LIMIT 1",
      )
      .get(userId, ROTATION_GAME) as Row | undefined;
    return row ? [toResult(row)] : [];
  }
}
