import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { assertNoLinks, isWithin } from "../../src/server/environment.js";
import { ReleaseError, git } from "./process.js";

export const appId = "braingym-process";
export const serviceId = "braingym";
export const programFiles = [
  "dist",
  "node_modules",
  "package.json",
  "package-lock.json",
  "braingym-release.json",
] as const;
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

export function stableRoot(cwd = process.cwd()): string {
  const common = resolve(cwd, git(cwd, "rev-parse", "--git-common-dir"));
  return dirname(common);
}

export function releaseHome(root = stableRoot()): string {
  return resolve(root, ".runtime/releases");
}

export function assertSeparated(...paths: string[]): void {
  for (const path of paths) assertNoLinks(path);
  for (let a = 0; a < paths.length; a++)
    for (let b = a + 1; b < paths.length; b++) {
      if (
        resolve(paths[a]).toLowerCase() === resolve(paths[b]).toLowerCase() ||
        isWithin(paths[a], paths[b]) ||
        isWithin(paths[b], paths[a])
      )
        throw new ReleaseError(
          "PATH_OVERLAP",
          "程序、数据、工作区或备份路径重叠",
        );
    }
}

export function files(root: string): string[] {
  assertNoLinks(root);
  const found: string[] = [];
  function walk(directory: string) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink())
        throw new ReleaseError("PATH_LINK", "发布输入包含链接");
      if (info.isDirectory()) walk(path);
      else if (info.isFile())
        found.push(relative(root, path).replaceAll("\\", "/"));
      else throw new ReleaseError("PATH_TYPE", "发布输入包含非普通文件");
    }
  }
  walk(root);
  return found.sort();
}

export function manifest(root: string): Record<string, string> {
  return Object.fromEntries(
    files(root).map((path) => [path, hash(readFileSync(join(root, path)))]),
  );
}

export function atomicJson(path: string, value: unknown): void {
  assertNoLinks(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const candidate = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(candidate, JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    renameSync(candidate, path);
  } finally {
    if (existsSync(candidate)) rmSync(candidate);
  }
}

export function assertOwnedProgram(path: string): void {
  assertNoLinks(path);
  if (!existsSync(path) || readdirSync(path).length === 0) return;
  if (!existsSync(join(path, "braingym-release.json")))
    throw new ReleaseError(
      "TARGET_UNOWNED",
      "正式目录含有未归属内容，拒绝覆盖",
    );
  const metadata = JSON.parse(
    readFileSync(join(path, "braingym-release.json"), "utf8"),
  );
  if (
    metadata.owner !== appId ||
    readdirSync(path).some(
      (name) => !programFiles.includes(name as (typeof programFiles)[number]),
    )
  )
    throw new ReleaseError("TARGET_UNOWNED", "正式目录所有权或文件清单不符");
  files(path);
}

export function sourceIdentity(root: string) {
  const commit = git(root, "rev-parse", "HEAD");
  const tracked = git(root, "ls-tree", "-r", "-z", commit).split("\0");
  if (tracked.some((line) => line.startsWith("120000 ")))
    throw new ReleaseError("SOURCE_LINK", "源码提交含符号链接");
  const runtime = (path: string) =>
    path !== "" &&
    !/^(docs\/|\.agents\/|\.claude\/|\.skill-source-lock\.json$|(?:README|AGENTS|CLAUDE)\.md$)/.test(
      path,
    );
  if (
    tracked.some((line) => {
      const path = line.slice(line.indexOf("\t") + 1);
      return (
        (path.startsWith(".env") &&
          path !== ".env.example" &&
          !path.endsWith(".example")) ||
        /^(?:data\/|\.runtime\/)|\.sqlite(?:-shm|-wal)?$/.test(path)
      );
    })
  )
    throw new ReleaseError(
      "SOURCE_PRIVATE_INPUT",
      "源码提交包含私有环境或运行数据，拒绝打包",
    );
  const relevant = tracked.filter((line) => runtime(line.split("\t")[1] ?? ""));
  const dirty = git(
    root,
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
  )
    .split("\0")
    .filter((line) => line && runtime(line.slice(3).replaceAll("\\", "/")));
  if (dirty.length)
    throw new ReleaseError("SOURCE_DIRTY", "候选源码或测试存在未提交修改");
  return {
    commit,
    fingerprint: hash(relevant.join("\n")),
    branch: git(root, "branch", "--show-current"),
  };
}
