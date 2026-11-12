import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { registryClient } from "./wheelmaker-rpc.mjs";

if (process.platform !== "win32")
  throw new Error("Windows Hub lifecycle verification requires Windows");
const root = resolve(`data/wheelmaker-verification/isolated-${Date.now()}`);
const shared = join(root, "shared"),
  hubHome = join(root, "hub");
mkdirSync(shared, { recursive: true });
mkdirSync(hubHome, { recursive: true });
const installedBinary = resolve(
  process.env.WHEELMAKER_BINARY ??
    "C:/Users/fjxyy/.wheelmaker/bin/wheelmaker.exe",
);
// The release uses the GUI PE subsystem and has no console to receive SIGINT.
// Change only the subsystem metadata in an isolated copy, not executable code.
const binary = join(root, "wheelmaker-console.exe");
const hubImage = readFileSync(installedBinary);
const peHeader = hubImage.readUInt32LE(0x3c);
assert.equal(
  hubImage.toString("ascii", peHeader, peHeader + 4),
  "PE\u0000\u0000",
);
const subsystemOffset = peHeader + 24 + 68;
const originalSubsystem = hubImage.readUInt16LE(subsystemOffset);
assert.ok(originalSubsystem === 2 || originalSubsystem === 3);
hubImage.writeUInt16LE(3, subsystemOffset);
writeFileSync(binary, hubImage);
const gatewayBinary = resolve(
  process.env.WHEELMAKER_GATEWAY_BINARY ??
    "data/wheelmaker-verification/wheelmaker-gateway.exe",
);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function port(requested = 0) {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(requested, "127.0.0.1", done);
  });
  const result = server.address().port;
  await new Promise((done) => server.close(done));
  return result;
}
await port(9630);
await port(9690);
const appPort = await port();
const registryOrigin = "http://127.0.0.1:9630",
  appsOrigin = "http://127.0.0.1:9690";
const token = randomBytes(32).toString("base64url"),
  hubId = `braingym-verification-${Date.now()}`;
const databasePath = join(root, "braingym.sqlite");
const { Store } = await import(
  pathToFileURL(
    resolve("data/wheelmaker-verification/legacy-server/server/store.js"),
  ).href
);
const seed = new Store(databasePath),
  identity = seed.createUser("Isolated legacy identity");
const legacyResult = seed.save(
  identity.user,
  {
    resultId: randomUUID(),
    startedByUserId: identity.user.id,
    game: "spatial-n-back",
    version: 1,
    n: 2,
    tp: 9,
    fn: 0,
    fp: 0,
    tn: 21,
    completedAt: new Date().toISOString(),
  },
  Date.now(),
);
seed.close();
const { Store: CurrentStore } = await import(
  pathToFileURL(resolve("dist/server/server/store.js")).href
);
writeFileSync(
  join(shared, "config.json"),
  JSON.stringify({
    publicUrl: registryOrigin,
    token,
    projects: [],
    registry: { listen: true, port: 9630 },
    gateway: { apps: { publicUrl: appsOrigin } },
  }),
  { mode: 0o600 },
);
writeFileSync(
  join(hubHome, "config.json"),
  JSON.stringify({
    publicUrl: registryOrigin,
    token,
    hubId,
    projects: [],
    registry: { listen: false, port: 9630 },
    log: { level: "info" },
    apps: [
      {
        id: "braingym-process",
        name: "BrainGym",
        executable: process.execPath,
        cwd: resolve("."),
        args: ["dist/server/server/main.js"],
        env: {
          HOST: "127.0.0.1",
          PORT: String(appPort),
          APP_BASE_PATH: "/braingym/",
          APP_ORIGIN: appsOrigin,
          COOKIE_SECURE: "false",
          DATABASE_PATH: databasePath,
          WHEELMAKER_STATE_DIR: hubHome,
          WHEELMAKER_SERVICE_ID: "braingym",
        },
      },
    ],
  }),
  { mode: 0o600 },
);
const children = [];
function launch(name, executable, args) {
  const child = spawn(executable, args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stdout.on("data", (chunk) => {
    diagnostics += chunk;
  });
  child.stderr.on("data", (chunk) => {
    diagnostics += chunk;
  });
  child.on("error", (error) => {
    diagnostics += error.message;
  });
  children.push(child);
  return {
    child,
    get diagnostics() {
      return diagnostics;
    },
  };
}
function hubAction(action, targetPid = 0) {
  const output = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      resolve("scripts/isolated-hub-process.ps1"),
      "-Action",
      action,
      "-StateDir",
      hubHome,
      "-Executable",
      binary,
      "-TargetPid",
      String(targetPid),
    ],
    { windowsHide: true, encoding: "utf8" },
  );
  if (action === "start") return JSON.parse(output).pid;
  if (action === "interrupt") assert.equal(JSON.parse(output).exitCode, 0);
  return undefined;
}
let client, hubPid, registry, gateway;
const state = async () => {
  const result = await client.call(
    "hub.state.get",
    { sections: ["monitor", "forwarding"] },
    3000,
  );
  return result.state ?? result;
};
async function ready() {
  const deadline = Date.now() + 45000;
  let problem = "Hub not connected";
  while (Date.now() < deadline) {
    if (registry.child.exitCode !== null || gateway.child.exitCode !== null)
      throw new Error(
        `Isolated service exited: ${registry.diagnostics.slice(-800)} ${gateway.diagnostics.slice(-800)}`,
      );
    try {
      const snapshot = await state();
      const app = snapshot.sections?.monitor?.data?.apps?.find(
        (item) => item.id === "braingym-process",
      );
      const mapping = snapshot.sections?.forwarding?.data?.mappings?.find(
        (item) => item.id === "braingym",
      );
      if (
        app?.phase === "running" &&
        app.health?.state === "healthy" &&
        mapping?.state === "ready"
      ) {
        const response = await fetch(`${appsOrigin}/braingym/api/health`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
        const store = new CurrentStore(databasePath);
        assert.equal(
          store.login(identity.token, Date.now()).user.id,
          identity.user.id,
        );
        assert.deepEqual(
          store.history(identity.user.id, 1).items[0],
          legacyResult,
        );
        store.close();
        return {
          instanceId: app.instanceId,
          pid: app.pid,
          hubPid,
          publication: mapping.state,
        };
      }
      problem = JSON.stringify({ app, mapping });
    } catch (error) {
      problem = error.message;
    }
    await delay(250);
  }
  throw new Error(
    `Isolated Hub not ready: ${problem}; ${registry.diagnostics.slice(-700)} ${gateway.diagnostics.slice(-700)}; ${readFileSync(join(hubHome, "log/hub.log"), "utf8").slice(-1200)}`,
  );
}
try {
  registry = launch("registry", installedBinary, [
    "--registry-server",
    "--registry-addr",
    "127.0.0.1:9630",
    "--dir",
    shared,
  ]);
  gateway = launch("gateway", gatewayBinary, ["serve-app-tunnel"]);
  gateway.child.stdin.write(
    JSON.stringify({
      publicUrl: appsOrigin,
      listen: "127.0.0.1:9690",
      home: join(shared, "gateway"),
      registryHome: shared,
    }) + "\n",
  );
  let connectionError = "not connected";
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      client = await registryClient({ origin: registryOrigin, token, hubId });
      break;
    } catch (error) {
      connectionError = error.message;
      await delay(200);
    }
    if (registry.child.exitCode !== null || gateway.child.exitCode !== null)
      throw new Error(
        `Isolated startup failed: ${registry.diagnostics.slice(-1000)} ${gateway.diagnostics.slice(-1000)}`,
      );
  }
  if (!client)
    throw new Error(`Isolated Registry connection failed: ${connectionError}`);
  hubPid = hubAction("start");
  const first = await ready();
  hubAction("interrupt", hubPid);
  await delay(1000);
  hubPid = hubAction("start");
  const afterNormal = await ready();
  assert.notEqual(afterNormal.instanceId, first.instanceId);
  hubAction("force", hubPid);
  await delay(1000);
  hubPid = hubAction("start");
  const afterForced = await ready();
  assert.notEqual(afterForced.instanceId, afterNormal.instanceId);
  const result = {
    passed: true,
    protocolVersion: client.protocolVersion,
    consoleSubsystemFixture: true,
    originalSubsystem,
    first,
    afterNormal,
    afterForced,
    legacyIdentityPreserved: true,
    legacyHistoryPreserved: true,
  };
  writeFileSync(
    resolve("data/wheelmaker-verification/isolated-result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  client?.close();
  if (hubPid) {
    try {
      hubAction("interrupt", hubPid);
    } catch {
      try {
        hubAction("force", hubPid);
      } catch {}
    }
  }
  for (const child of children.reverse())
    if (child.exitCode === null) {
      try {
        execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {}
    }
}
