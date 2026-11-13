import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  manifest,
  hash,
  atomicJson,
  sourceIdentity,
  files,
  stableRoot,
} from "./paths.js";
import { git, run, runNpm, ReleaseError } from "./process.js";
import {
  withoutControlCredentials,
  assertNoLinks,
} from "../../src/server/environment.js";
import { privateDirectory } from "./files.js";

export const checks = [
  "typecheck",
  "build",
  "test",
  "e2e-root",
  "e2e-prefix",
  "development",
  "runtime",
  "isolated-hub",
] as const;
export interface Evidence {
  format: 1;
  candidate: string;
  commit: string;
  source: string;
  node: string;
  platform: string;
  arch: string;
  lock: string;
  checks: string[];
  files: Record<string, string>;
  release: string;
  createdAt: string;
  seal: string;
}

export function readEvidence(directory: string): Evidence {
  assertNoLinks(join(directory, "evidence.json"));
  const evidence: Evidence = JSON.parse(
    readFileSync(join(directory, "evidence.json"), "utf8"),
  );
  const { seal, ...body } = evidence;
  if (
    evidence.format !== 1 ||
    hash(JSON.stringify(body)) !== seal ||
    evidence.node !== process.version ||
    evidence.platform !== process.platform ||
    evidence.arch !== process.arch ||
    JSON.stringify(evidence.checks) !== JSON.stringify(checks)
  )
    throw new ReleaseError(
      "EVIDENCE_INVALID",
      "候选验收证据缺失、被改动或运行环境已变化",
    );
  const runtime = join(directory, "runtime");
  if (
    JSON.stringify(manifest(runtime)) !== JSON.stringify(evidence.files) ||
    hash(readFileSync(join(runtime, "package-lock.json"))) !== evidence.lock
  )
    throw new ReleaseError("ARTIFACT_CHANGED", "候选程序或依赖已被改动");
  return evidence;
}

export function assertPublishable(root: string, directory: string): Evidence {
  const source = sourceIdentity(root);
  if (source.branch !== "main")
    throw new ReleaseError(
      "MAIN_REQUIRED",
      "只能从稳定 main 工作区执行正式发布",
    );
  const evidence = readEvidence(directory);
  if (source.fingerprint !== evidence.source)
    throw new ReleaseError(
      "SOURCE_CHANGED",
      "main 内容与已演练候选不一致，请重新演练",
    );
  return evidence;
}

export async function prepareCandidate(
  root: string,
  home: string,
): Promise<string> {
  const identity = sourceIdentity(root);
  privateDirectory(home);
  const directory = resolve(
    home,
    "candidates",
    `${identity.commit.slice(0, 12)}-${randomUUID()}`,
  );
  const source = join(directory, "source"),
    runtime = join(directory, "runtime");
  mkdirSync(source, { recursive: true, mode: 0o700 });
  const archive = join(directory, "source.tar");
  git(root, "archive", "--format=tar", `--output=${archive}`, identity.commit);
  await run("tar", ["-xf", archive, "-C", source], root);
  rmSync(archive);
  files(source);
  const env: NodeJS.ProcessEnv = {
    ...withoutControlCredentials(process.env),
    BRAINGYM_ENV: "test",
    NODE_ENV: "test",
    WHEELMAKER_APP_MANAGED: "0",
    DATABASE_PATH: join(directory, "verification.sqlite"),
    APP_ORIGIN: "http://127.0.0.1:3100",
    COOKIE_SECURE: "false",
  };
  env.BRAINGYM_LEGACY_RUNTIME = existsSync(
    "D:/Apps/BrainGym/dist/server/server/store.js",
  )
    ? resolve("D:/Apps/BrainGym")
    : stableRoot(root);
  env.WHEELMAKER_GATEWAY_BINARY ??= join(
    stableRoot(root),
    "data/wheelmaker-verification/wheelmaker-gateway.exe",
  );
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??= [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find((path) => existsSync(path));
  env.npm_config_cache ??= join(root, ".npm-cache");
  env.npm_config_fetch_retries = "0";
  delete env.E2E_REUSE_SERVER;
  delete env.E2E_BASE_PATH;
  await runNpm(
    ["ci", "--no-audit", "--no-fund", "--prefer-offline"],
    source,
    env,
  );
  for (const command of ["typecheck", "build", "test"]) {
    console.error(`Release check: ${command}`);
    await runNpm(["run", command], source, env);
  }
  for (const base of ["/", "/braingym/"]) {
    await runNpm(["run", "test:e2e"], source, {
      ...env,
      E2E_BASE_PATH: base,
      E2E_DATABASE_PATH: join(
        directory,
        `e2e-${base === "/" ? "root" : "prefix"}.sqlite`,
      ),
    });
  }
  await run(
    process.execPath,
    ["scripts/verify-development.mjs"],
    source,
    {
      ...env,
      BRAINGYM_ENV: "development",
      NODE_ENV: "development",
      DATABASE_PATH: join(source, ".runtime/development/braingym.sqlite"),
    },
    true,
  );
  mkdirSync(runtime, { mode: 0o700 });
  for (const name of ["dist", "package.json", "package-lock.json"])
    cpSync(join(source, name), join(runtime, name), {
      recursive: true,
      dereference: false,
    });
  await runNpm(
    ["ci", "--omit=dev", "--bin-links=false", "--no-audit", "--no-fund"],
    runtime,
    { ...env, NODE_ENV: "production" },
  );
  const html = readFileSync(join(runtime, "dist/client/index.html"), "utf8");
  const release = /name="braingym-release" content="([a-f0-9]+)"/.exec(
    html,
  )?.[1];
  if (!release) throw new ReleaseError("BUILD_INVALID", "候选缺少发行标记");
  atomicJson(join(runtime, "braingym-release.json"), {
    owner: "braingym-process",
    commit: identity.commit,
    source: identity.fingerprint,
    release,
  });
  await run(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "scripts/verify-release-isolated.ts",
      "--runtime",
      runtime,
    ],
    source,
    env,
    true,
  );
  const body: Omit<Evidence, "seal"> = {
    format: 1,
    candidate: directory,
    commit: identity.commit,
    source: identity.fingerprint,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    lock: hash(readFileSync(join(runtime, "package-lock.json"))),
    checks: [...checks],
    files: manifest(runtime),
    release,
    createdAt: new Date().toISOString(),
  };
  atomicJson(join(directory, "evidence.json"), {
    ...body,
    seal: hash(JSON.stringify(body)),
  });
  readEvidence(directory);
  return directory;
}
