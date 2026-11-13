import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  openSync,
  closeSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/server/store.js";
import {
  withoutControlCredentials,
  assertNoLinks,
  isWithin,
} from "../src/server/environment.js";
import { appId, manifest, atomicJson, hash } from "./release/paths.js";
import {
  privateDirectory,
  copyProgram,
  windowsEnvironment,
} from "./release/files.js";
import {
  connectHub,
  controller,
  readHubConfig,
  type Definition,
  type Hub,
} from "./release/hub.js";
import {
  publish,
  deploymentOperations,
  browserExecutable,
} from "./release/live.js";
import { deploy, recover } from "./release/deploy.js";
import { delay, runNpm, ReleaseError } from "./release/process.js";

const root = resolve(".runtime/release-verification", randomUUID());
const children: ChildProcess[] = [];
let hub: Hub | undefined,
  hubPid = 0;
let stage = "prepare";
let passed = false;
const progress = (next: string) => {
  stage = next;
  console.error(`Isolated release check: ${next}`);
};
const installed = resolve(
  process.env.WHEELMAKER_BINARY ??
    join(homedir(), ".wheelmaker/bin/wheelmaker.exe"),
);
const gateway = resolve(
  process.env.WHEELMAKER_GATEWAY_BINARY ??
    "D:/GithubRepos/BrainGym/data/wheelmaker-verification/wheelmaker-gateway.exe",
);
const hubBinary = join(root, "wheelmaker-console.exe"),
  hubHome = join(root, "hub"),
  shared = join(root, "registry");
const controlScript = resolve("scripts/isolated-hub-process.ps1");
function hubAction(action: string) {
  const result = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      controlScript,
      "-Action",
      action,
      "-StateDir",
      hubHome,
      "-Executable",
      hubBinary,
      "-TargetPid",
      String(hubPid),
    ],
    {
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: windowsEnvironment(),
    },
  );
  if (action === "start") hubPid = JSON.parse(result).pid;
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
function launch(executable: string, args: string[]) {
  const child = spawn(executable, args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: withoutControlCredentials(process.env),
  });
  child.stdout!.on("data", () => {});
  child.stderr!.on("data", () => {});
  child.once("error", () => {});
  children.push(child);
  return child;
}

try {
  progress("prepare");
  if (process.platform !== "win32")
    throw new Error("Windows isolated Hub required");
  privateDirectory(root);
  mkdirSync(hubHome);
  mkdirSync(shared);
  const runtimeArg = process.argv.indexOf("--runtime");
  const runtime =
    runtimeArg >= 0
      ? resolve(process.argv[runtimeArg + 1])
      : join(root, "runtime");
  if (runtimeArg < 0) {
    mkdirSync(runtime);
    for (const name of ["dist", "package.json", "package-lock.json"])
      cpSync(resolve(name), join(runtime, name), { recursive: true });
    await runNpm(
      [
        "ci",
        "--omit=dev",
        "--bin-links=false",
        "--no-audit",
        "--no-fund",
        "--prefer-offline",
      ],
      runtime,
      {
        ...withoutControlCredentials(process.env),
        NODE_ENV: "production",
        npm_config_cache: resolve(".npm-cache"),
        npm_config_fetch_retries: "0",
      },
    );
    const marker = /name="braingym-release" content="([a-f0-9]+)"/.exec(
      readFileSync(join(runtime, "dist/client/index.html"), "utf8"),
    )![1];
    atomicJson(join(runtime, "braingym-release.json"), {
      owner: appId,
      release: marker,
      verification: true,
    });
  }
  assert.equal(
    existsSync(join(runtime, "node_modules/@playwright")),
    false,
    "runtime must omit development dependencies",
  );
  const release = JSON.parse(
    readFileSync(join(runtime, "braingym-release.json"), "utf8"),
  ).release as string;
  const expectedFiles = manifest(runtime);
  const oldRoot = join(root, "old-program"),
    destination = join(root, "production"),
    state = join(root, "state");
  copyProgram(runtime, oldRoot);
  const legacy =
    process.env.BRAINGYM_LEGACY_RUNTIME ?? "D:/GithubRepos/BrainGym";
  if (!existsSync(join(legacy, "dist/server/server/store.js")))
    throw new Error("Legacy program missing");
  cpSync(join(legacy, "dist/server"), join(oldRoot, "dist/server"), {
    recursive: true,
  });
  const { Store: LegacyStore } = (await import(
    pathToFileURL(join(oldRoot, "dist/server/server/store.js")).href
  )) as { Store: typeof Store };
  const database = join(root, "database/store.sqlite");
  const oldStore = new LegacyStore(database);
  const identity = oldStore.createUser("Isolated release verification");
  const session = oldStore.login(identity.token, Date.now());
  const result = {
    resultId: randomUUID(),
    startedByUserId: identity.user.id,
    game: "spatial-n-back" as const,
    version: 1 as const,
    n: 2,
    tp: 9,
    fn: 0,
    fp: 0,
    tn: 21,
    completedAt: new Date().toISOString(),
  };
  oldStore.save(identity.user, result, Date.now());
  oldStore.close();

  const registryPort = await freePort(),
    gatewayPort = await freePort(),
    appPort = await freePort();
  const registryOrigin = `http://127.0.0.1:${registryPort}`,
    appsOrigin = `http://127.0.0.1:${gatewayPort}`;
  const token = randomBytes(32).toString("base64url"),
    hubId = `release-${randomUUID()}`;
  atomicJson(join(shared, "config.json"), {
    publicUrl: registryOrigin,
    token,
    projects: [],
    registry: { listen: true, port: registryPort },
    gateway: { apps: { publicUrl: appsOrigin } },
  });
  const otherRoot = join(root, "other-program");
  mkdirSync(otherRoot);
  writeFileSync(
    join(otherRoot, "main.mjs"),
    `import {createInterface} from 'node:readline'; let identity;
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
if(m.method==='initialize'){identity={appId:m.appId,instanceId:m.instanceId};send({type:'ready',protocol:1,...identity,version:'fixture',health:{state:'healthy'}});}
else if(m.method==='shutdown'){process.exit(0);}else{send({type:'response',requestId:m.requestId,...identity,health:{state:'healthy'}});}}).on('close',()=>process.exit(0));`.replace(
      "+'\\n'",
      "+'\\n'",
    ),
  );
  const original: Definition = {
    id: appId,
    name: "Isolated BrainGym",
    executable: process.execPath,
    args: ["dist/server/server/main.js"],
    cwd: oldRoot,
    env: {
      HOST: "127.0.0.1",
      PORT: String(appPort),
      APP_BASE_PATH: "/braingym/",
      APP_ORIGIN: appsOrigin,
      COOKIE_SECURE: "false",
      NODE_ENV: "production",
      BRAINGYM_ENV: "test",
      DATABASE_PATH: database,
      WHEELMAKER_STATE_DIR: hubHome,
      WHEELMAKER_SERVICE_ID: "braingym",
    },
  };
  const other: Definition = {
    id: "other-process",
    name: "Other fixture",
    executable: process.execPath,
    args: ["main.mjs"],
    cwd: otherRoot,
    env: {},
  };
  const configuration = {
    publicUrl: registryOrigin,
    token,
    hubId,
    projects: [],
    registry: { listen: false, port: registryPort },
    log: { level: "error" },
    apps: [original, other],
  };
  atomicJson(join(hubHome, "config.json"), configuration);
  atomicJson(join(root, "loaded-config.json"), configuration);
  const image = readFileSync(installed),
    pe = image.readUInt32LE(0x3c);
  assert.equal(image.toString("ascii", pe, pe + 4), "PE\0\0");
  image.writeUInt16LE(3, pe + 24 + 68);
  writeFileSync(hubBinary, image);
  progress("services");
  launch(hubBinary, [
    "--registry-server",
    "--registry-addr",
    `127.0.0.1:${registryPort}`,
    "--dir",
    shared,
  ]);
  const gatewayChild = launch(gateway, ["serve-app-tunnel"]);
  gatewayChild.stdin!.write(
    JSON.stringify({
      publicUrl: appsOrigin,
      listen: `127.0.0.1:${gatewayPort}`,
      home: join(shared, "gateway"),
      registryHome: shared,
    }) + "\n",
  );
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      hub = await connectHub(process.cwd(), {
        stateDir: hubHome,
        token,
        isolated: true,
      });
      break;
    } catch {
      await delay(200);
    }
  }
  if (!hub) throw new Error("Isolated Registry unavailable");
  progress("initial-hub");
  hubAction("start");
  await controller(hub, original).waitReady();
  const otherBefore = (await hub.snapshot()).apps.find(
    (app) => app.id === other.id,
  )!;
  assert.equal(otherBefore.phase, "running");
  assert.equal(otherBefore.health?.state, "healthy");
  const refresh = () => {
    hub!.config = readHubConfig(hubHome);
  };

  progress("stopped-backup-failure");
  const failing = deploymentOperations(hub, destination, runtime, state, {
    expectedFiles,
    release,
    isolated: true,
  });
  const backup = failing.operations.backup;
  failing.operations.backup = async (path) => {
    const writer = new DatabaseSync(database);
    try {
      await backup(path);
    } finally {
      writer.close();
    }
  };
  try {
    await assert.rejects(
      deploy(destination, state, failing.control, failing.operations),
      (error: unknown) =>
        error instanceof ReleaseError && error.code === "DEPLOYMENT_RESTORED",
    );
  } finally {
    await failing.close();
  }
  assert.equal(
    readHubConfig(hubHome).apps.find((app) => app.id === appId)!.cwd,
    oldRoot,
  );
  await controller(hub, original).waitReady();

  progress("migration");
  refresh();
  await publish(hub, destination, runtime, state, expectedFiles, release, true);
  refresh();
  const after = (await hub.snapshot()).apps.find((app) => app.id === other.id)!;
  assert.equal(after.pid, otherBefore.pid);
  assert.equal(after.instanceId, otherBefore.instanceId);
  const cookie = `bg_session=${session.session}`;
  assert.equal(
    (await fetch(`${appsOrigin}/braingym/api/me`, { headers: { cookie } }))
      .status,
    200,
  );
  const login = await fetch(`http://127.0.0.1:${appPort}/braingym/api/login`, {
    method: "POST",
    headers: {
      Origin: appsOrigin,
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.7",
    },
    body: JSON.stringify({ token: identity.token }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
  const saved = await fetch(`${appsOrigin}/braingym/api/results`, {
    method: "POST",
    headers: { cookie, Origin: appsOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ ...result, resultId: randomUUID() }),
  });
  assert.equal(saved.status, 200);
  const history = await (
    await fetch(`${appsOrigin}/braingym/api/history`, { headers: { cookie } })
  ).json();
  assert.equal(history.total, 2);
  assert.ok(
    history.items.some(
      (item: { resultId: string }) => item.resultId === result.resultId,
    ),
  );
  assert.equal(
    (
      await fetch(`${appsOrigin}/braingym/api/logout`, {
        method: "POST",
        headers: { cookie, Origin: appsOrigin },
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(`${appsOrigin}/braingym/api/me`, { headers: { cookie } }))
      .status,
    401,
  );

  progress("verification-failure-rollback");
  const variant = join(root, "variant");
  copyProgram(runtime, variant);
  const entry = join(variant, "dist/server/server/main.js");
  writeFileSync(
    entry,
    readFileSync(entry, "utf8") +
      "\n// Isolated rollout verification variant\n",
  );
  const connection = deploymentOperations(hub, destination, variant, state, {
    expectedFiles: manifest(variant),
    release,
    isolated: true,
  });
  connection.operations.verify = async () => {
    throw new ReleaseError("ISOLATED_CHECK", "Isolated failed check");
  };
  try {
    await assert.rejects(
      deploy(destination, state, connection.control, connection.operations),
      (error: unknown) =>
        error instanceof ReleaseError && error.code === "DEPLOYMENT_RESTORED",
    );
  } finally {
    await connection.close();
  }
  assert.deepEqual(manifest(destination), expectedFiles);
  refresh();

  progress("global-reload-refusals");
  const loaded = readHubConfig(hubHome);
  for (const mode of [
    "addition",
    "removal",
    "parameter",
    "pending-restart",
    "baseline",
    "guard",
  ]) {
    const candidate = structuredClone(loaded);
    if (mode === "addition")
      candidate.apps.push({ ...other, id: "pending-other" });
    if (mode === "removal")
      candidate.apps = candidate.apps.filter((app) => app.id !== other.id);
    if (mode === "parameter" || mode === "pending-restart")
      candidate.apps.find((app) => app.id === other.id)!.env.CHANGE = "pending";
    if (mode === "baseline") rmSync(join(root, "loaded-config.json"));
    atomicJson(join(hubHome, "config.json"), candidate);
    refresh();
    if (mode === "pending-restart") await hub.action("reload");
    const before = await hub.snapshot();
    const held =
      mode === "guard"
        ? openSync(join(hubHome, "config.json"), "r+")
        : undefined;
    try {
      await assert.rejects(
        publish(
          hub,
          join(root, `refused-${mode}`),
          runtime,
          join(root, `state-${mode}`),
          expectedFiles,
          release,
          true,
        ),
      );
    } finally {
      if (held !== undefined) closeSync(held);
    }
    assert.deepEqual(
      (await hub.snapshot()).apps.map((app) => [
        app.id,
        app.pid,
        app.instanceId,
      ]),
      before.apps.map((app) => [app.id, app.pid, app.instanceId]),
    );
    if (mode === "parameter") {
      const baselineHash = hash(readFileSync(join(root, "loaded-config.json")));
      await publish(
        hub,
        destination,
        runtime,
        state,
        expectedFiles,
        release,
        true,
      );
      assert.equal(
        hash(readFileSync(join(root, "loaded-config.json"))),
        baselineHash,
        "a publication without Reload must not claim pending disk definitions were loaded",
      );
    }
    atomicJson(join(hubHome, "config.json"), loaded);
    atomicJson(join(root, "loaded-config.json"), loaded);
    refresh();
    if (mode === "pending-restart") await hub.action("reload");
  }
  progress("completed");
  atomicJson(join(root, "result.json"), {
    passed: true,
    realHub: true,
    backupFailureRestored: true,
    migrated: true,
    oldTokenAndSession: true,
    historyAndNewResult: true,
    rollbackRestoredBytes: true,
    globalReloadRefusals: true,
    nonTargetInstancePreserved: true,
    loginBoundary:
      "direct trusted loopback forwarder header; business reads and writes use isolated Gateway",
  });
  console.log(
    JSON.stringify({
      passed: true,
      stage,
      realHub: true,
      backupFailureRestored: true,
      rollback: true,
      dataPreserved: true,
      globalReloadProtected: true,
    }),
  );
  passed = true;
} catch (error) {
  console.error(
    JSON.stringify({
      passed: false,
      stage,
      code: error instanceof ReleaseError ? error.code : "ISOLATED_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  if (hub && hubPid) {
    try {
      await hub.action("stop");
    } catch {}
    try {
      hubAction("interrupt");
    } catch {
      try {
        hubAction("force");
      } catch {}
    }
  }
  hub?.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      child.kill();
      await new Promise<void>((done) => {
        if (child.exitCode !== null) done();
        else child.once("exit", () => done());
      });
    }
  }
  if (passed) {
    assertNoLinks(root);
    for (const name of readdirSync(root).filter(
      (name) => name !== "result.json",
    )) {
      const path = resolve(root, name);
      assert.ok(isWithin(root, path));
      assertNoLinks(path);
      rmSync(path, { recursive: true, force: true });
    }
  }
}
