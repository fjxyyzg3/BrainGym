import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/store.js";
import { buildApp } from "../src/server/app.js";
import type { ResultInput } from "../src/shared/contracts.js";

const origin = "http://localhost:3000";
async function fixture(
  t: { after: (fn: () => unknown) => void },
  secure = false,
) {
  const dir = mkdtempSync(join(tmpdir(), "braingym-"));
  const path = join(dir, "app.sqlite");
  const store = new Store(path);
  let now = Date.parse("2026-11-12T12:00:00Z");
  const app = await buildApp({ store, origin, now: () => now, secure });
  t.after(async () => {
    await app.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const a = store.createUser("Alice"),
    b = store.createUser("Bob");
  const login = async (token: string) =>
    app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { token },
    });
  const res = await login(a.token);
  assert.equal(res.statusCode, 200);
  const cookie = String(res.headers["set-cookie"]).split(";")[0];
  const payload = (): ResultInput => ({
    resultId: randomUUID(),
    startedByUserId: a.user.id,
    game: "spatial-n-back",
    version: 1,
    n: 2,
    tp: 9,
    fn: 0,
    fp: 0,
    tn: 21,
    completedAt: "2026-11-12T08:00:00.000Z",
  });
  const save = (data: unknown, c = cookie) =>
    app.inject({
      method: "POST",
      url: "/api/results",
      headers: { cookie: c, origin },
      payload: data as Record<string, unknown>,
    });
  return {
    app,
    store,
    a,
    b,
    cookie,
    payload,
    save,
    login,
    path,
    setTime: (x: number) => {
      now = x;
    },
  };
}

test("private session cookie lasts seven days, expires, and logout only ends current session", async (t) => {
  const f = await fixture(t, true);
  const second = await f.login(f.a.token);
  const header = String(second.headers["set-cookie"]);
  assert.match(header, /HttpOnly/i);
  assert.match(header, /Secure/i);
  assert.match(header, /SameSite=Strict/i);
  assert.match(header, /Max-Age=604800/i);
  const secondCookie = header.split(";")[0];
  assert.equal(
    (await f.app.inject({ url: "/api/me", headers: { cookie: f.cookie } }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/logout",
        headers: { cookie: f.cookie, origin },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.app.inject({ url: "/api/me", headers: { cookie: f.cookie } }))
      .statusCode,
    401,
  );
  assert.equal(
    (await f.app.inject({ url: "/api/me", headers: { cookie: secondCookie } }))
      .statusCode,
    200,
  );
  f.setTime(Date.parse("2026-11-20T12:00:00Z"));
  assert.equal(
    (await f.app.inject({ url: "/api/me", headers: { cookie: secondCookie } }))
      .statusCode,
    401,
  );
});
test("revoke and rotate reject old token fresh logins, revoke all sessions, preserve history", async (t) => {
  const f = await fixture(t);
  await f.save(f.payload());
  f.store.revokeToken(f.a.user.id);
  assert.equal((await f.login(f.a.token)).statusCode, 401);
  assert.equal(
    (await f.app.inject({ url: "/api/history", headers: { cookie: f.cookie } }))
      .statusCode,
    401,
  );
  const token = f.store.rotateToken(f.a.user.id);
  const login = await f.login(token);
  assert.equal(login.statusCode, 200);
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  assert.equal(
    (await f.app.inject({ url: "/api/history", headers: { cookie } })).json()
      .total,
    1,
  );
  const replacement = f.store.rotateToken(f.a.user.id);
  assert.equal((await f.login(token)).statusCode, 401);
  assert.equal(
    (await f.app.inject({ url: "/api/me", headers: { cookie } })).statusCode,
    401,
  );
  assert.equal((await f.login(replacement)).statusCode, 200);
  const bytes = readFileSync(f.path).toString("utf8");
  assert.ok(
    !bytes.includes(f.a.token) &&
      !bytes.includes(replacement) &&
      !bytes.includes(cookie.split("=")[1]),
  );
});
test("cross-account precondition, isolation, idempotency and concurrent retries", async (t) => {
  const f = await fixture(t);
  const data = f.payload();
  const bLogin = await f.login(f.b.token);
  const bCookie = String(bLogin.headers["set-cookie"]).split(";")[0];
  assert.equal((await f.save(data, bCookie)).statusCode, 409);
  assert.equal(
    (
      await f.app.inject({ url: "/api/history", headers: { cookie: bCookie } })
    ).json().total,
    0,
  );
  const replies = await Promise.all(
    Array.from({ length: 4 }, () => f.save(data)),
  );
  assert.ok(replies.every((x) => x.statusCode === 200));
  assert.ok(
    replies.every((x) => x.json().receivedAt === replies[0].json().receivedAt),
  );
  assert.equal(
    (
      await f.app.inject({ url: "/api/history", headers: { cookie: f.cookie } })
    ).json().total,
    1,
  );
  assert.equal((await f.save({ ...data, tp: 8, fn: 1 })).statusCode, 409);
  assert.equal(
    (await f.save({ ...data, completedAt: "2026-11-12T09:00:00.000Z" }))
      .statusCode,
    409,
  );
});
test("completion order differs from upload order; score and bests are server derived per N", async (t) => {
  const f = await fixture(t);
  const noon = {
    ...f.payload(),
    completedAt: "2026-11-12T11:00:00.000Z",
    tp: 8,
    fn: 1,
  };
  const noonSaved = await f.save(noon);
  assert.equal(noonSaved.statusCode, 200);
  f.setTime(Date.parse("2026-11-12T15:00:00Z"));
  const morning = f.payload();
  const morningSaved = await f.save({
    ...morning,
    score: 0,
    receivedAt: "1900-01-01T00:00:00Z",
  });
  assert.equal(morningSaved.json().score, 100);
  assert.equal(morningSaved.json().receivedAt, "2026-11-12T15:00:00.000Z");
  const history = (
    await f.app.inject({ url: "/api/history", headers: { cookie: f.cookie } })
  ).json();
  assert.deepEqual(
    history.items.map((x: ResultInput) => x.resultId),
    [noon.resultId, morning.resultId],
  );
  assert.equal(
    (
      await f.app.inject({ url: "/api/bests", headers: { cookie: f.cookie } })
    ).json().items[0].score,
    100,
  );
  assert.equal(
    (
      await f.app.inject({
        url: "/api/history?page=-1",
        headers: { cookie: f.cookie },
      })
    ).statusCode,
    400,
  );
});
test("invalid aggregates, missing identity/time, unsupported rules and unauthenticated writes fail", async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { n: 0 },
    { n: 6 },
    { tp: -1, fn: 10 },
    { tp: 1.5, fn: 7.5 },
    { tn: 20 },
    { tp: 0, fn: 0, tn: 30 },
    { version: 2 },
    { game: "other" },
    { completedAt: "garbage" },
    { completedAt: undefined },
    { startedByUserId: undefined },
  ]) {
    assert.equal(
      (await f.save({ ...f.payload(), ...patch })).statusCode,
      400,
      JSON.stringify(patch),
    );
  }
  assert.equal((await f.save(f.payload(), "")).statusCode, 401);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/results",
        headers: { cookie: f.cookie, origin: "https://evil.invalid" },
        payload: f.payload(),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({ url: "/api/history", headers: { cookie: f.cookie } })
    ).json().total,
    0,
  );
});
test("database reopens with credentials and results intact", async (t) => {
  const f = await fixture(t);
  await f.save(f.payload());
  const other = new Store(f.path);
  const app = await buildApp({ store: other, origin });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { token: f.a.token },
    });
    assert.equal(login.statusCode, 200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    assert.equal(
      (await app.inject({ url: "/api/history", headers: { cookie } })).json()
        .total,
      1,
    );
  } finally {
    await app.close();
    other.close();
  }
});

test("bests compare unrounded scores and stay separate for each N", async (t) => {
  const f = await fixture(t);
  // Both display 1.9, but 50/26 is greater than 50/27.
  const low = { ...f.payload(), tp: 0, fn: 3, tn: 1, fp: 26 };
  await f.save(low);
  f.setTime(Date.parse("2026-11-12T12:01:00Z"));
  const high = { ...f.payload(), tp: 0, fn: 4, tn: 1, fp: 25 };
  await f.save(high);
  const separate = { ...f.payload(), n: 1 };
  await f.save(separate);
  const bests = (
    await f.app.inject({ url: "/api/bests", headers: { cookie: f.cookie } })
  ).json().items;
  assert.equal(bests.length, 2);
  assert.equal(
    bests.find((x: ResultInput) => x.n === 2).resultId,
    high.resultId,
  );
  assert.equal(bests.find((x: ResultInput) => x.n === 1).score, 100);
});

test("history pagination has bounded pages with no repeated or missing equal-time records", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 21; i++) await f.save(f.payload());
  const first = (
    await f.app.inject({
      url: "/api/history?page=1",
      headers: { cookie: f.cookie },
    })
  ).json();
  const second = (
    await f.app.inject({
      url: "/api/history?page=2",
      headers: { cookie: f.cookie },
    })
  ).json();
  assert.equal(first.total, 21);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 1);
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.resultId)).size,
    21,
  );
});
