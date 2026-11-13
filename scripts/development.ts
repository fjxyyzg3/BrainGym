import { spawn } from "node:child_process";
import { developmentEnvironment } from "../src/server/environment.js";

const [mode, ...args] = process.argv.slice(2);
try {
  const env = developmentEnvironment(
    process.env,
    process.cwd(),
    mode === "preview",
  );
  const command =
    mode === "cli"
      ? ["--import", import.meta.resolve("tsx"), "src/server/cli.ts", ...args]
      : mode === "web"
        ? ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"]
        : mode === "preview"
          ? ["dist/server/server/main.js"]
          : mode === "api"
            ? [
                "--import",
                import.meta.resolve("tsx"),
                "--watch",
                "src/server/main.ts",
              ]
            : undefined;
  if (!command) throw new Error("开发入口应为 api、web、preview 或 cli");
  console.error(
    `BrainGym environment=development database=${env.DATABASE_PATH}`,
  );
  const child = spawn(process.execPath, command, {
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  child.once("error", () => {
    console.error("开发进程无法启动");
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      child.kill(signal);
    });
} catch (error) {
  console.error(error instanceof Error ? error.message : "开发配置无效");
  process.exitCode = 1;
}
