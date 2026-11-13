import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";

export const delay = (ms: number) =>
  new Promise<void>((done) => setTimeout(done, ms));
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
export async function processFixture(
  t: { after(fn: () => unknown): void },
  managed = true,
) {
  const directory = mkdtempSync(join(tmpdir(), "braingym-process-"));
  const port = await freePort();
  const basePath = managed ? "/braingym/" : "/";
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/server/main.ts"],
    {
      cwd: resolve("."),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        BRAINGYM_ENV: "test",
        WHEELMAKER_APP_MANAGED: managed ? "1" : "0",
        WHEELMAKER_STATE_DIR: join(directory, "hub"),
        WHEELMAKER_SERVICE_ID: "braingym",
        APP_BASE_PATH: basePath,
        APP_ORIGIN: "https://apps.example.com",
        COOKIE_SECURE: "true",
        HOST: "127.0.0.1",
        PORT: String(port),
        DATABASE_PATH: join(directory, "store.sqlite"),
      },
    },
  );
  const frames: Record<string, any>[] = [];
  const invalid: string[] = [];
  let pending = "",
    stderr = "";
  child.on("error", (error) => {
    stderr += error.message;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on("data", (chunk) => {
    pending += chunk.toString();
    while (pending.includes("\n")) {
      const position = pending.indexOf("\n");
      const line = pending.slice(0, position);
      pending = pending.slice(position + 1);
      try {
        frames.push(JSON.parse(line));
      } catch {
        invalid.push(line);
      }
    }
  });
  const waitFrame = async (
    predicate: (frame: Record<string, any>) => boolean,
    timeout = 3500,
  ) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (managed && invalid.length)
        assert.fail(
          `stdout is not protocol JSON: ${invalid[0]?.slice(0, 160)}`,
        );
      const frame = frames.find(predicate);
      if (frame) return frame;
      if (child.exitCode !== null)
        assert.fail(
          `Process exited before expected frame: ${stderr.slice(0, 300)}`,
        );
      await delay(10);
    }
    assert.fail(
      `Expected control frame was not emitted: ${stderr.slice(0, 300)}`,
    );
  };
  const waitExit = async (timeout = 3500) => {
    const deadline = Date.now() + timeout;
    while (
      child.exitCode === null &&
      child.signalCode === null &&
      Date.now() < deadline
    )
      await delay(10);
    assert.ok(
      child.exitCode !== null || child.signalCode !== null,
      "Process did not exit within deadline",
    );
    return child.exitCode;
  };
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end();
      await delay(100);
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await waitExit();
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const identity = {
    appId: "braingym-process",
    instanceId: "test-instance-本次",
  };
  const send = (
    method: string,
    requestId: number,
    extra: Record<string, unknown> = {},
  ) =>
    child.stdin.write(
      JSON.stringify({
        type: "request",
        method,
        requestId,
        ...identity,
        ...extra,
      }) + "\n",
    );
  return {
    child,
    directory,
    port,
    basePath,
    frames,
    invalid,
    identity,
    send,
    waitFrame,
    waitExit,
    get stderr() {
      return stderr;
    },
  };
}
