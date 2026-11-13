import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  GAME,
  isGameId,
  VERSION,
  type User,
  type ResultInput,
  type SavedResult,
  type History,
  type GameId,
} from "../shared/contracts.js";
import { assertLevel, validateCounts, scoreResult } from "../shared/rules.js";
import { AppError } from "./errors.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
type ResultRow = { payload: string; score: number; received_at: string };
const toResult = (row: ResultRow): SavedResult => ({
  ...JSON.parse(row.payload),
  score: row.score,
  receivedAt: row.received_at,
});
export function parseResult(value: unknown): ResultInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(400, "INVALID_RESULT", "无效的对局数据");
  const p = value as ResultInput;
  const id = /^[a-f0-9-]{36}$/i;
  if (
    typeof p.resultId !== "string" ||
    !id.test(p.resultId) ||
    typeof p.startedByUserId !== "string" ||
    !id.test(p.startedByUserId) ||
    !isGameId(p.game) ||
    p.version !== VERSION
  )
    throw new AppError(400, "INVALID_RESULT", "对局标识或规则无效");
  try {
    assertLevel(p.n);
    if (p.game === GAME) validateCounts(p);
    else {
      validateCounts(p.position);
      validateCounts(p.color);
    }
  } catch {
    throw new AppError(400, "INVALID_RESULT", "难度或统计无效");
  }
  if (
    typeof p.completedAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.completedAt) ||
    !Number.isFinite(Date.parse(p.completedAt)) ||
    new Date(p.completedAt).toISOString() !== p.completedAt
  )
    throw new AppError(400, "INVALID_RESULT", "完成时间必须为有效 UTC 时间");
  return {
    resultId: p.resultId,
    startedByUserId: p.startedByUserId,
    game: p.game,
    version: VERSION,
    n: p.n,
    ...(p.game === GAME
      ? { tp: p.tp, fn: p.fn, fp: p.fp, tn: p.tn }
      : {
          position: {
            tp: p.position.tp,
            fn: p.position.fn,
            fp: p.position.fp,
            tn: p.position.tn,
          },
          color: {
            tp: p.color.tp,
            fn: p.color.fn,
            fp: p.color.fp,
            tn: p.color.tn,
          },
        }),
    completedAt: p.completedAt,
  } as ResultInput;
}
export class Store {
  private db: DatabaseSync;
  private closed = false;
  private busyTimeout: number;
  constructor(path: string, options: { busyTimeoutMs?: number } = {}) {
    this.busyTimeout = options.busyTimeoutMs ?? 5000;
    if (
      !Number.isInteger(this.busyTimeout) ||
      this.busyTimeout < 1 ||
      this.busyTimeout > 5000
    )
      throw new Error("Invalid SQLite busy timeout");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=${this.busyTimeout};`,
    );
    const version = this.db.prepare("PRAGMA user_version").get()!
      .user_version as number;
    if (version > 1) {
      this.db.close();
      throw new Error("数据库版本高于当前应用，请勿降级运行");
    }
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials(user_id TEXT PRIMARY KEY REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS results(user_id TEXT NOT NULL REFERENCES users(id),result_id TEXT NOT NULL,game TEXT NOT NULL,version INTEGER NOT NULL,n INTEGER NOT NULL CHECK(n BETWEEN 1 AND 5),payload TEXT NOT NULL,score REAL NOT NULL,completed_at TEXT NOT NULL,received_at TEXT NOT NULL,PRIMARY KEY(user_id,result_id));
      CREATE INDEX IF NOT EXISTS results_history ON results(user_id,completed_at DESC,received_at DESC,result_id);
      CREATE INDEX IF NOT EXISTS results_best ON results(user_id,game,version,n,score DESC);
      PRAGMA user_version=1; COMMIT;`);
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private requireUser(id: string): User {
    const user = this.db
      .prepare("SELECT id,name FROM users WHERE id=?")
      .get(id) as unknown as User | undefined;
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "用户不存在");
    return user;
  }
  createUser(name: string): { user: User; token: string } {
    if (!name.trim() || name.length > 80)
      throw new AppError(400, "INVALID_NAME", "用户名称须为 1～80 个字符");
    const user = { id: randomUUID(), name: name.trim() },
      token = secret();
    this.transaction(() => {
      this.db.prepare("INSERT INTO users VALUES(?,?)").run(user.id, user.name);
      this.db
        .prepare("INSERT INTO credentials VALUES(?,?)")
        .run(user.id, digest(token));
    });
    return { user, token };
  }
  listUsers(): User[] {
    return this.db
      .prepare("SELECT id,name FROM users ORDER BY name,id")
      .all() as unknown as User[];
  }
  issueToken(userId: string): string {
    this.requireUser(userId);
    if (
      this.db.prepare("SELECT 1 FROM credentials WHERE user_id=?").get(userId)
    )
      throw new AppError(
        409,
        "TOKEN_EXISTS",
        "已有有效 Token，请使用 token:rotate 换发",
      );
    return this.rotateToken(userId);
  }
  rotateToken(userId: string): string {
    this.requireUser(userId);
    const token = secret();
    this.transaction(() => {
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
      this.db
        .prepare(
          "INSERT INTO credentials VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash",
        )
        .run(userId, digest(token));
    });
    return token;
  }
  revokeToken(userId: string): void {
    this.requireUser(userId);
    this.transaction(() => {
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
      this.db.prepare("DELETE FROM credentials WHERE user_id=?").run(userId);
    });
  }
  login(token: string, now: number): { user: User; session: string } {
    const user = this.db
      .prepare(
        "SELECT u.id,u.name FROM users u JOIN credentials c ON c.user_id=u.id WHERE c.token_hash=?",
      )
      .get(digest(token)) as unknown as User | undefined;
    if (!user) throw new AppError(401, "INVALID_TOKEN", "Token 无效或已被吊销");
    const session = secret();
    this.db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(digest(session), user.id, now + 7 * 24 * 60 * 60 * 1000);
    return { user, session };
  }
  userForSession(session: string | undefined, now: number): User {
    const user = session
      ? (this.db
          .prepare(
            "SELECT u.id,u.name FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
          )
          .get(digest(session), now) as unknown as User | undefined)
      : undefined;
    if (!user) throw new AppError(401, "LOGIN_REQUIRED", "请重新登录");
    return user;
  }
  logout(session: string | undefined): void {
    if (session)
      this.db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(digest(session));
  }
  save(user: User, payload: ResultInput, now: number): SavedResult {
    if (payload.startedByUserId !== user.id)
      throw new AppError(
        409,
        "IDENTITY_CONFLICT",
        "当前账户与开局账户不同，请重新登录开局账户后重试",
      );
    return this.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT payload,score,received_at FROM results WHERE user_id=? AND result_id=?",
        )
        .get(user.id, payload.resultId) as unknown as ResultRow | undefined;
      const serialized = JSON.stringify(payload);
      if (row) {
        if (row.payload !== serialized)
          throw new AppError(
            409,
            "RESULT_CONFLICT",
            "该对局已有不同的保存内容",
          );
        return toResult(row);
      }
      const receivedAt = new Date(now).toISOString();
      const computed = scoreResult(payload);
      this.db
        .prepare("INSERT INTO results VALUES(?,?,?,?,?,?,?,?,?)")
        .run(
          user.id,
          payload.resultId,
          payload.game,
          payload.version,
          payload.n,
          serialized,
          computed,
          payload.completedAt,
          receivedAt,
        );
      return { ...payload, score: computed, receivedAt };
    });
  }
  history(userId: string, page: number, game: GameId = GAME): History {
    const total = this.db
      .prepare(
        "SELECT count(*) AS count FROM results WHERE user_id=? AND game=? AND version=?",
      )
      .get(userId, game, VERSION)!.count as number;
    const rows = this.db
      .prepare(
        "SELECT payload,score,received_at FROM results WHERE user_id=? AND game=? AND version=? ORDER BY completed_at DESC,received_at DESC,result_id DESC LIMIT 20 OFFSET ?",
      )
      .all(userId, game, VERSION, (page - 1) * 20) as unknown as ResultRow[];
    return { items: rows.map(toResult), total, page, pageSize: 20 };
  }
  bests(userId: string, game: GameId = GAME): SavedResult[] {
    return (
      this.db
        .prepare(
          `SELECT payload,score,received_at FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY n ORDER BY score DESC,received_at ASC,result_id ASC) AS rn FROM results WHERE user_id=? AND game=? AND version=?) WHERE rn=1 ORDER BY n`,
        )
        .all(userId, game, VERSION) as unknown as ResultRow[]
    ).map(toResult);
  }
  assertAvailable(): void {
    if (this.closed) throw new Error("Storage is closed");
    this.db.exec("PRAGMA busy_timeout=250");
    try {
      this.db.prepare("SELECT id FROM users LIMIT 1").get();
      this.db.exec("BEGIN IMMEDIATE; ROLLBACK;");
    } finally {
      this.db.exec(`PRAGMA busy_timeout=${this.busyTimeout}`);
    }
  }
  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}
