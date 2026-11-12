import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve, sep } from "node:path";
import { chromium } from "@playwright/test";
import { createServer as createViteServer } from "vite";
import { Store } from "../dist/server/server/store.js";

const root = resolve("data/wheelmaker-verification");
const directory = resolve(root, `development-${randomUUID()}`);
assert.ok(directory.startsWith(root + sep));
await mkdir(directory, { recursive: true });
const database = resolve(directory, "development.sqlite");
const store = new Store(database);
const account = store.createUser("Development verification");
store.close();
const children = [];
let browser;
let vite;
let stage = "listeners";
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function availablePort(port = 0) {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", done);
  });
  const selected = server.address().port;
  await new Promise((done) => server.close(done));
  return selected;
}
function start(args, env) {
  const child = spawn(process.execPath, args, {
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
  let startError;
  child.once("error", (error) => {
    startError = error;
  });
  children.push(child);
  return () => {
    if (startError || child.exitCode !== null || child.signalCode !== null)
      throw new Error("Verification child stopped before readiness");
  };
}
async function ready(url, check) {
  for (let i = 0; i < 100; i++) {
    check();
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("Verification listener did not become ready");
}
try {
  const apiPort = await availablePort();
  const vitePort = await availablePort();
  const origin = `http://127.0.0.1:${vitePort}`;
  const checkApi = start(["--import", "tsx", "src/server/main.ts"], {
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    APP_ORIGIN: origin,
    APP_BASE_PATH: "/",
    WHEELMAKER_APP_MANAGED: "0",
    DATABASE_PATH: database,
    COOKIE_SECURE: "false",
    NODE_ENV: "test",
  });
  await ready(`http://127.0.0.1:${apiPort}/api/health`, checkApi);
  // Keep the repository's Vite config; isolate only the listener and proxy ports.
  vite = await createViteServer({
    server: {
      host: "127.0.0.1",
      port: vitePort,
      strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${apiPort}` },
    },
  });
  await vite.listen();
  await ready(`${origin}/api/health`, checkApi);
  stage = "browser";
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.name));
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Token 登录", exact: true })
    .first()
    .click();
  await page.getByLabel("个人 Token", { exact: true }).fill(account.token);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await (await page.request.get(`${origin}/api/me`)).json()).user.id,
    account.user.id,
  );
  stage = "game";
  await page.goto(`${origin}/#n-back`);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("button", { name: "开始本局" }).click();
  await page.getByRole("heading", { name: "记忆准备 1 / 2" }).waitFor();
  await page.clock.fastForward(81000);
  await page.getByRole("heading", { name: "练习完成，做得不错。" }).waitFor();
  await page.getByText(/已保存到/).waitFor();
  assert.equal(
    (await (await page.request.get(`${origin}/api/history`)).json()).total,
    1,
  );
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page
    .getByRole("button", { name: "Token 登录", exact: true })
    .first()
    .waitFor();
  assert.equal((await page.request.get(`${origin}/api/me`)).status(), 401);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real Vite proxy, Token login, game upload, history and logout",
  );
} catch {
  console.error(
    `Development verification failed at ${stage}; credentials omitted.`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await vite?.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      for (
        let i = 0;
        i < 40 && child.exitCode === null && child.signalCode === null;
        i++
      )
        await delay(50);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  }
  await rm(directory, { recursive: true, force: true });
}
