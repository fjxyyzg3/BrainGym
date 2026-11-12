import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { processFixture, delay } from "./process-fixture.js";

test("managed root echoes split initialize identity and every health request without stdout logs", async (t) => {
  const f = await processFixture(t);
  const initialize = Buffer.from(
    JSON.stringify({
      type: "request",
      method: "initialize",
      requestId: 1,
      protocol: 1,
      ...f.identity,
    }) + "\n",
  );
  f.child.stdin.write(initialize.subarray(0, initialize.length - 4));
  f.child.stdin.write(initialize.subarray(initialize.length - 4));
  const ready = await f.waitFrame((frame) => frame.type === "ready");
  assert.equal(ready.appId, f.identity.appId);
  assert.equal(ready.instanceId, f.identity.instanceId);
  assert.equal(ready.protocol, 1);
  assert.deepEqual(ready.health, { state: "healthy" });
  f.send("health", 41);
  f.send("health", 98);
  for (const id of [41, 98]) {
    const reply = await f.waitFrame(
      (frame) => frame.type === "response" && frame.requestId === id,
    );
    assert.deepEqual(reply.health, { state: "healthy" });
    assert.equal(reply.instanceId, f.identity.instanceId);
  }
  assert.equal(f.frames.filter((frame) => frame.type === "ready").length, 1);
  assert.equal(f.invalid.length, 0);
});

test("storage lock reports unhealthy, recovery clears diagnostics and keeps the root PID", async (t) => {
  const f = await processFixture(t);
  f.send("initialize", 1, { protocol: 1 });
  await f.waitFrame((frame) => frame.type === "ready");
  const pid = f.child.pid;
  const lock = new DatabaseSync(join(f.directory, "store.sqlite"));
  try {
    lock.exec("BEGIN IMMEDIATE");
    const unhealthy = await f.waitFrame(
      (frame) => frame.type === "event" && frame.health?.state === "unhealthy",
    );
    assert.equal(unhealthy.health.components[0].id, "storage");
    lock.exec("ROLLBACK");
    const healthy = await f.waitFrame(
      (frame) => frame.type === "event" && frame.health?.state === "healthy",
    );
    assert.deepEqual(healthy.health, { state: "healthy" });
    assert.equal(f.child.pid, pid);
    assert.equal(f.child.exitCode, null);
  } finally {
    lock.close();
  }
});

test("shutdown followed by EOF exits once and releases the HTTP listener", async (t) => {
  const f = await processFixture(t);
  f.send("initialize", 1, { protocol: 1 });
  await f.waitFrame((frame) => frame.type === "ready");
  f.send("shutdown", 2);
  f.child.stdin.end();
  assert.equal(await f.waitExit(), 0);
  await assert.rejects(fetch(`http://127.0.0.1:${f.port}/braingym/api/health`));
});

test("oversized or invalid initialize/control frames exit nonzero", async (t) => {
  for (const line of [
    " ".repeat(8192) + "\n",
    "not-json\n",
    JSON.stringify({
      type: "request",
      requestId: 1,
      method: "initialize",
      protocol: 99,
      appId: "braingym-process",
      instanceId: "other",
    }) + "\n",
  ]) {
    const f = await processFixture(t);
    f.child.stdin.write(line);
    assert.notEqual(await f.waitExit(), 0);
    assert.equal(f.frames.filter((frame) => frame.type === "ready").length, 0);
    assert.equal(f.invalid.length, 0);
  }
  const f = await processFixture(t);
  f.send("initialize", 1, { protocol: 1 });
  await f.waitFrame((frame) => frame.type === "ready");
  f.send("health", 2, { instanceId: "wrong-instance" });
  assert.notEqual(await f.waitExit(), 0);
});

test("ordinary foreground mode remains running when stdin closes", async (t) => {
  const f = await processFixture(t, false);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch(`http://127.0.0.1:${f.port}/api/health`)).ok;
    } catch {}
    if (ready) break;
    await delay(20);
  }
  assert.equal(ready, true);
  f.child.stdin.end();
  await delay(100);
  assert.equal(f.child.exitCode, null);
  assert.equal(
    (await fetch(`http://127.0.0.1:${f.port}/api/health`)).status,
    200,
  );
});
