import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Store } from "../dist/server/server/store.js";
import { normalizeBasePath } from "../dist/server/shared/paths.js";

const basePath = normalizeBasePath(process.env.E2E_BASE_PATH);
const corsi = process.env.VISIBILITY_GAME?.startsWith("corsi-");
const stroop = process.env.VISIBILITY_GAME === "stroop";
const rotation = process.env.VISIBILITY_GAME === "mental-rotation";
const prefix = rotation ? "rotation" : "stroop";
const startSelector =
  stroop || rotation ? `[data-testid="${prefix}-start"]` : ".start-session";
const playSelector = stroop || rotation ? `.${prefix}-training` : ".play-page";
const corsiPhase = process.env.VISIBILITY_CORSI_PHASE ?? "presenting";

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
    url: `${new URL(process.env.VISIBILITY_BASE_URL ?? "http://127.0.0.1:3000").origin}${basePath}#${rotation ? "mental-rotation" : stroop ? "stroop" : corsi ? (process.env.VISIBILITY_GAME === "corsi-backward" ? "corsi-backward" : "corsi") : process.env.VISIBILITY_GAME === "spatial-color-number-n-back" ? "triple-n-back" : process.env.VISIBILITY_GAME === "spatial-color-n-back" ? "color-n-back" : "n-back"}`,
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
    if (
      await evaluate(
        `!!document.querySelector(${JSON.stringify(stroop || rotation ? `.${prefix}-start-actions` : startSelector)})`,
      )
    )
      break;
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
    // Corsi adds six lifecycle cases. Seed their real sessions in the isolated
    // database so they don't exhaust unrelated tests' HTTP login budget.
    const fixtureSession =
      corsi || stroop || rotation
        ? store.login(account.token, Date.now()).session
        : null;
    store.close();
    if (fixtureSession) {
      const cookie = await send(
        "Network.setCookie",
        {
          name: "bg_session",
          value: fixtureSession,
          path: basePath,
          httpOnly: true,
          sameSite: "Strict",
          secure: false,
          url:
            new URL(process.env.VISIBILITY_BASE_URL ?? "http://127.0.0.1:3000")
              .origin + basePath,
        },
        sessionId,
      );
      assert.equal(cookie.success, true);
    } else {
      const loggedIn = await evaluate(
        `fetch(${JSON.stringify(`${basePath}api/login`)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(account.token)}})}).then(r=>r.ok)`,
      );
      assert.equal(loggedIn, true);
    }
    await send("Page.reload", { ignoreCache: true }, sessionId);
    for (let i = 0; i < 100; i++) {
      if (
        await evaluate(
          `!!document.querySelector('.user-name') && !!document.querySelector(${JSON.stringify(startSelector)})`,
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
  const other = await send("Target.createTarget", {
    url: "about:blank",
    newWindow: false,
  });
  await send("Target.activateTarget", { targetId });
  if (corsi) {
    // A fresh Chrome profile stalls its first frames during startup. Wait for
    // stable foreground frames before the game; keep its 100ms rule intact.
    await evaluate(
      "Promise.all([document.fonts.ready,navigator.serviceWorker.ready]).then(()=>true)",
    );
    await evaluate(
      "new Promise(resolve=>{const begin=performance.now();let stable=begin,last=begin;requestAnimationFrame(function frame(t){if(t-last>100)stable=t;last=t;if(t-begin>=2000&&t-stable>=500)resolve(true);else requestAnimationFrame(frame)})})",
    );
  }
  await evaluate(
    `window.__visibilityEvents=[]; document.addEventListener('visibilitychange',()=>window.__visibilityEvents.push(document.visibilityState)); document.querySelector(${JSON.stringify(startSelector)}).click(); true`,
  );
  for (let i = 0; i < 50; i++) {
    if (
      await evaluate(
        `!!document.querySelector(${JSON.stringify(playSelector)})`,
      )
    )
      break;
    await delay(100);
  }
  assert.equal(
    await evaluate(`!!document.querySelector(${JSON.stringify(playSelector)})`),
    true,
  );
  if (stroop || rotation) {
    const phase =
      (rotation
        ? process.env.VISIBILITY_ROTATION_PHASE
        : process.env.VISIBILITY_STROOP_PHASE) ?? "question";
    const clickAnswer = async () => {
      const clicked = await evaluate(
        rotation
          ? `(()=>{const paths=Array.from(document.querySelectorAll('[data-testid="rotation-pair"] path'));if(paths.length!==2)return false;const areas=paths.map(path=>{const p=Array.from(path.getAttribute('d').matchAll(/[ML](-?[\\d.]+),(-?[\\d.]+)/g),m=>[Number(m[1]),Number(m[2])]);return p.reduce((sum,[x,y],i)=>{const[a,b]=p[(i+1)%p.length];return sum+x*b-y*a;},0)/2;});const name=areas[0]*areas[1]<0?'镜像':'仅旋转';const button=Array.from(document.querySelectorAll('.rotation-answers button')).find(b=>b.textContent===name);if(!button||button.getAttribute('aria-disabled')==='true')return false;button.click();return true;})()`
          : `(()=>{const word=document.querySelector('[data-testid="stroop-word"]');if(!word)return false;const color=getComputedStyle(word).color;const names={'rgb(255, 139, 148)':'红','rgb(118, 188, 255)':'蓝','rgb(104, 217, 173)':'绿','rgb(246, 214, 93)':'黄'};const button=Array.from(document.querySelectorAll('.stroop-answers button')).find(x=>x.textContent===names[color]);if(!button||button.getAttribute('aria-disabled')==='true')return false;button.click();return true;})()`,
      );
      return clicked;
    };
    const answers =
      phase === "complete"
        ? rotation
          ? 32
          : 40
        : phase === "feedback"
          ? 1
          : 0;
    for (let index = 0; index < answers; index++) {
      let answered = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        if (await clickAnswer()) {
          answered = true;
          break;
        }
        await delay(10);
      }
      assert.equal(answered, true, `${prefix} did not deliver a live question`);
    }
    if (answers)
      assert.equal(
        await evaluate(
          `!!document.querySelector('[data-testid=${prefix}-feedback]')`,
        ),
        true,
      );
    await send("Target.activateTarget", { targetId: other.targetId });
    await delay(200);
    assert.equal(
      await evaluate("window.__visibilityEvents.includes('hidden')"),
      true,
    );
    if (phase === "complete") {
      assert.equal(
        await evaluate(
          `!!document.querySelector('[data-testid=${prefix}-result]')`,
        ),
        true,
      );
      assert.equal(
        await evaluate(
          `!!document.querySelector('[data-testid=${prefix}-abort]')`,
        ),
        false,
      );
      assert.equal(uploads, 1);
    } else {
      assert.equal(
        await evaluate(
          `!!document.querySelector('[data-testid=${prefix}-abort]')`,
        ),
        true,
      );
      assert.equal(uploads, 0);
    }
    console.log(
      `PASS: native ${prefix} ${phase} -> hidden, ${phase === "complete" ? "complete result retained with one upload" : "aborted without upload"}`,
    );
    await send("Browser.close").catch(() => {});
  } else {
    if (corsi) {
      const expectedText = corsiPhase === "presenting" ? "请记忆" : "复现";
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (
          await evaluate(
            `document.querySelector('[data-testid="corsi-phase"]')?.textContent.includes(${JSON.stringify(expectedText)}) ?? false`,
          )
        ) {
          ready = true;
          break;
        }
        await delay(30);
      }
      assert.equal(
        ready,
        true,
        `Corsi did not reach the requested foreground phase: ${JSON.stringify(await evaluate("({phase:document.querySelector('[data-testid=corsi-phase]')?.textContent,warning:document.querySelector('.warning')?.textContent,visibility:document.visibilityState,events:window.__visibilityEvents})"))}`,
      );
      if (corsiPhase === "feedback") {
        await evaluate(
          "Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='记不住了').click(); true",
        );
        assert.equal(
          await evaluate(
            "!!document.querySelector('[data-testid=corsi-feedback]')",
          ),
          true,
        );
      }
      assert.equal(
        await evaluate("!!document.querySelector('.corsi-aborted')"),
        false,
      );
    }
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
    assert.match(result.warning, corsi ? /本局未计入/ : /本局已结束/);
    assert.equal(
      await evaluate("!!document.querySelector('.save-message')"),
      false,
    );
    assert.equal(uploads, 0);
    console.log(
      "PASS: native Chromium tab visibilitychange -> interrupted game, no saved result",
    );
    await send("Browser.close").catch(() => {});
  }
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
