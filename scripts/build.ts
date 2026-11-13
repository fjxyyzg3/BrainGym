import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withoutControlCredentials } from "../src/server/environment.js";

export function assertBuildSafe(
  cwd: string,
  productionRoot = "D:/Apps/BrainGym",
) {
  if (!existsSync(join(cwd, "data/braingym.sqlite"))) return;
  let root: string;
  try {
    root = dirname(
      resolve(
        cwd,
        execFileSync("git", ["rev-parse", "--git-common-dir"], {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim(),
      ),
    );
  } catch {
    return;
  }
  if (resolve(cwd).toLowerCase() !== root.toLowerCase()) return;
  try {
    if (
      JSON.parse(
        readFileSync(join(productionRoot, "braingym-release.json"), "utf8"),
      ).owner === "braingym-process"
    )
      return;
  } catch {}
  throw new Error(
    "首次正式迁移尚未确认，禁止覆盖原仓库 dist；请在独立 worktree 或候选目录构建并显式发布",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    assertBuildSafe(process.cwd());
    for (const args of [
      ["node_modules/vite/bin/vite.js", "build"],
      ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.json"],
    ]) {
      const result = spawnSync(process.execPath, args, {
        stdio: "inherit",
        windowsHide: true,
        env: withoutControlCredentials(process.env),
      });
      if (result.status !== 0) throw new Error("构建命令失败");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "构建失败");
    process.exitCode = 1;
  }
}
