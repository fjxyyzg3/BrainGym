import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  databaseFingerprints,
  assertPreserved,
} from "../scripts/release/files.js";
import { Store } from "../src/server/store.js";
import { buildApp } from "../src/server/app.js";

test("accepts complete mental rotation summaries and derives metrics", async (t) => {
  const store = new Store(":memory:");
  const now = Date.parse("2026-11-16T00:00:00.000Z");
  const app = await buildApp({
    store,
    origin: "http://127.0.0.1",
    now: () => now,
  });
  t.after(async () => {
    await app.close();
    store.close();
  });
  const account = store.createUser("隔离心理旋转用户");
  const response = await app.inject({
    method: "POST",
    url: "/api/results",
    headers: {
      origin: "http://127.0.0.1",
      cookie: `bg_session=${store.login(account.token, now).session}`,
    },
    payload: {
      resultId: randomUUID(),
      startedByUserId: account.user.id,
      game: "mental-rotation",
      version: 1,
      completedAt: new Date(now).toISOString(),
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
      score: 999,
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().score, 100);
  assert.equal(response.json().meanCorrectRtMs, 1000);
});

async function fixture(t: { after(fn: () => void | Promise<void>): void }) {
  const root = mkdtempSync(join(tmpdir(), "braingym-rotation-")),
    path = join(root, "test.sqlite");
  const store = new Store(path);
  let now = Date.parse("2026-11-16T00:00:00.000Z");
  const app = await buildApp({
    store,
    origin: "http://127.0.0.1",
    now: () => now,
  });
  const a = store.createUser("隔离心理旋转 A"),
    b = store.createUser("隔离心理旋转 B");
  const headers = {
    origin: "http://127.0.0.1",
    cookie: `bg_session=${store.login(a.token, now).session}`,
  };
  const bHeaders = {
    ...headers,
    cookie: `bg_session=${store.login(b.token, now).session}`,
  };
  const body = (patch: Record<string, unknown> = {}) => ({
    resultId: randomUUID(),
    startedByUserId: a.user.id,
    game: "mental-rotation",
    version: 1,
    completedAt: new Date(now).toISOString(),
    groups: ["simple", "complex"].flatMap((complexity) =>
      [45, 90, 135, 180].flatMap((angle) =>
        ["rotation", "mirror"].map((relation) => ({
          complexity,
          angle,
          relation,
          correct: 1,
          wrong: 1,
          correctRtTotalMs: 1000,
        })),
      ),
    ),
    ...patch,
  });
  const save = (payload: object, h = headers) =>
    app.inject({ method: "POST", url: "/api/results", headers: h, payload });
  const read = (part = "history", h = headers) =>
    app.inject({ url: `/api/${part}?game=mental-rotation`, headers: h });
  t.after(async () => {
    await app.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    path,
    store,
    app,
    a,
    b,
    headers,
    bHeaders,
    body,
    save,
    read,
    advance: (ms = 10000) => (now += ms),
  };
}
test("rotation canonical retries preserve timestamps and conflict with all three existing result families", async (t) => {
  const f = await fixture(t),
    p = f.body();
  const first = await f.save(p);
  assert.equal(first.statusCode, 200, first.body);
  f.advance();
  const reordered = {
    ...Object.fromEntries(Object.entries(p).reverse()),
    groups: [...p.groups]
      .reverse()
      .map((g) => Object.fromEntries(Object.entries(g).reverse())),
  };
  assert.deepEqual((await f.save(reordered)).json(), first.json());
  const changed = structuredClone(p);
  changed.groups[0].correctRtTotalMs++;
  assert.equal((await f.save(changed)).statusCode, 409);
  for (const other of [
    { game: "spatial-n-back", version: 1, n: 2, tp: 15, fn: 0, fp: 0, tn: 15 },
    {
      game: "corsi-forward",
      version: 1,
      progressEpoch: 0,
      startLength: 2,
      failedLength: 3,
      firstTrialCorrect: true,
      maxFirstTryLength: 2,
    },
    {
      game: "stroop",
      version: 1,
      congruent: { correct: 10, wrong: 0, timeout: 0, correctRtTotalMs: 1000 },
      incongruent: {
        correct: 30,
        wrong: 0,
        timeout: 0,
        correctRtTotalMs: 3000,
      },
    },
  ]) {
    const old = {
      ...other,
      resultId: p.resultId,
      startedByUserId: f.a.user.id,
      completedAt: p.completedAt,
    };
    assert.equal((await f.save(old)).statusCode, 409);
    const resultId = randomUUID();
    assert.equal((await f.save({ ...old, resultId })).statusCode, 200);
    assert.equal((await f.save({ ...p, resultId })).statusCode, 409);
  }
  assert.equal((await f.read()).json().total, 1);
  assert.equal(
    (await f.app.inject({ url: "/api/history", headers: f.headers })).json()
      .total,
    1,
  );
});
test("rotation best accuracy, unrounded time, zero correct and pagination are stable", async (t) => {
  const f = await fixture(t),
    zero = f.body();
  for (const g of zero.groups) {
    g.correct = 0;
    g.wrong = 2;
    g.correctRtTotalMs = 0;
  }
  assert.equal((await f.save(zero)).statusCode, 200);
  assert.equal((await f.read("bests")).json().items[0].meanCorrectRtMs, null);
  const slow = f.body();
  await f.save(slow);
  f.advance();
  const fast = f.body();
  fast.groups[0].correctRtTotalMs = 999;
  await f.save(fast);
  assert.equal((await f.read("bests")).json().items[0].resultId, fast.resultId);
  const accurate = f.body();
  accurate.groups[0] = {
    ...accurate.groups[0],
    correct: 2,
    wrong: 0,
    correctRtTotalMs: 100000,
  };
  await f.save(accurate);
  f.advance();
  const tie = f.body({ groups: accurate.groups });
  await f.save(tie);
  assert.equal(
    (await f.read("bests")).json().items[0].resultId,
    accurate.resultId,
  );
  for (let i = 0; i < 18; i++) {
    f.advance();
    await f.save(f.body());
  }
  const h = (await f.read()).json();
  assert.equal(h.total, 23);
  assert.equal(h.pageSize, 20);
  assert.equal(h.items.length, 20);
  assert.equal(
    (
      await f.app.inject({
        url: "/api/history?game=mental-rotation&page=2",
        headers: f.headers,
      })
    ).json().items.length,
    3,
  );
  const all = f.body();
  for (const g of all.groups) {
    g.correct = 2;
    g.wrong = 0;
    g.correctRtTotalMs = 0;
  }
  await f.save(all);
  const best = (await f.read("bests")).json().items[0];
  assert.equal(best.score, 100);
  assert.equal(best.meanCorrectRtMs, 0);
});
test("rotation validates complete bounded summaries and ignores client supplied metrics", async (t) => {
  const f = await fixture(t),
    p = f.body();
  for (const patch of [
    { groups: null },
    { groups: [] },
    { groups: p.groups.slice(1) },
    { groups: [...p.groups.slice(0, 15), p.groups[0]] },
    { groups: p.groups.map((g, i) => (i ? g : { ...g, angle: 0 })) },
    { groups: p.groups.map((g, i) => (i ? g : { ...g, complexity: "other" })) },
    { groups: p.groups.map((g, i) => (i ? g : { ...g, relation: "other" })) },
    ...["1", -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((value) => ({
      groups: p.groups.map((g, i) =>
        i ? g : { ...g, correctRtTotalMs: value },
      ),
    })),
    {
      groups: p.groups.map((g, i) =>
        i ? g : { ...g, correct: 0, wrong: 2, correctRtTotalMs: 1 },
      ),
    },
    {
      groups: p.groups.map((g, i) => ({
        ...g,
        correctRtTotalMs: i < 2 ? Number.MAX_SAFE_INTEGER : 0,
      })),
    },
    {
      groups: p.groups.map((g) => ({
        ...g,
        correct: 0,
        wrong: 1,
        correctRtTotalMs: 0,
      })),
    },
    { version: 2 },
    { resultId: "bad" },
    { startedByUserId: "bad" },
    { completedAt: "2026-02-30T00:00:00.000Z" },
  ]) {
    const r = await f.save({ ...p, ...patch });
    assert.equal(r.statusCode, 400, r.body);
  }
  assert.equal((await f.read()).json().total, 0);
  const long = structuredClone(p);
  long.groups[0].correctRtTotalMs = 7200000;
  const saved = await f.save({ ...long, score: 999, meanCorrectRtMs: 0 });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().score, 50);
  assert.equal(saved.json().meanCorrectRtMs, 7215000 / 16);
  assert.ok(Buffer.byteLength(JSON.stringify(long)) < 8192);
  assert.equal(
    (await f.save({ ...p, padding: "x".repeat(9000) })).statusCode,
    413,
  );
  for (const query of [
    "game=mental-rotation&game=mental-rotation",
    "game=unknown",
    "game=mental-rotation&page=0",
  ])
    assert.equal(
      (await f.app.inject({ url: `/api/history?${query}`, headers: f.headers }))
        .statusCode,
      400,
    );
});
test("rotation private access rejects anonymous, foreign, expired and revoked sessions", async (t) => {
  const f = await fixture(t),
    p = f.body();
  assert.equal(
    (await f.app.inject({ url: "/api/history?game=mental-rotation" }))
      .statusCode,
    401,
  );
  assert.equal((await f.save(p, { ...f.headers, cookie: "" })).statusCode, 401);
  assert.equal(
    (await f.save(p, { ...f.headers, origin: "http://other.example" }))
      .statusCode,
    403,
  );
  assert.equal((await f.save(p, f.bHeaders)).statusCode, 409);
  await f.save(p);
  assert.equal((await f.read("history", f.bHeaders)).json().total, 0);
  assert.equal((await f.read("bests", f.bHeaders)).json().items.length, 0);
  assert.equal(
    (await f.save({ ...p, startedByUserId: f.b.user.id }, f.bHeaders))
      .statusCode,
    200,
  );
  f.store.rotateToken(f.a.user.id);
  assert.equal((await f.read()).statusCode, 401);
  assert.equal((await f.save(p)).statusCode, 401);
  f.advance(8 * 24 * 3600000);
  assert.equal((await f.read("bests", f.bHeaders)).statusCode, 401);
  const renewed = {
    ...f.bHeaders,
    cookie: `bg_session=${f.store.login(f.b.token, f.advance(0)).session}`,
  };
  f.store.revokeToken(f.b.user.id);
  assert.equal((await f.read("history", renewed)).statusCode, 401);
  assert.equal(
    (await f.save({ ...p, startedByUserId: f.b.user.id }, renewed)).statusCode,
    401,
  );
});
test("rotation additive schema, real legacy reopen and release fingerprints retain data", async (t) => {
  const f = await fixture(t),
    p = f.body();
  await f.save(p);
  const before = databaseFingerprints(f.path);
  assert.ok(before.mental_rotation_results?.["table-exists"]);
  const again = new Store(f.path);
  again.close();
  assertPreserved(before, databaseFingerprints(f.path));
  const legacyRoot = join(f.root, "legacy");
  for (const file of [
    "src/server/store.ts",
    "src/server/errors.ts",
    "src/server/corsi-store.ts",
    "src/server/stroop-store.ts",
    "src/shared/contracts.ts",
    "src/shared/rules.ts",
    "src/shared/corsi.ts",
    "src/shared/stroop.ts",
  ]) {
    const target = join(legacyRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      execFileSync("git", ["show", `0d8cad7:${file}`], {
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
  const db = new DatabaseSync(f.path);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 1);
    db.prepare(
      "UPDATE mental_rotation_results SET payload='{}' WHERE result_id=?",
    ).run(p.resultId);
    assert.throws(() => assertPreserved(before, databaseFingerprints(f.path)));
    db.exec("DROP TABLE mental_rotation_results");
    assert.throws(() => assertPreserved(before, databaseFingerprints(f.path)));
  } finally {
    db.close();
  }
});
test("rotation schema initialization rolls back on conflicting index objects", async (t) => {
  const f = await fixture(t),
    db = new DatabaseSync(f.path);
  try {
    db.exec(
      "DROP TABLE mental_rotation_results;CREATE TABLE mental_rotation_history(x TEXT)",
    );
    const before = databaseFingerprints(f.path);
    assert.equal(before.mental_rotation_results, undefined);
    assert.throws(() => new Store(f.path));
    assert.equal(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='mental_rotation_results'",
        )
        .get(),
      undefined,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM users").get()!.n, 2);
    assertPreserved(before, databaseFingerprints(f.path));
  } finally {
    db.close();
  }
});
