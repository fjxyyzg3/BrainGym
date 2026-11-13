import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateReload,
  type Definition,
  type HubConfig,
  type HubSnapshot,
} from "../scripts/release/hub.js";
import {
  guardConfiguration,
  backupDatabase,
  databaseFingerprints,
  assertPreserved,
  windows,
  privateDirectory,
} from "../scripts/release/files.js";
import { hash } from "../scripts/release/paths.js";
import { Store } from "../src/server/store.js";

const target: Definition = {
  id: "braingym-process",
  cwd: "/example",
  executable: "node",
  args: [],
  env: {},
};
const other: Definition = {
  id: "other",
  cwd: "/example-other",
  executable: "node",
  args: [],
  env: { VERSION: "1" },
};
const config: HubConfig = {
  apps: [target, other],
  hubId: "fixture",
  publicUrl: "https://registry.example.com",
};
const snapshot: HubSnapshot = {
  apps: [
    {
      id: target.id,
      phase: "running",
      pid: 10,
      instanceId: "target",
      health: { state: "healthy" },
    },
    {
      id: other.id,
      phase: "running",
      pid: 11,
      instanceId: "other",
      pendingRestart: false,
      health: { state: "healthy" },
    },
  ],
  mappings: [],
};

test("global Reload requires loaded non-target definitions, not just matching IDs", () => {
  assert.throws(() => validateReload(config, snapshot), /已加载/);
  assert.doesNotThrow(() => validateReload(config, snapshot, config));
  assert.throws(
    () =>
      validateReload(
        { ...config, apps: [target, { ...other, env: { VERSION: "2" } }] },
        snapshot,
        config,
      ),
    /已加载/,
  );
});

test(
  "offline backup refuses an open SQLite writer and copies the complete closed directory",
  { skip: process.platform !== "win32" },
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), "braingym-offline-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = join(directory, "source"),
      path = join(source, "store.sqlite"),
      destination = join(directory, "backup");
    const store = new Store(path);
    store.createUser("Isolated backup identity");
    writeFileSync(join(source, "sidecar"), "complete directory");
    try {
      assert.throws(() => backupDatabase(path, destination), /文件保护/);
    } finally {
      store.close();
    }
    const before = databaseFingerprints(path);
    backupDatabase(path, destination);
    assert.equal(existsSync(join(destination, "sidecar")), true);
    assertPreserved(
      before,
      databaseFingerprints(join(destination, "store.sqlite")),
    );
  },
);

test("pending additions, removals and restart changes reject Reload without applying it", () => {
  assert.throws(
    () => validateReload({ ...config, apps: [target] }, snapshot, config),
    /其它应用/,
  );
  assert.throws(
    () =>
      validateReload(
        config,
        { ...snapshot, apps: snapshot.apps.slice(0, 1) },
        config,
      ),
    /其它应用/,
  );
  assert.throws(
    () =>
      validateReload(
        config,
        {
          ...snapshot,
          apps: snapshot.apps.map((app) => ({ ...app, pendingRestart: true })),
        },
        config,
      ),
    /其它应用/,
  );
  assert.doesNotThrow(() =>
    validateReload(
      { ...config, apps: [target] },
      { apps: [snapshot.apps[0]], mappings: [] },
    ),
  );
});

test(
  "Windows configuration guard blocks external writes and replacement while allowing reads",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "braingym-guard-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "config.json"),
      replacement = join(directory, "replacement.json");
    writeFileSync(path, "{}");
    writeFileSync(replacement, "{}");
    const release = await guardConfiguration(path, hash("{}"));
    try {
      assert.throws(() => writeFileSync(path, "changed"));
      assert.throws(() => renameSync(replacement, path));
    } finally {
      await release();
    }
    assert.doesNotThrow(() => writeFileSync(path, "released"));
  },
);

test(
  "configuration replacement preserves access controls and the complete previous bytes",
  { skip: process.platform !== "win32" },
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), "braingym-config-replace-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    privateDirectory(directory);
    privateDirectory(directory);
    const path = join(directory, "config.json"),
      candidate = join(directory, "candidate.json"),
      backup = join(directory, "backup.json");
    writeFileSync(path, '{"version":1}');
    writeFileSync(candidate, '{"version":2}');
    windows("replace", [
      "-Path",
      path,
      "-Candidate",
      candidate,
      "-Destination",
      backup,
      "-ExpectedHash",
      hash('{"version":1}'),
    ]);
    assert.equal(readFileSync(path, "utf8"), '{"version":2}');
    assert.equal(readFileSync(backup, "utf8"), '{"version":1}');
  },
);
