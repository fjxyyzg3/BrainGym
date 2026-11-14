import { spawn, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  chmodSync,
  statfsSync,
  lstatSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  assertNoLinks,
  isWithin,
  withoutControlCredentials,
} from "../../src/server/environment.js";
import { programFiles, files, hash } from "./paths.js";
import { ReleaseError } from "./process.js";

const helper = resolve(import.meta.dirname, "../release-windows.ps1");
export function windowsEnvironment() {
  return Object.fromEntries(
    Object.entries(withoutControlCredentials(process.env)).filter(
      ([name]) => name.toLowerCase() !== "psmodulepath",
    ),
  );
}
export function windows(action: string, args: string[]): void {
  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        helper,
        "-Action",
        action,
        ...args,
      ],
      {
        windowsHide: true,
        stdio: "pipe",
        timeout: 120000,
        env: windowsEnvironment(),
      },
    );
  } catch (error) {
    const detail = /RELEASE_WINDOWS_ERROR:([A-Za-z0-9,._:-]+)/.exec(
      String((error as { stderr?: unknown }).stderr),
    )?.[1];
    throw new ReleaseError(
      "FILESYSTEM_PROTECTION",
      "文件保护、备份或原子替换失败；未输出私有诊断",
      `${action}:${detail ?? "COMMAND_FAILED"}`,
    );
  }
}

export function privateDirectory(path: string) {
  assertNoLinks(path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform === "win32")
    windows("protect", ["-Path", resolve(path)]);
  else chmodSync(path, 0o700);
}

export async function guardConfiguration(
  path: string,
  digest: string,
): Promise<() => Promise<void>> {
  if (process.platform !== "win32")
    throw new ReleaseError(
      "PLATFORM_UNSUPPORTED",
      "正式配置保护当前要求 Windows",
    );
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helper,
      "-Action",
      "guard",
      "-Path",
      resolve(path),
      "-ExpectedHash",
      digest,
    ],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: windowsEnvironment(),
    },
  );
  let ready = false;
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => {
      child.stdin.end();
      reject(new ReleaseError("CONFIG_GUARD", "配置保护建立超时"));
    }, 10000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new ReleaseError("CONFIG_GUARD", "配置保护无法启动"));
    });
    child.once("exit", () => {
      if (!ready) {
        clearTimeout(timer);
        reject(new ReleaseError("CONFIG_GUARD", "配置已变化或不能保护"));
      }
    });
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("ready")) {
        ready = true;
        clearTimeout(timer);
        done();
      }
    });
  });
  return async () => {
    const exited = new Promise<void>((done) =>
      child.exitCode !== null ? done() : child.once("exit", () => done()),
    );
    child.stdin.end("release\n");
    await exited;
  };
}

export function copyProgram(source: string, destination: string) {
  assertNoLinks(source);
  assertNoLinks(destination);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const name of programFiles)
    if (existsSync(join(source, name))) {
      filesOrFile(join(source, name));
      cpSync(join(source, name), join(destination, name), {
        recursive: true,
        dereference: false,
      });
    }
}

export function programManifest(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of programFiles) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    assertNoLinks(path);
    if (lstatSync(path).isDirectory()) {
      for (const file of files(path))
        result[`${name}/${file}`] = hash(readFileSync(join(path, file)));
    } else result[name] = hash(readFileSync(path));
  }
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function filesOrFile(path: string) {
  assertNoLinks(path);
  if (readdirSafe(path)) files(path);
}
function readdirSafe(path: string) {
  try {
    readdirSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") return false;
    throw error;
  }
}

export function clearProgram(root: string) {
  assertNoLinks(root);
  for (const name of programFiles) {
    const path = resolve(root, name);
    if (!isWithin(root, path))
      throw new ReleaseError("PATH_INVALID", "程序清理范围无效");
    assertNoLinks(path);
    rmSync(path, { recursive: true, force: true });
  }
}

export function backupDatabase(database: string, destination: string) {
  assertNoLinks(database);
  if (!existsSync(database))
    throw new ReleaseError(
      "DATABASE_MISSING",
      "正式数据库不存在，拒绝创建新库冒充迁移",
    );
  const space = statfsSync(dirname(destination));
  const source = dirname(database);
  const required = files(source).reduce(
    (total, name) => total + lstatSync(join(source, name)).size,
    0,
  );
  if (Number(space.bavail) * Number(space.bsize) < required + 1024 * 1024 * 64)
    throw new ReleaseError("DISK_SPACE", "备份空间不足");
  if (process.platform !== "win32")
    throw new ReleaseError(
      "PLATFORM_UNSUPPORTED",
      "正式离线目录备份当前要求 Windows",
    );
  windows("snapshot", ["-Path", source, "-Destination", destination]);
}

export type Fingerprints = Record<string, Record<string, string>>;
export function databaseFingerprints(path: string): Fingerprints {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    if (
      Number(database.prepare("PRAGMA user_version").get()!.user_version) !== 1
    )
      throw new ReleaseError("SCHEMA_UNSUPPORTED", "正式数据库 schema 不兼容");
    const result: Fingerprints = {};
    const optional = ["corsi_results", "corsi_progress_resets"].filter(
      (table) =>
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table),
    );
    for (const table of [
      "users",
      "credentials",
      "sessions",
      "results",
      ...optional,
    ]) {
      result[table] = {};
      if (optional.includes(table)) result[table]["table-exists"] = "1";
      for (const row of database.prepare(`SELECT * FROM ${table}`).all()) {
        if (table === "sessions" && Number(row.expires_at) <= Date.now())
          continue;
        const key = hash(
          JSON.stringify(
            table === "results" || table === "corsi_results"
              ? [row.user_id, row.result_id]
              : table === "corsi_progress_resets"
                ? [row.user_id, row.game, row.version]
                : table === "users"
                  ? row.id
                  : table === "sessions"
                    ? row.token_hash
                    : row.user_id,
          ),
        );
        result[table][key] = hash(JSON.stringify(row));
      }
    }
    return result;
  } finally {
    database.close();
  }
}

export function assertPreserved(before: Fingerprints, after: Fingerprints) {
  for (const [table, rows] of Object.entries(before))
    for (const [key, value] of Object.entries(rows))
      if (after[table]?.[key] !== value)
        throw new ReleaseError("DATA_CHANGED", "既有正式数据指纹未能确认保留");
}
