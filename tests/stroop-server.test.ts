import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/server/store.js";
import { buildApp } from "../src/server/app.js";
import {
  databaseFingerprints,
  assertPreserved,
} from "../scripts/release/files.js";

async function fixture(t: { after(fn: () => void | Promise<void>): void }) {
  const root = mkdtempSync(join(tmpdir(), "braingym-stroop-"));
  const path = join(root, "test.sqlite");
  const store = new Store(path);
  let now = Date.parse("2026-11-14T00:00:00.000Z");
  const app = await buildApp({
    store,
    origin: "http://127.0.0.1",
    now: () => now,
  });
  const a = store.createUser("隔离 Stroop A");
  const b = store.createUser("隔离 Stroop B");
  const headers = {
    origin: "http://127.0.0.1",
    cookie: `bg_session=${store.login(a.token, now).session}`,
  };
  const body = (patch: Record<string, unknown> = {}) => ({
    resultId: randomUUID(),
    startedByUserId: a.user.id,
    game: "stroop",
    version: 1,
    completedAt: new Date(now).toISOString(),
    congruent: { correct: 10, wrong: 0, timeout: 0, correctRtTotalMs: 5000 },
    incongruent: { correct: 20, wrong: 5, timeout: 5, correctRtTotalMs: 14000 },
    ...patch,
  });
  const save = (payload: object, h = headers) =>
    app.inject({ method: "POST", url: "/api/results", headers: h, payload });
  const read = (part = "history", h = headers) =>
    app.inject({ url: `/api/${part}?game=stroop`, headers: h });
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
    later: () => (now += 10000),
  };
}

test("Stroop accepts complete summaries and derives accuracy and reaction metrics", async (t) => {
  const f = await fixture(t);
  const result = await f.save({ ...f.body(), score: 999, meanCorrectRtMs: 0 });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().score, 75);
  assert.equal(result.json().meanCorrectRtMs, 19000 / 30);
  assert.equal(result.json().interferenceMs, 200);
  assert.equal((await f.read()).json().total, 1);
});

test("Stroop canonical retries preserve received time and conflict across all three games", async (t) => {
  const f = await fixture(t);
  const p = f.body();
  const first = await f.save(p);
  assert.equal(first.statusCode, 200, first.body);
  f.later();
  const reordered = {
    ...Object.fromEntries(Object.entries(p).reverse()),
    congruent: Object.fromEntries(Object.entries(p.congruent).reverse()),
  };
  assert.deepEqual((await f.save(reordered)).json(), first.json());
  assert.equal(
    (
      await f.save({
        ...p,
        incongruent: { ...p.incongruent, correctRtTotalMs: 15000 },
      })
    ).statusCode,
    409,
  );
  const nback = {
    game: "spatial-n-back",
    version: 1,
    n: 2,
    tp: 15,
    fn: 0,
    fp: 0,
    tn: 15,
    completedAt: p.completedAt,
    startedByUserId: f.a.user.id,
    resultId: p.resultId,
  };
  const corsi = {
    game: "corsi-forward",
    version: 1,
    progressEpoch: 0,
    startLength: 2,
    failedLength: 3,
    firstTrialCorrect: true,
    maxFirstTryLength: 2,
    completedAt: p.completedAt,
    startedByUserId: f.a.user.id,
    resultId: p.resultId,
  };
  for (const other of [nback, corsi]) {
    assert.equal((await f.save(other)).statusCode, 409);
    const id = randomUUID();
    assert.equal((await f.save({ ...other, resultId: id })).statusCode, 200);
    assert.equal((await f.save({ ...p, resultId: id })).statusCode, 409);
  }
});

test("Stroop bests prefer accuracy then unrounded correct time and keep zero-correct history", async (t) => {
  const f = await fixture(t);
  const zero = { correct: 0, wrong: 0, timeout: 10, correctRtTotalMs: 0 };
  const z = f.body({ congruent: zero, incongruent: { ...zero, timeout: 30 } });
  assert.equal((await f.save(z)).statusCode, 200);
  assert.equal((await f.read("bests")).json().items[0].meanCorrectRtMs, null);
  const slow = f.body();
  await f.save(slow);
  f.later();
  const fast = f.body({
    congruent: { ...slow.congruent, correctRtTotalMs: 4999 },
  });
  await f.save(fast);
  assert.equal((await f.read("bests")).json().items[0].resultId, fast.resultId);
  const tie = f.body({ congruent: fast.congruent });
  f.later();
  await f.save(tie);
  assert.equal((await f.read("bests")).json().items[0].resultId, fast.resultId);
  const accurate = f.body({
    incongruent: { correct: 21, wrong: 4, timeout: 5, correctRtTotalMs: 62000 },
  });
  await f.save(accurate);
  assert.equal(
    (await f.read("bests")).json().items[0].resultId,
    accurate.resultId,
  );
  for (let i = 0; i < 19; i++) await f.save(f.body());
  const history = (await f.read()).json();
  assert.equal(history.pageSize, 20);
  assert.equal(history.items.length, 20);
  assert.equal(history.total, 24);
});

test("Stroop rejects invalid summaries and private access, including revoked sessions", async (t) => {
  const f = await fixture(t);
  const p = f.body();
  for (const patch of [
    { congruent: null },
    { incongruent: [] },
    { version: 2 },
    { resultId: "bad" },
    { completedAt: "2026-02-30T00:00:00.000Z" },
    { congruent: { ...p.congruent, correct: "10" } },
    { congruent: { ...p.congruent, correct: -1 } },
    { congruent: { ...p.congruent, correctRtTotalMs: 30001 } },
    { congruent: { ...p.congruent, correctRtTotalMs: 1.5 } },
    { congruent: { correct: 0, wrong: 10, timeout: 0, correctRtTotalMs: 1 } },
    { congruent: { correct: 2, wrong: 0, timeout: 0, correctRtTotalMs: 1000 } },
  ])
    assert.equal(
      (await f.save({ ...p, ...patch })).statusCode,
      400,
      JSON.stringify(patch),
    );
  assert.equal((await f.read()).json().total, 0);
  assert.equal(
    (await f.app.inject({ url: "/api/history?game=stroop" })).statusCode,
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
  assert.equal(
    (await f.save({ ...p, startedByUserId: f.b.user.id }, bHeaders)).statusCode,
    200,
  );
  f.store.rotateToken(f.a.user.id);
  assert.equal((await f.read()).statusCode, 401);
  assert.equal((await f.save(p)).statusCode, 401);
  for (const query of [
    "game=stroop&game=stroop",
    "game=unknown",
    "game=stroop&page=0",
  ]) {
    assert.equal(
      (await f.app.inject({ url: `/api/history?${query}`, headers: bHeaders }))
        .statusCode,
      400,
    );
  }
});

test("Stroop additive schema, legacy reopen and release fingerprints preserve existing data", async (t) => {
  const f = await fixture(t);
  const p = f.body();
  assert.equal((await f.save(p)).statusCode, 200);
  const before = databaseFingerprints(f.path);
  assert.ok(before.stroop_results?.["table-exists"]);
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
      .prepare("UPDATE stroop_results SET payload=? WHERE result_id=?")
      .run("{}", p.resultId);
    assert.throws(() => assertPreserved(before, databaseFingerprints(f.path)));
  } finally {
    old.close();
  }
});

test("Stroop extension rolls back its table if index initialization fails", async (t) => {
  const f = await fixture(t);
  const db = new DatabaseSync(f.path);
  try {
    db.exec("DROP TABLE stroop_results; CREATE TABLE stroop_history(x TEXT)");
    assert.throws(() => new Store(f.path));
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='stroop_results'")
        .get(),
      undefined,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM users").get()!.n, 2);
  } finally {
    db.close();
  }
});
