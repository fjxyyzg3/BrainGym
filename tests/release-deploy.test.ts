import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { join } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  deploy,
  recover,
  type DeploymentControl,
  type DeploymentOperations,
} from "../scripts/release/deploy.js";
import { ReleaseError, delay } from "../scripts/release/process.js";

test("deployment rejects a missing candidate before reading private Hub configuration", () => {
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      resolve("scripts/release.ts"),
      "deploy",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /CANDIDATE_REQUIRED/);
});

function fixture(
  t: { after(callback: () => void): void },
  fault = "",
  initial = "running",
) {
  const root = mkdtempSync(join(tmpdir(), "braingym-deploy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, "program"),
    home = join(root, "state"),
    database = join(root, "database");
  mkdirSync(target);
  writeFileSync(join(target, "version"), "old");
  writeFileSync(database, "private history");
  let phase = initial;
  let starts = 0,
    readyChecks = 0;
  const control: DeploymentControl = {
    async state() {
      return {
        id: "braingym-process",
        phase,
        pid: phase === "running" ? 7 : 0,
        health: { state: "healthy" },
      };
    },
    async stop() {
      phase = "stopped";
      if (fault === "stop-response") throw new Error("response lost");
    },
    async start() {
      if (fault === "start" && starts++ === 0)
        throw new Error("new process failed to start");
      phase = "running";
    },
    async waitStopped() {
      assert.equal(phase, "stopped");
    },
    async waitReady() {
      if (fault === "ready" && readyChecks++ === 0)
        throw new Error("new process never became ready");
      assert.equal(phase, "running");
    },
  };
  const operations: DeploymentOperations = {
    async preflight() {
      if (fault === "preflight") throw new Error("preflight failed");
    },
    async backup(path) {
      if (
        [
          "database-backup",
          "program-backup",
          "writer",
          "disk",
          "config",
        ].includes(fault)
      )
        throw new Error("backup failed");
      mkdirSync(path, { recursive: true });
      cpSync(target, join(path, "program"), { recursive: true });
    },
    async replace() {
      writeFileSync(join(target, "version"), "new");
      if (fault === "replace") throw new Error("partial copy");
    },
    async loadDefinition() {
      if (fault === "definition") throw new Error("load failed");
    },
    async verify() {
      if (["verify", "recovery"].includes(fault))
        throw new Error("verify failed");
    },
    async restoreProgram(path) {
      if (fault === "recovery") throw new Error("restore failed");
      cpSync(join(path, "program"), target, { recursive: true });
    },
    async restoreDefinition() {},
  };
  return {
    root,
    target,
    home,
    database,
    control,
    operations,
    current: () => phase,
  };
}

for (const fault of [
  "database-backup",
  "program-backup",
  "writer",
  "disk",
  "config",
  "replace",
  "definition",
  "start",
  "ready",
  "verify",
]) {
  test(`failed ${fault} restores the old program, data and running state`, async (t) => {
    const f = fixture(t, fault);
    await assert.rejects(
      deploy(f.target, f.home, f.control, f.operations),
      (error: unknown) =>
        error instanceof ReleaseError && error.code === "DEPLOYMENT_RESTORED",
    );
    assert.equal(f.current(), "running");
    assert.equal(readFileSync(join(f.target, "version"), "utf8"), "old");
    assert.equal(readFileSync(f.database, "utf8"), "private history");
    const journal = readdirSync(f.home).find((name) => name.endsWith(".json"))!;
    assert.equal(
      JSON.parse(readFileSync(join(f.home, journal), "utf8")).state,
      "restored",
    );
  });
}

test("backup failure preserves an originally stopped instance", async (t) => {
  const f = fixture(t, "database-backup", "stopped");
  await assert.rejects(
    deploy(f.target, f.home, f.control, f.operations),
    /原程序/,
  );
  assert.equal(f.current(), "stopped");
  assert.equal(readFileSync(join(f.target, "version"), "utf8"), "old");
});

test("a lost Stop response is reconciled before publishing the actual program", async (t) => {
  const f = fixture(t, "stop-response");
  const journal = await deploy(f.target, f.home, f.control, f.operations);
  assert.equal(journal.state, "published");
  assert.equal(readFileSync(join(f.target, "version"), "utf8"), "new");
  assert.equal(f.current(), "running");
});

test("failed recovery keeps its journal and rejects a new deployment", async (t) => {
  const f = fixture(t, "recovery");
  await assert.rejects(
    deploy(f.target, f.home, f.control, f.operations),
    (e: unknown) => e instanceof ReleaseError && e.code === "RECOVERY_FAILED",
  );
  await assert.rejects(
    deploy(f.target, f.home, f.control, f.operations),
    (e: unknown) => e instanceof ReleaseError && e.code === "RECOVERY_REQUIRED",
  );
  assert.equal(readFileSync(f.database, "utf8"), "private history");
  f.operations.restoreProgram = async (path) => {
    cpSync(join(path, "program"), f.target, { recursive: true });
  };
  assert.equal(
    (await recover(f.target, f.home, f.control, f.operations)).state,
    "restored",
  );
  assert.equal(readFileSync(join(f.target, "version"), "utf8"), "old");
  assert.equal(f.current(), "running");
});

test("the deployment lock prevents a second writer while the first is stopped for backup", async (t) => {
  const f = fixture(t);
  let release!: () => void, entered!: () => void;
  const wait = new Promise<void>((done) => {
    release = done;
  });
  const started = new Promise<void>((done) => {
    entered = done;
  });
  const backup = f.operations.backup;
  f.operations.backup = async (path) => {
    entered();
    await wait;
    await backup(path);
  };
  const first = deploy(f.target, f.home, f.control, f.operations);
  await started;
  try {
    await assert.rejects(
      deploy(f.target, f.home, f.control, f.operations),
      (e: unknown) =>
        e instanceof ReleaseError && e.code === "DEPLOYMENT_LOCKED",
    );
  } finally {
    release();
  }
  assert.equal((await first).state, "published");
});

test("an interrupted publisher recovers from its durable journal without rolling back data", async (t) => {
  const f = fixture(t);
  const phase = join(f.root, "managed-state");
  writeFileSync(phase, "running");
  const child = spawn(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "--input-type=module",
      "-e",
      `
    import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
    import {join} from 'node:path';
    import {deploy} from ${JSON.stringify(pathToFileURL(resolve("scripts/release/deploy.ts")).href)};
    const [target,home,phase]=${JSON.stringify([f.target, f.home, phase])};
    const control={
      async state(){return {id:'braingym-process',phase:readFileSync(phase,'utf8'),health:{state:'healthy'}};},
      async stop(){writeFileSync(phase,'stopped');},async start(){writeFileSync(phase,'running');},
      async waitStopped(){},async waitReady(){}
    };
    await deploy(target,home,control,{
      async preflight(){},async backup(path){mkdirSync(path,{recursive:true});cpSync(target,join(path,'program'),{recursive:true});},
      async replace(){writeFileSync(join(target,'version'),'new');},async loadDefinition(){},
      async verify(){writeFileSync(phase,'checking');await new Promise(()=>setInterval(()=>{},1000));},
      async restoreProgram(){},async restoreDefinition(){}
    });
  `,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  const deadline = Date.now() + 15000;
  while (readFileSync(phase, "utf8") !== "checking" && Date.now() < deadline)
    await delay(50);
  assert.equal(
    readFileSync(phase, "utf8"),
    "checking",
    "child must reach verification after replacing the program",
  );
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGKILL");
  await exited;
  assert.equal(readFileSync(join(f.target, "version"), "utf8"), "new");
  const control: DeploymentControl = {
    ...f.control,
    async state() {
      return {
        id: "braingym-process",
        phase: readFileSync(phase, "utf8"),
        health: { state: "healthy" },
      };
    },
    async stop() {
      writeFileSync(phase, "stopped");
    },
    async start() {
      writeFileSync(phase, "running");
    },
    async waitStopped() {
      assert.equal(readFileSync(phase, "utf8"), "stopped");
    },
    async waitReady() {
      assert.equal(readFileSync(phase, "utf8"), "running");
    },
  };
  assert.equal(
    (await recover(f.target, f.home, control, f.operations)).state,
    "restored",
  );
  assert.equal(readFileSync(join(f.target, "version"), "utf8"), "old");
  assert.equal(readFileSync(f.database, "utf8"), "private history");
  assert.equal(readFileSync(phase, "utf8"), "running");
});
