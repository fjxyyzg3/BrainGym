import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Store } from "../dist/server/server/store.js";
import { normalizeBasePath } from "../dist/server/shared/paths.js";

const basePath = normalizeBasePath(process.env.E2E_BASE_PATH);

// Use raw CDP: Playwright deliberately forces pages to remain visible. This
// checks the browser's real tab lifecycle without changing document properties.
const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executable)
  throw new Error(
    "Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a Chromium executable",
  );
const profile = mkdtempSync(join(tmpdir(), "braingym-visibility-"));
const child = spawn(
  executable,
  [
    "--headless=new",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
let socket;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try {
      port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split(
        "\n",
      )[0];
      break;
    } catch {
      await delay(100);
    }
  }
  if (!port)
    throw new Error("Chromium did not expose its verification endpoint");
  const { webSocketDebuggerUrl } = await (
    await fetch(`http://127.0.0.1:${port}/json/version`)
  ).json();
  socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const task = pending.get(message.id);
    if (task) {
      pending.delete(message.id);
      message.error
        ? task.reject(new Error(message.error.message))
        : task.resolve(message.result);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetId } = await send("Target.createTarget", {
    url: `${new URL(process.env.VISIBILITY_BASE_URL ?? "http://127.0.0.1:3000").origin}${basePath}#${process.env.VISIBILITY_GAME === "spatial-color-number-n-back" ? "triple-n-back" : process.env.VISIBILITY_GAME === "spatial-color-n-back" ? "color-n-back" : "n-back"}`,
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const evaluate = async (expression) =>
    (
      await send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      )
    ).result.value;
  for (let i = 0; i < 100; i++) {
    if (await evaluate("!!document.querySelector('.start-session')")) break;
    await delay(100);
  }
  let uploads = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (
      message.method === "Network.requestWillBeSent" &&
      message.params.request.url.endsWith("/api/results")
    )
      uploads++;
  });
  await send("Network.enable", {}, sessionId);
  if (process.env.NATIVE_VISIBILITY_DATABASE) {
    const store = new Store(process.env.NATIVE_VISIBILITY_DATABASE);
    const account = store.createUser("Native visibility verification");
    store.close();
    const loggedIn = await evaluate(
      `fetch(${JSON.stringify(`${basePath}api/login`)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(account.token)}})}).then(r=>r.ok)`,
    );
    assert.equal(loggedIn, true);
    await send("Page.reload", { ignoreCache: true }, sessionId);
    for (let i = 0; i < 100; i++) {
      if (
        await evaluate(
          "!!document.querySelector('.user-name') && !!document.querySelector('.start-session')",
        )
      )
        break;
      await delay(100);
    }
    assert.equal(
      await evaluate("!!document.querySelector('.user-name')"),
      true,
    );
  }
  await send("Target.activateTarget", { targetId });
  await evaluate(
    "window.__visibilityEvents=[]; document.addEventListener('visibilitychange',()=>window.__visibilityEvents.push(document.visibilityState)); document.querySelector('.start-session').click(); true",
  );
  for (let i = 0; i < 50; i++) {
    if (await evaluate("!!document.querySelector('.play-page')")) break;
    await delay(100);
  }
  assert.equal(await evaluate("!!document.querySelector('.play-page')"), true);
  const other = await send("Target.createTarget", {
    url: "about:blank",
    newWindow: false,
  });
  await send("Target.activateTarget", { targetId: other.targetId });
  let result;
  for (let i = 0; i < 50; i++) {
    result = await evaluate(
      "({events:window.__visibilityEvents,warning:document.querySelector('.warning')?.textContent,phase:document.visibilityState})",
    );
    if (result.warning) break;
    await delay(100);
  }
  assert.ok(
    result.events.includes("hidden"),
    "Browser did not send a native hidden event",
  );
  assert.match(result.warning, /本局已结束/);
  assert.equal(
    await evaluate("!!document.querySelector('.save-message')"),
    false,
  );
  assert.equal(uploads, 0);
  console.log(
    "PASS: native Chromium tab visibilitychange -> interrupted game, no saved result",
  );
  await send("Browser.close").catch(() => {});
} finally {
  socket?.close();
  if (child.exitCode === null) child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 3000).unref();
  });
  rmSync(profile, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}
