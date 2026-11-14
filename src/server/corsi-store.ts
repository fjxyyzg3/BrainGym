import type { DatabaseSync } from "node:sqlite";
import {
  CORSI_GAME_IDS,
  isCorsiGameId,
  type CorsiResultInput,
  type CorsiSavedResult,
  type CorsiGameId,
  type CorsiHistory,
  type CorsiProgressItem,
} from "../shared/contracts.js";
import {
  validateCorsiSummary,
  corsiScore,
  nextCorsiStart,
  validCorsiTime,
} from "../shared/corsi.js";
import { AppError } from "./errors.js";

type Row = { payload: string; score: number; received_at: string };
export function parseCorsiResult(value: unknown): CorsiResultInput {
  const p = value as CorsiResultInput;
  try {
    validateCorsiSummary(value);
    const id = /^[a-f0-9-]{36}$/i;
    if (
      !isCorsiGameId(p.game) ||
      p.version !== 1 ||
      typeof p.resultId !== "string" ||
      !id.test(p.resultId) ||
      typeof p.startedByUserId !== "string" ||
      !id.test(p.startedByUserId) ||
      !Number.isSafeInteger(p.progressEpoch) ||
      p.progressEpoch < 0 ||
      typeof p.completedAt !== "string" ||
      !validCorsiTime(p.completedAt, Infinity)
    )
      throw new Error();
  } catch {
    throw new AppError(400, "INVALID_RESULT", "顺序记忆对局数据无效");
  }
  return {
    resultId: p.resultId,
    startedByUserId: p.startedByUserId,
    game: p.game,
    version: 1,
    progressEpoch: p.progressEpoch,
    startLength: p.startLength,
    failedLength: p.failedLength,
    firstTrialCorrect: p.firstTrialCorrect,
    maxFirstTryLength: p.maxFirstTryLength,
    completedAt: p.completedAt,
  };
}
function toResult(row: Row): CorsiSavedResult {
  const payload = JSON.parse(row.payload) as CorsiResultInput;
  return {
    ...payload,
    score: row.score,
    nextStartLength: nextCorsiStart(payload),
    receivedAt: row.received_at,
    timeAnomaly: !validCorsiTime(
      payload.completedAt,
      Date.parse(row.received_at),
    ),
  };
}
export class CorsiRepository {
  constructor(private db: DatabaseSync) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS corsi_results(
        user_id TEXT NOT NULL REFERENCES users(id),result_id TEXT NOT NULL,
        game TEXT NOT NULL,version INTEGER NOT NULL,epoch INTEGER NOT NULL CHECK(epoch>=0),
        payload TEXT NOT NULL,score INTEGER NOT NULL,completed_at TEXT NOT NULL,received_at TEXT NOT NULL,
        PRIMARY KEY(user_id,result_id));
      CREATE INDEX IF NOT EXISTS corsi_history ON corsi_results(user_id,game,version,completed_at DESC,received_at DESC,result_id DESC);
      CREATE INDEX IF NOT EXISTS corsi_latest ON corsi_results(user_id,game,version,epoch,completed_at DESC,received_at DESC,result_id DESC);
      CREATE INDEX IF NOT EXISTS corsi_best ON corsi_results(user_id,game,version,score DESC,received_at,result_id);
      CREATE TABLE IF NOT EXISTS corsi_progress_resets(
        user_id TEXT NOT NULL REFERENCES users(id),game TEXT NOT NULL,version INTEGER NOT NULL,
        epoch INTEGER NOT NULL CHECK(epoch>=0),reset_at TEXT NOT NULL,
        PRIMARY KEY(user_id,game,version));
      COMMIT;`);
  }
  epoch(userId: string, game: CorsiGameId): number {
    return (
      (this.db
        .prepare(
          "SELECT epoch FROM corsi_progress_resets WHERE user_id=? AND game=? AND version=1",
        )
        .get(userId, game)?.epoch as number | undefined) ?? 0
    );
  }
  find(
    userId: string,
    resultId: string,
  ): { serialized: string; result: CorsiSavedResult } | null {
    const row = this.db
      .prepare(
        "SELECT payload,score,received_at FROM corsi_results WHERE user_id=? AND result_id=?",
      )
      .get(userId, resultId) as Row | undefined;
    return row ? { serialized: row.payload, result: toResult(row) } : null;
  }
  saveNew(userId: string, p: CorsiResultInput, now: number): CorsiSavedResult {
    if (p.progressEpoch > this.epoch(userId, p.game))
      throw new AppError(
        409,
        "PROGRESS_CHANGED",
        "进度世代无效，请重新读取起点",
      );
    if (!validCorsiTime(p.completedAt, now))
      throw new AppError(
        400,
        "INVALID_COMPLETION_TIME",
        "完成时间异常，成绩未保存，起点未改变",
      );
    const row = {
      payload: JSON.stringify(p),
      score: corsiScore(p),
      received_at: new Date(now).toISOString(),
    };
    this.db
      .prepare("INSERT INTO corsi_results VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        userId,
        p.resultId,
        p.game,
        1,
        p.progressEpoch,
        row.payload,
        row.score,
        p.completedAt,
        row.received_at,
      );
    return toResult(row);
  }
  history(userId: string, page: number, game: CorsiGameId): CorsiHistory {
    const total = this.db
      .prepare(
        "SELECT count(*) AS count FROM corsi_results WHERE user_id=? AND game=? AND version=1",
      )
      .get(userId, game)!.count as number;
    const rows = this.db
      .prepare(
        "SELECT payload,score,received_at FROM corsi_results WHERE user_id=? AND game=? AND version=1 ORDER BY completed_at DESC,received_at DESC,result_id DESC LIMIT 20 OFFSET ?",
      )
      .all(userId, game, (page - 1) * 20) as Row[];
    return { items: rows.map(toResult), page, total, pageSize: 20 };
  }
  bests(userId: string, game: CorsiGameId): CorsiSavedResult[] {
    const row = this.db
      .prepare(
        "SELECT payload,score,received_at FROM corsi_results WHERE user_id=? AND game=? AND version=1 AND score>0 ORDER BY score DESC,received_at ASC,result_id ASC LIMIT 1",
      )
      .get(userId, game) as Row | undefined;
    return row ? [toResult(row)] : [];
  }
  progress(userId: string): CorsiProgressItem[] {
    return CORSI_GAME_IDS.map((game) => {
      const epoch = this.epoch(userId, game);
      // Compare against immutable first receipt, never today's wall clock.
      // Canonical four-digit UTC strings are validated at ingestion.
      const rows = this.db
        .prepare(
          "SELECT payload,score,received_at FROM corsi_results WHERE user_id=? AND game=? AND version=1 AND epoch=? ORDER BY completed_at DESC,received_at DESC,result_id DESC",
        )
        .iterate(userId, game, epoch);
      let latest: CorsiSavedResult | undefined;
      for (const row of rows) {
        const result = toResult(row as Row);
        if (!result.timeAnomaly) {
          latest = result;
          break;
        }
      }
      return {
        game,
        progressEpoch: epoch,
        nextStartLength: latest?.nextStartLength ?? 2,
        bestSpan: this.bests(userId, game)[0]?.score ?? null,
      };
    });
  }
  reset(
    userId: string,
    game: CorsiGameId,
    expected: number,
    now: number,
  ): void {
    const current = this.epoch(userId, game);
    if (expected !== current || !Number.isSafeInteger(current + 1))
      throw new AppError(
        409,
        "PROGRESS_CHANGED",
        "进度已变化，请重新读取并确认恢复",
      );
    this.db
      .prepare(
        `INSERT INTO corsi_progress_resets VALUES(?,?,1,?,?)
      ON CONFLICT(user_id,game,version) DO UPDATE SET epoch=excluded.epoch,reset_at=excluded.reset_at`,
      )
      .run(userId, game, current + 1, new Date(now).toISOString());
  }
}
