import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  manifest,
  hash,
  atomicJson,
  sourceIdentity,
  assertOwnedProgram,
  assertSeparated,
} from "../scripts/release/paths.js";
import {
  readEvidence,
  checks,
  assertPublishable,
  type Evidence,
} from "../scripts/release/artifact.js";
import { assertNodeRuntime } from "../scripts/release/process.js";

test("managed executable must match the rehearsed Node runtime", () => {
  assert.doesNotThrow(() => assertNodeRuntime(process.execPath));
  assert.throws(
    () => assertNodeRuntime(join(tmpdir(), "missing-braingym-node.exe")),
    /运行环境/,
  );
});

test("explicit release command provides help without accessing the formal environment", () => {
  const run =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", "npm run release -- --help"],
          { encoding: "utf8", windowsHide: true },
        )
      : spawnSync("npm", ["run", "release", "--", "--help"], {
          encoding: "utf8",
        });
  assert.equal(
    run.status,
    0,
    "release entrypoint should be available without private configuration",
  );
  assert.match(run.stdout, /prepare|rehearse|deploy/);
});

function fixture(t: { after(callback: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "braingym-artifact-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = join(root, "runtime");
  mkdirSync(join(runtime, "dist"), { recursive: true });
  writeFileSync(join(runtime, "dist/app.js"), "export const release = 1;");
  writeFileSync(join(runtime, "package-lock.json"), "{}");
  const body: Omit<Evidence, "seal"> = {
    format: 1,
    candidate: root,
    commit: "fixture",
    source: "source",
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    lock: hash("{}"),
    checks: [...checks],
    files: manifest(runtime),
    release: "fixture",
    createdAt: new Date().toISOString(),
  };
  const save = () =>
    atomicJson(join(root, "evidence.json"), {
      ...body,
      seal: hash(JSON.stringify(body)),
    });
  save();
  return { root, runtime, body, save };
}

test("artifact integrity rejects changed dependencies, unexpected files and incomplete evidence", (t) => {
  const f = fixture(t);
  assert.equal(readEvidence(f.root).source, "source");
  writeFileSync(join(f.runtime, "dist/app.js"), "changed");
  assert.throws(() => readEvidence(f.root), /候选程序/);
  writeFileSync(join(f.runtime, "dist/app.js"), "export const release = 1;");
  writeFileSync(join(f.runtime, ".env"), "private fixture");
  assert.throws(() => readEvidence(f.root), /候选程序/);
  rmSync(join(f.runtime, ".env"));
  f.body.checks.pop();
  f.save();
  assert.throws(() => readEvidence(f.root), /验收证据/);
});

test("targets refuse unknown files and overlapping data", (t) => {
  const f = fixture(t);
  assert.throws(() => assertOwnedProgram(f.runtime), /未归属/);
  assert.throws(() => assertSeparated(f.root, f.runtime), /重叠/);
  assert.throws(() => assertSeparated(f.root, f.root), /重叠/);
});

test("main publication requires committed runtime content and ignores unrelated local metadata", (t) => {
  const f = fixture(t),
    source = join(f.root, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  writeFileSync(join(source, "src/app.ts"), "export const value = 1;");
  const git = (...args: string[]) => {
    const run = spawnSync("git", args, {
      cwd: source,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(run.status, 0, "temporary Git fixture command must succeed");
    return run.stdout.trim();
  };
  git("init", "-b", "main");
  git("add", "--", "src");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "-m",
    "fixture",
  );
  f.body.source = sourceIdentity(source).fingerprint;
  f.save();
  mkdirSync(join(source, ".agents"));
  writeFileSync(join(source, ".agents/local"), "local metadata");
  assert.equal(assertPublishable(source, f.root).source, f.body.source);
  git("checkout", "-b", "feature");
  assert.throws(() => assertPublishable(source, f.root), /main/);
  git("checkout", "main");
  writeFileSync(join(source, "src/app.ts"), "export const value = 2;");
  assert.throws(() => assertPublishable(source, f.root), /未提交/);
});
