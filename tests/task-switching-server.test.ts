import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/server/store.js";
import { buildApp } from "../src/server/app.js";
import {
  databaseFingerprints,
  assertPreserved,
} from "../scripts/release/files.js";

async function fixture(t: { after(fn: () => void | Promise<void>): void }) {
  const root = mkdtempSync(join(tmpdir(), "braingym-task-switching-"));
  const path = join(root, "test.sqlite");
  const store = new Store(path);
  let now = Date.parse("2026-11-16T00:00:00.000Z");
  const app = await buildApp({
    store,
    origin: "http://127.0.0.1",
    now: () => now,
  });
  const a = store.createUser("隔离规则切换 A");
  const b = store.createUser("隔离规则切换 B");
  const headers = {
    origin: "http://127.0.0.1",
    cookie: `bg_session=${store.login(a.token, now).session}`,
  };
  const body = (patch: Record<string, unknown> = {}) => ({
    resultId: randomUUID(),
    startedByUserId: a.user.id,
    game: "task-switching",
    version: 1,
    completedAt: new Date(now).toISOString(),
    repeat: { correct: 10, wrong: 5, timeout: 5, correctRtTotalMs: 6000 },
    switch: { correct: 20, wrong: 0, timeout: 0, correctRtTotalMs: 14000 },
    ...patch,
  });
  const save = (payload: object, h = headers) =>
    app.inject({ method: "POST", url: "/api/results", headers: h, payload });
  const read = (part = "history", h = headers) =>
    app.inject({ url: `/api/${part}?game=task-switching`, headers: h });
  t.after(async () => {
    await app.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    store,
    app,
    a,
    b,
    headers,
    body,
    save,
    read,
    path,
    later: (ms = 10000) => (now += ms),
  };
}

test("规则切换保存完整摘要并由服务端复算指标", async (t) => {
  const f = await fixture(t);
  const result = await f.save({ ...f.body(), score: 999, meanCorrectRtMs: 0 });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().score, 75);
  assert.equal(result.json().meanCorrectRtMs, 20000 / 30);
  assert.equal(result.json().switchCostMs, 100);
  assert.equal((await f.read()).json().total, 1);
});

test("规范化重试保留首次时间，五张成绩表双向拒绝 ID 内容冲突", async (t) => {
  const f = await fixture(t),
    p = f.body();
  const first = await f.save(p);
  f.later();
  assert.deepEqual(
    (
      await f.save({
        ...Object.fromEntries(Object.entries(p).reverse()),
        repeat: Object.fromEntries(Object.entries(p.repeat).reverse()),
      })
    ).json(),
    first.json(),
  );
  assert.equal(
    (await f.save({ ...p, repeat: { ...p.repeat, correctRtTotalMs: 6001 } }))
      .statusCode,
    409,
  );
  const common = {
    version: 1,
    completedAt: p.completedAt,
    startedByUserId: f.a.user.id,
    resultId: p.resultId,
  };
  for (const other of [
    { ...common, game: "spatial-n-back", n: 2, tp: 15, fn: 0, fp: 0, tn: 15 },
    {
      ...common,
      game: "corsi-forward",
      progressEpoch: 0,
      startLength: 2,
      failedLength: 3,
      firstTrialCorrect: true,
      maxFirstTryLength: 2,
    },
    {
      ...common,
      game: "stroop",
      congruent: { correct: 10, wrong: 0, timeout: 0, correctRtTotalMs: 1000 },
      incongruent: {
        correct: 30,
        wrong: 0,
        timeout: 0,
        correctRtTotalMs: 3000,
      },
    },
    {
      ...common,
      game: "mental-rotation",
      groups: ["simple", "complex"].flatMap((complexity) =>
        [45, 90, 135, 180].flatMap((angle) =>
          ["rotation", "mirror"].map((relation) => ({
            complexity,
            angle,
            relation,
            correct: 2,
            wrong: 0,
            correctRtTotalMs: 2000,
          })),
        ),
      ),
    },
  ]) {
    assert.equal((await f.save(other)).statusCode, 409);
    const id = randomUUID();
    assert.equal((await f.save({ ...other, resultId: id })).statusCode, 200);
    assert.equal((await f.save({ ...p, resultId: id })).statusCode, 409);
  }
});

test("最佳按准确率、未舍入耗时及稳定次序，历史稳定分页", async (t) => {
  const f = await fixture(t);
  const zero = { correct: 0, wrong: 0, timeout: 20, correctRtTotalMs: 0 };
  await f.save(f.body({ repeat: zero, switch: zero }));
  assert.equal((await f.read("bests")).json().items[0].meanCorrectRtMs, null);
  const slow = f.body();
  await f.save(slow);
  f.later();
  const fast = f.body({ repeat: { ...slow.repeat, correctRtTotalMs: 5999 } });
  await f.save(fast);
  const tie = f.body({ repeat: fast.repeat });
  f.later();
  await f.save(tie);
  assert.equal((await f.read("bests")).json().items[0].resultId, fast.resultId);
  const accurate = f.body({
    repeat: { correct: 11, wrong: 4, timeout: 5, correctRtTotalMs: 32000 },
  });
  await f.save(accurate);
  assert.equal(
    (await f.read("bests")).json().items[0].resultId,
    accurate.resultId,
  );
  for (let i = 0; i < 19; i++) await f.save(f.body());
  const history = (await f.read()).json();
  assert.equal(history.total, 24);
  assert.equal(history.items.length, 20);
  assert.equal(history.pageSize, 20);
  assert.equal(
    (
      await f.app.inject({
        url: "/api/history?game=task-switching&page=2",
        headers: f.headers,
      })
    ).json().items.length,
    4,
  );
});

test("摘要、类型、请求大小、Origin 和匿名／跨账号／过期／撤销边界", async (t) => {
  const f = await fixture(t),
    p = f.body();
  for (const patch of [
    { repeat: null },
    { switch: [] },
    { version: 2 },
    { resultId: "bad" },
    { completedAt: "2026-02-30T00:00:00.000Z" },
    { repeat: { ...p.repeat, correct: "10" } },
    { repeat: { ...p.repeat, correct: -1 } },
    { repeat: { ...p.repeat, correctRtTotalMs: 30001 } },
    { repeat: { ...p.repeat, correctRtTotalMs: 1.5 } },
    { repeat: { correct: 0, wrong: 20, timeout: 0, correctRtTotalMs: 1 } },
    { repeat: { correct: 4, wrong: 0, timeout: 0, correctRtTotalMs: 1000 } },
    { repeat: { ...p.repeat, timeout: Number.MAX_SAFE_INTEGER + 1 } },
  ])
    assert.equal(
      (await f.save({ ...p, ...patch })).statusCode,
      400,
      JSON.stringify(patch),
    );
  assert.equal((await f.read()).json().total, 0);
  assert.equal(
    (await f.read("history", { ...f.headers, cookie: "" })).statusCode,
    401,
  );
  assert.equal((await f.save(p, { ...f.headers, cookie: "" })).statusCode, 401);
  assert.equal(
    (await f.save(p, { ...f.headers, origin: "http://other.example" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await f.save({ ...p, padding: "x".repeat(9000) })).statusCode,
    413,
  );
  const bHeaders = {
    ...f.headers,
    cookie: `bg_session=${f.store.login(f.b.token, Date.parse(p.completedAt)).session}`,
  };
  assert.equal((await f.save(p, bHeaders)).statusCode, 409);
  await f.save(p);
  assert.equal((await f.read("history", bHeaders)).json().total, 0);
  assert.equal((await f.read("bests", bHeaders)).json().items.length, 0);
  assert.equal(
    (await f.save({ ...p, startedByUserId: f.b.user.id }, bHeaders)).statusCode,
    200,
  );
  for (const q of [
    "game=task-switching&game=task-switching",
    "game=unknown",
    "game=task-switching&page=0",
  ])
    assert.equal(
      (await f.app.inject({ url: `/api/history?${q}`, headers: bHeaders }))
        .statusCode,
      400,
    );
  f.store.rotateToken(f.a.user.id);
  assert.equal((await f.read()).statusCode, 401);
  assert.equal((await f.save(p)).statusCode, 401);
  f.store.revokeToken(f.b.user.id);
  assert.equal((await f.read("history", bHeaders)).statusCode, 401);
});

test("过期会话拒绝私人读取及保存", async (t) => {
  const f = await fixture(t),
    p = f.body();
  f.later(8 * 24 * 60 * 60 * 1000);
  assert.equal((await f.read()).statusCode, 401);
  assert.equal((await f.save(p)).statusCode, 401);
});

test("附加表及数据指纹保护旧库、空表和行，失败初始化回滚", async (t) => {
  const f = await fixture(t);
  const empty = databaseFingerprints(f.path);
  assert.equal(empty.task_switching_results["table-exists"], "1");
  const db = new DatabaseSync(f.path);
  try {
    db.exec("DROP TABLE task_switching_results");
    assert.throws(() => assertPreserved(empty, databaseFingerprints(f.path)));
    const legacy = databaseFingerprints(f.path);
    const again = new Store(f.path);
    again.close();
    assertPreserved(legacy, databaseFingerprints(f.path));
    const p = f.body();
    await f.save(p);
    const before = databaseFingerprints(f.path);
    const reopened = new Store(f.path);
    reopened.close();
    assertPreserved(before, databaseFingerprints(f.path));
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 1);
    db.prepare(
      "UPDATE task_switching_results SET payload=? WHERE result_id=?",
    ).run("{}", p.resultId);
    assert.throws(() => assertPreserved(before, databaseFingerprints(f.path)));
    db.exec("DELETE FROM task_switching_results");
    assert.throws(() => assertPreserved(before, databaseFingerprints(f.path)));
    db.exec(
      "DROP TABLE task_switching_results; CREATE TABLE task_switching_history(x TEXT)",
    );
    assert.throws(() => new Store(f.path));
    assert.equal(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='task_switching_results'",
        )
        .get(),
      undefined,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM users").get()!.n, 2);
  } finally {
    db.close();
  }
});

test("规则切换 additive schema, legacy reopen and release fingerprints preserve existing data", async (t) => {
  const f = await fixture(t);
  const p = f.body();
  assert.equal((await f.save(p)).statusCode, 200);
  const before = databaseFingerprints(f.path);
  assert.ok(before.task_switching_results?.["table-exists"]);
  const again = new Store(f.path);
  again.close();
  assertPreserved(before, databaseFingerprints(f.path));
  const legacyRoot = join(dirname(f.path), "legacy");
  for (const file of [
    "src/server/store.ts",
    "src/server/errors.ts",
    "src/server/corsi-store.ts",
    "src/shared/contracts.ts",
    "src/shared/rules.ts",
    "src/shared/corsi.ts",
  ]) {
    const target = join(legacyRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      execFileSync("git", ["show", `9af5b58:${file}`], {
        encoding: "utf8",
        windowsHide: true,
      }),
    );
  }
  writeFileSync(
    join(legacyRoot, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  const script = `import {Store} from ${JSON.stringify(pathToFileURL(join(legacyRoot, "src/server/store.ts")).href)};const s=new Store(${JSON.stringify(f.path)});if(s.listUsers().length!==2)throw new Error('users missing');s.close();`;
  execFileSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
      "--input-type=module",
      "-e",
      script,
    ],
    { windowsHide: true, stdio: "pipe" },
  );
  const upgraded = new Store(f.path);
  upgraded.close();
  assertPreserved(before, databaseFingerprints(f.path));
  const old = new DatabaseSync(f.path);
  try {
    assert.equal(old.prepare("PRAGMA user_version").get()!.user_version, 1);
    assert.equal(old.prepare("SELECT count(*) AS n FROM users").get()!.n, 2);
    old
      .prepare("UPDATE task_switching_results SET payload=? WHERE result_id=?")
      .run("{}", p.resultId);
    assert.throws(() => assertPreserved(before, databaseFingerprints(f.path)));
  } finally {
    old.close();
  }
});
