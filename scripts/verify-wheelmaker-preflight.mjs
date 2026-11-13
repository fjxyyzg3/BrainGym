import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { requirePublicOrigin } from "./wheelmaker-origin.mjs";

const origin = requirePublicOrigin(process.env.APP_ORIGIN);
throw new Error(
  "Legacy public preflight is retired; use npm run rehearse and explicit release deploy",
);
const publicUrl = `${origin}/braingym/`;
const fixture = JSON.parse(
  readFileSync(resolve("data/wheelmaker-verification/private.json"), "utf8"),
);
const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
await new Promise((done) => server.close(done));
const identity = {
  appId: "braingym-process",
  instanceId: `public-preflight-${randomUUID()}`,
};
const child = spawn(process.execPath, ["dist/server/server/main.js"], {
  windowsHide: true,
  cwd: resolve("."),
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    APP_BASE_PATH: "/braingym/",
    APP_ORIGIN: origin,
    COOKIE_SECURE: "true",
    NODE_ENV: "production",
    DATABASE_PATH: fixture.databasePath,
    WHEELMAKER_APP_MANAGED: "1",
    WHEELMAKER_STATE_DIR:
      process.env.WHEELMAKER_STATE_DIR ?? resolve(homedir(), ".wheelmaker"),
    WHEELMAKER_SERVICE_ID: "braingym",
  },
});
let stderr = "",
  stdout = "",
  ready = false;
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  while (stdout.includes("\n")) {
    const newline = stdout.indexOf("\n"),
      frame = JSON.parse(stdout.slice(0, newline));
    stdout = stdout.slice(newline + 1);
    if (frame.type === "ready") ready = true;
  }
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  child.stdin.write(
    JSON.stringify({
      type: "request",
      requestId: 1,
      method: "initialize",
      protocol: 1,
      ...identity,
    }) + "\n",
  );
  const deadline = Date.now() + 30000;
  while (
    Date.now() < deadline &&
    (!ready || !stderr.includes(`Forwarding ready: ${publicUrl}`))
  ) {
    if (child.exitCode !== null)
      throw new Error("Preflight process exited before publication");
    await delay(100);
  }
  assert.ok(
    ready && stderr.includes(`Forwarding ready: ${publicUrl}`),
    "Publication not ready; inspect private Hub diagnostics",
  );
  const verification = spawn(
    process.execPath,
    ["scripts/verify-wheelmaker-public.mjs"],
    {
      cwd: resolve("."),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );
  verification.stdout.on("data", (chunk) => process.stdout.write(chunk));
  verification.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const exitCode = await new Promise((done) => verification.once("exit", done));
  assert.equal(exitCode, 0, "Public preflight verification failed");
  writeFileSync(
    resolve("data/wheelmaker-verification/preflight-result.json"),
    JSON.stringify(
      {
        passed: true,
        managedBy: "temporary verification controller",
        pid: child.pid,
        target: `http://127.0.0.1:${port}`,
        formalMonitorAcceptance: "pending Reload",
      },
      null,
      2,
    ),
  );
} finally {
  if (child.exitCode === null) {
    child.stdin.write(
      JSON.stringify({
        type: "request",
        requestId: 2,
        method: "shutdown",
        ...identity,
      }) + "\n",
    );
    child.stdin.end();
    const deadline = Date.now() + 11000;
    while (child.exitCode === null && Date.now() < deadline) await delay(20);
    if (child.exitCode === null) child.kill();
  }
}
