import { spawn, execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { withoutControlCredentials } from "../../src/server/environment.js";

export class ReleaseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

export function assertNodeRuntime(executable: string): void {
  try {
    const actual = execFileSync(
      executable,
      ["-p", "JSON.stringify([process.version,process.platform,process.arch])"],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
        stdio: ["ignore", "pipe", "ignore"],
        env: withoutControlCredentials(process.env),
      },
    ).trim();
    if (
      actual !==
      JSON.stringify([process.version, process.platform, process.arch])
    )
      throw new Error("runtime");
  } catch {
    throw new ReleaseError(
      "RUNTIME_CHANGED",
      "托管 Node 运行环境与已演练候选不一致",
    );
  }
}

export function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch {
    throw new ReleaseError("SOURCE_INVALID", "无法核验 Git 来源");
  }
}

export async function run(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  output = false,
): Promise<void> {
  await new Promise<void>((done, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: output ? "inherit" : "ignore",
    });
    child.once("error", () =>
      reject(new ReleaseError("COMMAND_FAILED", "验证命令无法启动")),
    );
    child.once("exit", (code) =>
      code === 0
        ? done()
        : reject(
            new ReleaseError(
              "COMMAND_FAILED",
              "验证命令失败；正式实例未因此更新",
            ),
          ),
    );
  });
}

export function npmCli(): string {
  return (
    process.env.npm_execpath ??
    resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
  );
}

export function runNpm(args: string[], cwd: string, env = process.env) {
  return run(process.execPath, [npmCli(), ...args], cwd, env, true);
}

export const delay = (ms: number) =>
  new Promise<void>((done) => setTimeout(done, ms));
