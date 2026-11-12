import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/server/store.js";
import { buildApp } from "../src/server/app.js";

const origin = "https://apps.example.com";
async function fixture(
  t: { after(fn: () => unknown): void },
  managed = false,
  basePath = "/",
) {
  const directory = mkdtempSync(join(tmpdir(), "braingym-http-"));
  const databasePath = join(directory, "store.sqlite");
  const store = new Store(databasePath);
  let closed = false;
  const identity = store.createUser("HTTP verification");
  const web = join(directory, "web");
  mkdirSync(join(web, "assets"), { recursive: true });
  writeFileSync(
    join(web, "index.html"),
    '<html><head><base href="/"><meta name="braingym-base-path" content="/"></head><body>BrainGym</body></html>',
  );
  writeFileSync(join(web, "assets", "app.js"), "export const ready = true;");
  const app = await buildApp({
    store,
    origin,
    managed,
    basePath,
    secure: managed,
    staticRoot: web,
  });
  t.after(async () => {
    await app.close();
    if (!closed) store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const login = (
    ip?: string | string[],
    remoteAddress = "127.0.0.1",
    token = identity.token,
  ) =>
    app.inject({
      method: "POST",
      url: `${basePath}api/login`,
      remoteAddress,
      headers: {
        origin,
        ...(ip === undefined ? {} : { "x-forwarded-for": ip }),
      },
      payload: { token },
    });
  return {
    app,
    store,
    identity,
    databasePath,
    login,
    closeStore() {
      store.close();
      closed = true;
    },
  };
}

test("prefixed HTTP serves health, private APIs and correctly scoped login/logout cookies", async (t) => {
  const f = await fixture(t, true, "/braingym/");
  const health = await f.app.inject("/braingym/api/health");
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { ok: true });
  const response = await f.login("203.0.113.7");
  assert.equal(response.statusCode, 200);
  const cookie = String(response.headers["set-cookie"]);
  assert.match(cookie, /Path=\/braingym\//);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Strict/i);
  const history = await f.app.inject({
    url: "/braingym/api/history",
    headers: { cookie: cookie.split(";")[0] },
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().total, 0);
  assert.equal(history.headers["cache-control"], "no-store");
  const logout = await f.app.inject({
    method: "POST",
    url: "/braingym/api/logout",
    headers: { origin, cookie: cookie.split(";")[0] },
  });
  assert.equal(logout.statusCode, 200);
  assert.match(String(logout.headers["set-cookie"]), /Path=\/braingym\//);
  assert.equal((await f.app.inject("/api/health")).statusCode, 404);
});

test("runtime document base, assets, slash redirect and API 404 respect the prefix", async (t) => {
  const f = await fixture(t, false, "/braingym/");
  const page = await f.app.inject({
    url: "/braingym/",
    headers: { accept: "text/html" },
  });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /<base href="\/braingym\/"/);
  assert.match(page.body, /name="braingym-base-path" content="\/braingym\/"/);
  assert.equal((await f.app.inject("/braingym/assets/app.js")).statusCode, 200);
  const redirect = await f.app.inject("/braingym");
  assert.equal(redirect.statusCode, 308);
  assert.equal(redirect.headers.location, "/braingym/");
  const missing = await f.app.inject({
    url: "/braingym/api/missing",
    headers: { accept: "text/html" },
  });
  assert.equal(missing.statusCode, 404);
  assert.match(String(missing.headers["content-type"]), /json/);
  for (const path of ["/braingym/api", "/braingym/api?missing=true"]) {
    const apiRoot = await f.app.inject({
      url: path,
      headers: { accept: "text/html" },
    });
    assert.equal(apiRoot.statusCode, 404);
    assert.match(String(apiRoot.headers["content-type"]), /json/);
  }
  assert.equal(
    (await f.app.inject({ url: "/outside", headers: { accept: "text/html" } }))
      .statusCode,
    404,
  );
});

test("managed login fails closed for missing, malformed, duplicate, loopback or untrusted client addresses", async (t) => {
  const f = await fixture(t, true);
  for (const address of [
    undefined,
    "invalid",
    "203.0.113.7, 203.0.113.8",
    "127.0.0.1",
    "::1",
    ["203.0.113.7", "203.0.113.8"],
  ]) {
    const response = await f.login(address);
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, "CLIENT_IP_UNAVAILABLE");
    assert.equal(response.headers["set-cookie"], undefined);
  }
  assert.equal((await f.login("203.0.113.7", "198.51.100.5")).statusCode, 503);
  assert.equal((await f.app.inject("/api/health")).statusCode, 200);
  assert.equal((await f.login("203.0.113.7")).statusCode, 200);
});

test("managed login budgets belong to the verified client IP and include failed tokens", async (t) => {
  const f = await fixture(t, true);
  for (let i = 0; i < 20; i++)
    assert.equal(
      (await f.login("203.0.113.7", undefined, "wrong")).statusCode,
      401,
    );
  assert.equal((await f.login("203.0.113.7")).statusCode, 429);
  assert.equal((await f.login("203.0.113.8")).statusCode, 200);
});

test("equivalent IP spellings share a budget; ordinary mode ignores spoofed headers", async (t) => {
  const managed = await fixture(t, true);
  for (let i = 0; i < 20; i++)
    assert.equal(
      (await managed.login("2001:db8::1", undefined, "wrong")).statusCode,
      401,
    );
  assert.equal(
    (await managed.login("2001:0db8:0000:0000:0000:0000:0000:0001")).statusCode,
    429,
  );
  const ordinary = await fixture(t);
  for (let i = 0; i < 20; i++)
    assert.equal(
      (await ordinary.login(`203.0.113.${i + 1}`, undefined, "wrong"))
        .statusCode,
      401,
    );
  assert.equal((await ordinary.login("198.51.100.3")).statusCode, 429);
});

test("Origin remains a fixed independent gate", async (t) => {
  const f = await fixture(t, true);
  const response = await f.app.inject({
    method: "POST",
    url: "/api/login",
    headers: {
      origin: "https://evil.example",
      "x-forwarded-host": "apps.example.com",
    },
    payload: { token: f.identity.token },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, "ORIGIN_REJECTED");
});

test("health reports locked/closed storage and recovers without waiting five seconds", async (t) => {
  const f = await fixture(t);
  const lock = new DatabaseSync(f.databasePath);
  try {
    lock.exec("BEGIN IMMEDIATE");
    const started = Date.now();
    assert.equal((await f.app.inject("/api/health")).statusCode, 503);
    assert.ok(Date.now() - started < 2000);
    lock.exec("ROLLBACK");
    assert.equal((await f.app.inject("/api/health")).statusCode, 200);
  } finally {
    lock.close();
  }
  f.closeStore();
  assert.equal((await f.app.inject("/api/health")).statusCode, 503);
});
