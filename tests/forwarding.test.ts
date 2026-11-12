import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { processFixture, delay } from "./process-fixture.js";

async function waitUntil(predicate: () => boolean, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await delay(20);
  assert.ok(predicate(), "Expected registration behavior was not observed");
}
async function hubFixture(
  t: { after(fn: () => unknown): void },
  directory: string,
  onOpen: (socket: Socket, request: any, connection: number) => void,
) {
  const stateDir = join(directory, "hub");
  mkdirSync(join(stateDir, ".tmp", "ipc"), { recursive: true });
  const hash = createHash("sha256")
    .update(resolve(stateDir).toLowerCase())
    .digest("hex")
    .slice(0, 24);
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\wheelmaker-app-registration-${hash}`
      : join(stateDir, ".tmp", "ipc", "app-registration.sock");
  const sockets = new Set<Socket>();
  let connections = 0;
  const requests: any[] = [];
  const server = createServer((socket) => {
    const connection = ++connections;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let pending = "";
    socket.on("data", (chunk) => {
      pending += chunk.toString();
      while (pending.includes("\n")) {
        const newline = pending.indexOf("\n");
        const request = JSON.parse(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        requests.push(request);
        onOpen(socket, request, connection);
      }
    });
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(endpoint, done);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => server.close(() => done()));
  });
  return {
    sockets,
    requests,
    get connections() {
      return connections;
    },
  };
}
const write = (socket: Socket, frame: object) =>
  socket.write(JSON.stringify(frame) + "\n");
const registration = (request: any, version: number, state = "ready") => ({
  version,
  id: request.id,
  target: request.target,
  state,
  ...(state === "ready"
    ? { publicUrl: "https://apps.example.com/braingym/" }
    : {}),
});

test("managed publisher opens the exact listener, ignores old versions, reconnects and withdraws on exit", async (t) => {
  const f = await processFixture(t);
  const hub = await hubFixture(
    t,
    f.directory,
    (socket, request, connection) => {
      write(socket, {
        type: "response",
        requestId: request.requestId,
        registration: registration(
          request,
          1,
          connection === 1 ? "pending" : "ready",
        ),
      });
      if (connection === 1) {
        write(socket, {
          type: "state",
          registration: registration(request, 3),
        });
        write(socket, {
          type: "state",
          registration: registration(request, 2, "pending"),
        });
      }
    },
  );
  f.send("initialize", 1, { protocol: 1 });
  await f.waitFrame((frame) => frame.type === "ready");
  await waitUntil(() => hub.requests.length > 0);
  assert.deepEqual(hub.requests[0], {
    operation: "open",
    requestId: 1,
    id: "braingym",
    target: `http://127.0.0.1:${f.port}`,
  });
  await waitUntil(() =>
    f.stderr.includes("Forwarding ready: https://apps.example.com/braingym/"),
  );
  const stateLog = f.stderr.slice(f.stderr.indexOf("Forwarding ready:"));
  assert.equal(stateLog.includes("Forwarding state: pending"), false);
  for (const socket of hub.sockets) socket.destroy();
  f.send("health", 9);
  assert.deepEqual(
    (await f.waitFrame((frame) => frame.requestId === 9)).health,
    { state: "healthy" },
  );
  await waitUntil(() => hub.connections >= 2);
  await waitUntil(() => f.stderr.split("Forwarding ready:").length === 3);
  assert.equal(hub.requests[1].requestId, 1);
  f.send("shutdown", 10);
  f.child.stdin.end();
  assert.equal(await f.waitExit(), 0);
  await waitUntil(() => hub.sockets.size === 0);
});

test("silent and partial open replies time out; a registered idle session does not", async (t) => {
  const f = await processFixture(t);
  const hub = await hubFixture(
    t,
    f.directory,
    (socket, request, connection) => {
      if (connection === 1) return;
      if (connection === 2) {
        socket.write('{"type":"response"');
        return;
      }
      write(socket, {
        type: "response",
        requestId: 1,
        registration: registration(request, 1),
      });
    },
  );
  f.send("initialize", 1, { protocol: 1 });
  await f.waitFrame((frame) => frame.type === "ready");
  await waitUntil(
    () => hub.connections >= 3 && f.stderr.includes("Forwarding ready:"),
    16000,
  );
  await delay(5500);
  assert.equal(hub.connections, 3);
  assert.equal(hub.sockets.size, 1);
});

test("registration conflict and malformed replies recover without stopping the business process", async (t) => {
  const f = await processFixture(t);
  const hub = await hubFixture(
    t,
    f.directory,
    (socket, request, connection) => {
      if (connection === 1)
        write(socket, {
          type: "response",
          requestId: 1,
          code: "conflict",
          error: "occupied",
        });
      else if (connection === 2) socket.write("not-json\n");
      else
        write(socket, {
          type: "response",
          requestId: 1,
          registration: registration(request, 1),
        });
    },
  );
  f.send("initialize", 1, { protocol: 1 });
  await f.waitFrame((frame) => frame.type === "ready");
  await waitUntil(
    () => hub.connections >= 3 && f.stderr.includes("Forwarding ready:"),
    7000,
  );
  assert.equal(f.child.exitCode, null);
  assert.equal(f.invalid.length, 0);
});
