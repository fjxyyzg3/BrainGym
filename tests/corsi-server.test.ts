import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/server/store.js";
import { buildApp } from "../src/server/app.js";
import {
  CORSI_FORWARD as forward,
  CORSI_BACKWARD as backward,
  GAME,
  type CorsiResultInput,
  type CorsiProgress,
} from "../src/shared/contracts.js";
import {
  databaseFingerprints,
  assertPreserved,
} from "../scripts/release/files.js";

async function fixture(
  t: { after(fn: () => void | Promise<void>): void },
  file = false,
) {
  const root = mkdtempSync(join(tmpdir(), "braingym-corsi-"));
  const path = file ? join(root, "store.sqlite") : ":memory:";
  const store = new Store(path);
  let now = Date.parse("2026-11-14T00:00:00.000Z");
  const app = await buildApp({
    store,
    origin: "http://127.0.0.1",
    now: () => now,
  });
  const a = store.createUser("隔离 Corsi 测试用户");
  const auth = store.login(a.token, now);
  const cookie = `bg_session=${auth.session}`;
  const headers = { cookie, origin: "http://127.0.0.1" };
  t.after(async () => {
    await app.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const body = (patch: Partial<CorsiResultInput> = {}): CorsiResultInput => ({
    game: forward,
    version: 1,
    resultId: randomUUID(),
    startedByUserId: a.user.id,
    completedAt: new Date(now).toISOString(),
    progressEpoch: 0,
    startLength: 4,
    failedLength: 6,
    firstTrialCorrect: true,
    maxFirstTryLength: 4,
    ...patch,
  });
  const save = (payload: object) =>
    app.inject({ method: "POST", url: "/api/results", headers, payload });
  const progress = async () => {
    const response = await app.inject({ url: "/api/corsi/progress", headers });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<CorsiProgress>();
  };
  const reset = (
    game = forward as typeof forward | typeof backward,
    epoch = 0,
    userId = a.user.id,
  ) =>
    app.inject({
      method: "POST",
      url: "/api/corsi/progress/reset",
      headers,
      payload: { game, expectedEpoch: epoch, expectedUserId: userId },
    });
  return {
    root,
    path,
    store,
    app,
    a,
    headers,
    cookie,
    body,
    save,
    progress,
    reset,
    setTime: (value: number) => (now = value),
    get now() {
      return now;
    },
  };
}

test("Corsi progress requires a session and starts both directions at two", async (t) => {
  const f = await fixture(t);
  const p = await f.progress();
  assert.equal(p.user.id, f.a.user.id);
  assert.equal(p.serverNow, f.now);
  assert.deepEqual(
    p.items.map((x) => [
      x.game,
      x.nextStartLength,
      x.progressEpoch,
      x.bestSpan,
    ]),
    [
      [forward, 2, 0, null],
      [backward, 2, 0, null],
    ],
  );
  assert.equal(
    (await f.app.inject({ url: "/api/corsi/progress" })).statusCode,
    401,
  );
});

test("Corsi scores, completion order, channel isolation and stable retries are server derived", async (t) => {
  const f = await fixture(t);
  await f.progress();
  const later = f.body();
  const saved = await f.save({ ...later, score: 999, nextStartLength: 999 });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().score, 5);
  assert.equal(saved.json().nextStartLength, 4);
  f.setTime(f.now + 10000);
  const older = f.body({
    completedAt: new Date(f.now - 20000).toISOString(),
    startLength: 3,
    failedLength: 5,
    maxFirstTryLength: 3,
  });
  assert.equal((await f.save(older)).statusCode, 200);
  assert.equal((await f.progress()).items[0].nextStartLength, 4);
  assert.equal((await f.progress()).items[1].nextStartLength, 2);
  const retry = await f.save(
    Object.fromEntries(Object.entries(later).reverse()),
  );
  assert.deepEqual(retry.json(), saved.json());
  assert.equal(
    (await f.save({ ...later, maxFirstTryLength: 5 })).statusCode,
    409,
  );
  assert.equal((await f.save({ ...later, game: backward })).statusCode, 409);
  const history = await f.app.inject({
    url: `/api/history?game=${forward}`,
    headers: f.headers,
  });
  assert.equal(history.json().total, 2);
  assert.equal(history.json().items[0].resultId, later.resultId);
  const best = await f.app.inject({
    url: `/api/bests?game=${forward}`,
    headers: f.headers,
  });
  assert.equal(best.json().items[0].score, 5);
  const nback = {
    game: GAME,
    version: 1,
    resultId: later.resultId,
    startedByUserId: f.a.user.id,
    n: 2,
    tp: 15,
    fn: 0,
    fp: 0,
    tn: 15,
    completedAt: later.completedAt,
  };
  assert.equal((await f.save(nback)).statusCode, 409);
  const id = randomUUID();
  assert.equal((await f.save({ ...nback, resultId: id })).statusCode, 200);
  assert.equal((await f.save({ ...later, resultId: id })).statusCode, 409);
});

test("reset preserves history and bests, isolates old in-flight results and protects identity and epoch", async (t) => {
  const f = await fixture(t);
  await f.progress();
  const old = f.body();
  assert.equal((await f.save(old)).statusCode, 200);
  assert.equal((await f.reset(forward, 0, randomUUID())).statusCode, 409);
  const reset = await f.reset();
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal((await f.progress()).items[0].progressEpoch, 1);
  assert.equal((await f.progress()).items[0].nextStartLength, 2);
  assert.equal((await f.progress()).items[0].bestSpan, 5);
  f.setTime(f.now + 10000);
  assert.equal(
    (await f.save(f.body({ maxFirstTryLength: 5 }))).statusCode,
    200,
  );
  assert.equal((await f.progress()).items[0].nextStartLength, 2);
  const current = f.body({
    progressEpoch: 1,
    startLength: 2,
    failedLength: 4,
    maxFirstTryLength: 3,
  });
  assert.equal((await f.save(current)).statusCode, 200);
  assert.equal((await f.reset(forward, 0)).statusCode, 409);
  assert.equal((await f.progress()).items[0].nextStartLength, 3);
  assert.equal((await f.progress()).items[1].progressEpoch, 0);
  assert.equal((await f.save(f.body({ progressEpoch: 2 }))).statusCode, 409);
  f.setTime(f.now - 86400000);
  assert.equal(
    (await f.save(old)).statusCode,
    200,
    "已保存重试不能重新按当前时钟拒绝",
  );
  const b = f.store.createUser("另一个隔离用户");
  const session = f.store.login(b.token, f.now);
  const switched = await f.app.inject({
    method: "POST",
    url: "/api/corsi/progress/reset",
    headers: { ...f.headers, cookie: `bg_session=${session.session}` },
    payload: { game: forward, expectedEpoch: 0, expectedUserId: f.a.user.id },
  });
  assert.equal(switched.statusCode, 409);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/corsi/progress/reset",
        headers: { ...f.headers, origin: "https://rejected.invalid" },
        payload: {
          game: forward,
          expectedEpoch: 1,
          expectedUserId: f.a.user.id,
        },
      })
    ).statusCode,
    403,
  );
});

test("Corsi history pagination and stable ties remain private to the authenticated user and direction", async (t) => {
  const f = await fixture(t);
  const records = [];
  for (let i = 0; i < 23; i++) {
    const record = f.body({
      resultId: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    });
    records.push(record);
    assert.equal((await f.save(record)).statusCode, 200);
  }
  const first = (
    await f.app.inject({
      url: `/api/history?game=${forward}`,
      headers: f.headers,
    })
  ).json();
  const second = (
    await f.app.inject({
      url: `/api/history?game=${forward}&page=2`,
      headers: f.headers,
    })
  ).json();
  assert.equal(first.total, 23);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 3);
  assert.equal(first.items[0].resultId, records[22].resultId);
  assert.equal(second.items[2].resultId, records[0].resultId);
  const best = (
    await f.app.inject({
      url: `/api/bests?game=${forward}`,
      headers: f.headers,
    })
  ).json();
  assert.equal(
    best.items[0].resultId,
    records[0].resultId,
    "同分采用首次入库较早、再按 ID 升序",
  );
  const b = f.store.createUser("分页隔离用户"),
    auth = f.store.login(b.token, f.now);
  const headers = { ...f.headers, cookie: `bg_session=${auth.session}` };
  for (const game of [forward, backward]) {
    assert.equal(
      (await f.app.inject({ url: `/api/history?game=${game}`, headers })).json()
        .total,
      0,
    );
    assert.equal(
      (await f.app.inject({ url: `/api/bests?game=${game}`, headers })).json()
        .items.length,
      0,
    );
  }
  assert.equal(
    (
      await f.app.inject({
        url: `/api/history?game=${backward}`,
        headers: f.headers,
      })
    ).json().total,
    0,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/results",
        headers,
        payload: { ...records[0], startedByUserId: b.user.id },
      })
    ).statusCode,
    200,
    "不同用户可独立使用同一结果 ID",
  );
  for (const url of [
    `/api/history?game=${forward}&game=${backward}`,
    "/api/bests?game=unknown",
  ])
    assert.equal(
      (await f.app.inject({ url, headers: f.headers })).statusCode,
      400,
    );
});

test("time tolerance, invalid summaries, zero best, safe huge summaries and revoked sessions", async (t) => {
  const f = await fixture(t);
  await f.progress();
  assert.equal(
    (
      await f.save(
        f.body({ completedAt: new Date(f.now + 5000).toISOString() }),
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.save(
        f.body({ completedAt: new Date(f.now + 5001).toISOString() }),
      )
    ).statusCode,
    400,
  );
  for (const patch of [
    { firstTrialCorrect: "true" },
    { startLength: 1 },
    { failedLength: 3 },
    { maxFirstTryLength: 6 },
    { progressEpoch: -1 },
    { progressEpoch: 0.5 },
    { version: 2 },
    { completedAt: "invalid" },
    { startedByUserId: undefined },
  ]) {
    assert.equal(
      (await f.save({ ...f.body(), ...patch })).statusCode,
      400,
      JSON.stringify(patch),
    );
  }
  assert.equal(
    (await f.save(f.body({ startedByUserId: randomUUID() }))).statusCode,
    409,
  );
  const zero = f.body({
    game: backward,
    startLength: 2,
    failedLength: 2,
    firstTrialCorrect: false,
    maxFirstTryLength: 0,
  });
  assert.equal((await f.save(zero)).statusCode, 200);
  assert.equal(
    (
      await f.app.inject({
        url: `/api/bests?game=${backward}`,
        headers: f.headers,
      })
    ).json().items.length,
    0,
  );
  const huge = f.body({
    game: backward,
    startLength: 4294967298,
    failedLength: 4294967298,
    firstTrialCorrect: false,
    maxFirstTryLength: 0,
  });
  f.setTime(f.now + 10000);
  huge.completedAt = new Date(f.now).toISOString();
  assert.equal((await f.save(huge)).statusCode, 200);
  assert.equal((await f.progress()).items[1].nextStartLength, 4294967297);
  assert.equal((await f.reset(backward)).statusCode, 200);
  assert.equal((await f.progress()).items[1].nextStartLength, 2);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/results",
        headers: f.headers,
        payload: { ...f.body(), padding: "x".repeat(9000) },
      })
    ).statusCode,
    413,
  );
  f.store.revokeToken(f.a.user.id);
  for (const url of [
    "/api/corsi/progress",
    `/api/history?game=${forward}`,
    `/api/bests?game=${forward}`,
  ])
    assert.equal(
      (await f.app.inject({ url, headers: f.headers })).statusCode,
      401,
    );
  assert.equal((await f.reset()).statusCode, 401);
});

test("future legacy rows stay excluded; both optional tables are protected across old program reopen", async (t) => {
  const f = await fixture(t, true);
  await f.progress();
  const baseline = databaseFingerprints(f.path);
  assert.equal((await f.save(f.body())).statusCode, 200);
  const db = new DatabaseSync(f.path);
  const future = f.body({
    completedAt: new Date(f.now + 86400000).toISOString(),
    maxFirstTryLength: 5,
  });
  db.prepare("INSERT INTO corsi_results VALUES(?,?,?,?,?,?,?,?,?)").run(
    f.a.user.id,
    future.resultId,
    forward,
    1,
    0,
    JSON.stringify(future),
    5,
    future.completedAt,
    new Date(f.now).toISOString(),
  );
  db.close();
  assert.equal((await f.progress()).items[0].nextStartLength, 4);
  f.setTime(f.now + 2 * 86400000);
  assert.equal((await f.progress()).items[0].nextStartLength, 4);
  const hist = await f.app.inject({
    url: `/api/history?game=${forward}`,
    headers: f.headers,
  });
  assert.equal(hist.json().items[0].timeAnomaly, true);
  await f.reset();
  const after = databaseFingerprints(f.path);
  assertPreserved(baseline, after);
  assert(after.corsi_results && after.corsi_progress_resets);
  const oldRoot = join(f.root, "legacy");
  for (const file of [
    "src/server/store.ts",
    "src/server/errors.ts",
    "src/shared/contracts.ts",
    "src/shared/rules.ts",
  ]) {
    const target = join(oldRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      execFileSync("git", ["show", `eaa686a:${file}`], {
        encoding: "utf8",
        windowsHide: true,
      }),
    );
  }
  writeFileSync(
    join(oldRoot, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  const loader = pathToFileURL(
    resolve("node_modules/tsx/dist/loader.mjs"),
  ).href;
  const oldPath = join(f.root, "old-only.sqlite");
  const createOld = `import {Store} from ${JSON.stringify(pathToFileURL(join(oldRoot, "src/server/store.ts")).href)};
    const store=new Store(${JSON.stringify(oldPath)});const a=store.createUser('旧库隔离用户');
    store.login(a.token,Date.now());const result={game:'spatial-n-back',version:1,resultId:crypto.randomUUID(),
      startedByUserId:a.user.id,n:2,tp:15,fn:0,fp:0,tn:15,completedAt:new Date().toISOString()};
    store.save(a.user,result,Date.now());store.close();console.log(JSON.stringify({user:a.user,result}));`;
  const oldData = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", loader, "--input-type=module", "-e", createOld],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  const oldFingerprints = databaseFingerprints(oldPath);
  assert.equal(oldFingerprints.corsi_results, undefined);
  const upgraded = new Store(oldPath);
  assert.equal(upgraded.listUsers().length, 1);
  assert.equal(upgraded.history(oldData.user.id, 1).total, 1);
  assert.equal(
    upgraded.save(oldData.user, oldData.result, Date.now()).resultId,
    oldData.result.resultId,
  );
  upgraded.close();
  const emptyExtensions = databaseFingerprints(oldPath);
  assertPreserved(oldFingerprints, emptyExtensions);
  assert.deepEqual(emptyExtensions.corsi_results, { "table-exists": "1" });
  const missingEmpty = new DatabaseSync(oldPath);
  missingEmpty.exec("DROP TABLE corsi_results");
  missingEmpty.close();
  assert.throws(
    () => assertPreserved(emptyExtensions, databaseFingerprints(oldPath)),
    /保留/,
  );
  const script = `import {Store} from ${JSON.stringify(pathToFileURL(join(oldRoot, "src/server/store.ts")).href)}; const store=new Store(${JSON.stringify(f.path)}); if(store.listUsers().length!==1) throw new Error('legacy users missing'); store.close(); console.log('legacy-ok');`;
  const output = execFileSync(
    process.execPath,
    ["--import", loader, "--input-type=module", "-e", script],
    { encoding: "utf8", windowsHide: true },
  );
  assert.match(output, /legacy-ok/);
  assertPreserved(after, databaseFingerprints(f.path));
  const reopened = new Store(f.path);
  reopened.close();
  assertPreserved(after, databaseFingerprints(f.path));
  const modified = new DatabaseSync(f.path);
  modified.exec("DROP TABLE corsi_progress_resets");
  modified.close();
  assert.throws(
    () => assertPreserved(after, databaseFingerprints(f.path)),
    /保留/,
  );
});
