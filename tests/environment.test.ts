import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  existsSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readConfig } from "../src/server/config.js";
import { developmentEnvironment } from "../src/server/environment.js";
import { assertBuildSafe } from "../scripts/build.js";

test("ordinary startup defaults to an isolated development database and API port", () => {
  const config = readConfig({});
  assert.equal(
    config.databasePath,
    resolve(".runtime/development/braingym.sqlite"),
  );
  assert.equal(config.port, 3002);
  assert.equal(config.environment, "development");
});

test("development refuses the old formal database before opening it", () => {
  assert.throws(
    () =>
      readConfig({
        BRAINGYM_ENV: "development",
        DATABASE_PATH: "data/braingym.sqlite",
      }),
    /开发数据库/,
  );
});

test("development API and Vite share settings and cannot use the formal port or origin", () => {
  const env = developmentEnvironment({
    DEV_API_PORT: "3302",
    DEV_WEB_PORT: "5300",
    BRAINGYM_REGISTRY_TOKEN: "fixture only",
  });
  assert.equal(env.PORT, "3302");
  assert.equal(env.APP_ORIGIN, "http://127.0.0.1:5300");
  assert.equal(env.WHEELMAKER_APP_MANAGED, "0");
  assert.equal(env.BRAINGYM_REGISTRY_TOKEN, undefined);
  assert.throws(() => developmentEnvironment({ DEV_API_PORT: "3001" }), /端口/);
  assert.throws(() => readConfig({ PORT: "3001" }), /开发环境/);
  assert.throws(
    () => readConfig({ APP_ORIGIN: "https://apps.example.com" }),
    /开发环境/,
  );
});

test("production requires an explicit database and rejects a managed development mode", () => {
  assert.throws(
    () =>
      readConfig({
        BRAINGYM_ENV: "production",
        APP_ORIGIN: "https://apps.example.com",
      }),
    /DATABASE_PATH/,
  );
  assert.throws(
    () =>
      readConfig({
        BRAINGYM_ENV: "development",
        WHEELMAKER_APP_MANAGED: "1",
        APP_BASE_PATH: "/braingym/",
        DATABASE_PATH: "data/braingym.sqlite",
      }),
    /环境/,
  );
});

test("test mode uses only an explicit isolated database; Docker production stays compatible", () => {
  assert.throws(() => readConfig({ BRAINGYM_ENV: "test" }), /DATABASE_PATH/);
  assert.equal(
    readConfig({
      BRAINGYM_ENV: "test",
      DATABASE_PATH: resolve("data/e2e-example.sqlite"),
    }).environment,
    "test",
  );
  const docker = readConfig({
    NODE_ENV: "production",
    DATABASE_PATH: "/app/data/braingym.sqlite",
    HOST: "0.0.0.0",
    PORT: "3000",
    COOKIE_SECURE: "false",
  });
  assert.equal(docker.port, 3000);
  assert.equal(docker.secure, false);
  assert.equal(docker.environment, "production");
});

test("real CLI defaults to development without creating the legacy database", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "braingym-environment-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BRAINGYM_ENV: "development",
  };
  delete env.DATABASE_PATH;
  delete env.WHEELMAKER_APP_MANAGED;
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      resolve("src/server/cli.ts"),
      "user:create",
      "Development identity",
    ],
    { cwd: directory, env, encoding: "utf8", windowsHide: true },
  );
  assert.equal(
    run.status,
    0,
    "development CLI should create an isolated account",
  );
  assert.equal(existsSync(join(directory, "data/braingym.sqlite")), false);
  assert.equal(
    existsSync(join(directory, ".runtime/development/braingym.sqlite")),
    true,
  );
  assert.equal(JSON.parse(run.stdout).user.name, "Development identity");
  assert.match(run.stderr, /development/);
});

test("the original repository build refuses to overwrite the legacy formal dist before migration", (t) => {
  const root = mkdtempSync(join(tmpdir(), "braingym-build-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(
    spawnSync("git", ["init", "-b", "main"], { cwd: root, windowsHide: true })
      .status,
    0,
  );
  mkdirSync(join(root, "data"));
  writeFileSync(
    join(root, "data/braingym.sqlite"),
    "isolated fixture, never opened",
  );
  const production = join(root, "separate-production");
  assert.throws(() => assertBuildSafe(root, production), /禁止覆盖/);
  mkdirSync(production);
  writeFileSync(
    join(production, "braingym-release.json"),
    JSON.stringify({ owner: "braingym-process" }),
  );
  assert.doesNotThrow(() => assertBuildSafe(root, production));
});
