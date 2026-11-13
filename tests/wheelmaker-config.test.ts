import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const origin = "https://apps.example.com";
const invalidOrigins = [
  undefined,
  "",
  "http://apps.example.com",
  `${origin}/`,
  `${origin}/braingym/`,
  `${origin}?secret=example-value`,
  `${origin}#example-value`,
  "https://example-user:example-password@apps.example.com",
  ` ${origin}`,
];

function environment(value: string | undefined) {
  const env = { ...process.env };
  delete env.APP_ORIGIN;
  if (value !== undefined) env.APP_ORIGIN = value;
  return env;
}

test("public origin validation preserves exact HTTPS origins and optional ports", async () => {
  const moduleUrl = new URL(
    "../scripts/wheelmaker-origin.mjs",
    import.meta.url,
  );
  const { requirePublicOrigin } = await import(moduleUrl.href);
  for (const value of [origin, `${origin}:8443`])
    assert.equal(requirePublicOrigin(value), value);
  for (const value of invalidOrigins)
    assert.throws(
      () => requirePublicOrigin(value),
      /APP_ORIGIN must be configured/,
    );
});

test("public verification rejects invalid private origins before reading fixtures or using the network", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "braingym-origin-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const script of [
    "scripts/verify-wheelmaker-public.mjs",
    "scripts/verify-wheelmaker-preflight.mjs",
  ]) {
    for (const value of invalidOrigins) {
      const run = spawnSync(process.execPath, [resolve(script)], {
        cwd: directory,
        env: environment(value),
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      });
      assert.ifError(run.error);
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /APP_ORIGIN must be configured/);
      assert.doesNotMatch(run.stderr, /ENOENT|private\.json/);
      if (value) assert.equal(run.stderr.includes(value), false);
    }
  }
});

test("legacy public verification and formal fixture creation cannot bypass isolated rehearsal", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "braingym-retired-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const script of [
    "scripts/verify-wheelmaker-public.mjs",
    "scripts/verify-wheelmaker-preflight.mjs",
    "scripts/prepare-wheelmaker-verification.mjs",
  ]) {
    const run = spawnSync(process.execPath, [resolve(script)], {
      cwd: directory,
      env: environment(origin),
      encoding: "utf8",
      windowsHide: true,
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /retired/);
    assert.doesNotMatch(run.stderr, /ENOENT|private\.json/);
    assert.equal(existsSync(join(directory, "data")), false);
  }
});

test(
  "Hub definition requires a private HTTPS origin before creating a preview",
  { skip: process.platform !== "win32" },
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), "braingym-hub-config-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "dist/server/server"), { recursive: true });
    copyFileSync(
      "scripts/configure-wheelmaker.ps1",
      join(directory, "scripts/configure-wheelmaker.ps1"),
    );
    copyFileSync(
      "scripts/release-windows.ps1",
      join(directory, "scripts/release-windows.ps1"),
    );
    copyFileSync(
      "src/server/main.ts",
      join(directory, "dist/server/server/main.js"),
    );
    for (const value of invalidOrigins) {
      const run = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          join(directory, "scripts/configure-wheelmaker.ps1"),
        ],
        {
          env: environment(value),
          encoding: "utf8",
          timeout: 10000,
          windowsHide: true,
        },
      );
      assert.ifError(run.error);
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /AppOrigin must be configured/);
      assert.equal(existsSync(join(directory, "data")), false);
      if (value) assert.equal(run.stderr.includes(value), false);
    }
    const hub = join(directory, "hub"),
      production = join(directory, "production");
    mkdirSync(hub);
    const current = JSON.stringify({
      apps: [
        {
          id: "braingym-process",
          name: "BrainGym",
          executable: process.execPath,
          args: ["dist/server/server/main.js"],
          cwd: directory,
          env: {
            APP_ORIGIN: origin,
            HOST: "127.0.0.1",
            PORT: "3001",
            COOKIE_SECURE: "true",
            DATABASE_PATH: join(directory, "data/braingym.sqlite"),
          },
        },
      ],
    });
    writeFileSync(join(hub, "config.json"), current);
    const run = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        join(directory, "scripts/configure-wheelmaker.ps1"),
        "-StateDir",
        hub,
        "-ProductionDir",
        production,
      ],
      {
        env: environment(origin),
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      },
    );
    assert.ifError(run.error);
    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.applied, false);
    const definition = JSON.parse(readFileSync(output.preview, "utf8"));
    assert.equal(definition.env.APP_ORIGIN, origin);
    assert.equal(definition.env.HOST, "127.0.0.1");
    assert.equal(definition.env.PORT, "3001");
    assert.equal(definition.env.COOKIE_SECURE, "true");
    assert.equal(definition.cwd, production);
    assert.equal(
      definition.env.DATABASE_PATH,
      join(directory, "data/braingym.sqlite"),
    );
    assert.equal(definition.env.BRAINGYM_ENV, "production");
    const refused = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        join(directory, "scripts/configure-wheelmaker.ps1"),
        "-StateDir",
        hub,
        "-ProductionDir",
        production,
        "-Apply",
      ],
      { env: environment(origin), encoding: "utf8", windowsHide: true },
    );
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /bypass rehearsal/);
    assert.equal(readFileSync(join(hub, "config.json"), "utf8"), current);
    assert.equal(run.stdout.includes(origin), false);
  },
);
