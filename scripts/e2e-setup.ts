import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { normalizeBasePath } from "../src/shared/paths.js";

export default async function setup() {
  const port = process.env.E2E_PORT ?? "3100",
    origin = `http://127.0.0.1:${port}`;
  const basePath = normalizeBasePath(process.env.E2E_BASE_PATH);
  if (process.env.E2E_REUSE_SERVER === "true") {
    const res = await fetch(`${origin}${basePath}api/health`);
    if (!res.ok) throw new Error("External verification server is not ready");
    return;
  }
  const child = spawn(process.execPath, ["dist/server/server/main.js"], {
    cwd: resolve("."),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: port,
      APP_ORIGIN: origin,
      DATABASE_PATH: process.env.E2E_DATABASE_PATH,
      COOKIE_SECURE: "false",
      NODE_ENV: "test",
      APP_BASE_PATH: basePath,
      WHEELMAKER_APP_MANAGED: "0",
    },
  });
  let diagnostics = "";
  child.stderr.on("data", (chunk) => {
    diagnostics += String(chunk);
  });
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise<void>((done) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
          done();
        }, 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          done();
        });
      });
    }
  };
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error(`Verification server exited: ${diagnostics}`);
    try {
      const response = await fetch(`${origin}${basePath}api/health`);
      if (response.ok) return stop;
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  await stop();
  throw new Error(`Verification server did not start: ${diagnostics}`);
}
