import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chromium, expect } from "@playwright/test";
import { requirePublicOrigin } from "./wheelmaker-origin.mjs";

const origin = requirePublicOrigin(process.env.APP_ORIGIN),
  basePath = "/braingym/";
throw new Error(
  "Legacy public verification is retired; use isolated verification and read-only release checks",
);
const privatePath = resolve("data/wheelmaker-verification/private.json");
const fixture = JSON.parse(readFileSync(privatePath, "utf8"));
const formalRestart = fixture.stage === "formal-restart";
let stage = "reachability",
  browser;
try {
  const health = await fetch(`${origin}${basePath}api/health`, {
    signal: AbortSignal.timeout(10000),
  });
  assertStatus(health, 200);
  expect(await health.json()).toEqual({ ok: true });
  stage = "forwarded-address-cleaning";
  const remaining = [];
  for (const spoofedAddress of ["203.0.113.40", "198.51.100.80"]) {
    const response = await fetch(`${origin}${basePath}api/login`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Forwarded-For": spoofedAddress,
      },
      body: JSON.stringify({ token: "not-a-real-token" }),
      signal: AbortSignal.timeout(10000),
    });
    assertStatus(response, 401);
    remaining.push(Number(response.headers.get("x-ratelimit-remaining")));
  }
  expect(remaining[0] - remaining[1]).toBe(1);
  stage = formalRestart ? "pre-restart-browser-login" : "legacy-browser-login";
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (!executablePath)
    throw new Error("Chromium executable must be configured");
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const failedResources = [],
    escapedPaths = [],
    browserErrors = [];
  const isAsset = (request) =>
    ["script", "stylesheet", "image", "font"].includes(request.resourceType());
  page.on("requestfailed", (request) => {
    if (isAsset(request)) failedResources.push(new URL(request.url()).pathname);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && isAsset(response.request()))
      failedResources.push(new URL(response.url()).pathname);
  });
  page.on("pageerror", () => browserErrors.push(true));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === origin && !url.pathname.startsWith(basePath))
      escapedPaths.push(url.pathname);
  });
  await page.goto(`${origin}${basePath}`, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Token 登录", exact: true })
    .first()
    .click();
  await page.getByLabel("个人 Token", { exact: true }).waitFor();
  await page
    .getByLabel("个人 Token", { exact: true })
    .fill(fixture.identity.token);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const session = (await context.cookies()).find(
    (cookie) => cookie.name === "bg_session",
  );
  expect(session).toMatchObject({
    path: basePath,
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
  });
  stage = formalRestart ? "pre-restart-history" : "legacy-history";
  const before = await (
    await page.request.get(`${origin}${basePath}api/history`)
  ).json();
  expect(
    before.items.find(
      (item) => item.resultId === fixture.legacyResult.resultId,
    ),
  ).toEqual(fixture.legacyResult);
  stage = "new-browser-game";
  await page.goto(`${origin}${basePath}#n-back`);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("button", { name: "开始本局" }).click();
  await expect(
    page.getByRole("heading", { name: "记忆准备 1 / 2" }),
  ).toBeVisible();
  await page.clock.fastForward(81000);
  await expect(
    page.getByRole("heading", { name: "练习完成，做得不错。" }),
  ).toBeVisible();
  await expect(page.locator(".save-message")).toContainText("已保存到", {
    timeout: 15000,
  });
  const after = await (
    await page.request.get(`${origin}${basePath}api/history`)
  ).json();
  expect(after.total).toBe(before.total + 1);
  expect(
    after.items.find((item) => item.resultId === fixture.legacyResult.resultId),
  ).toEqual(fixture.legacyResult);
  const bests = await (
    await page.request.get(`${origin}${basePath}api/bests`)
  ).json();
  expect(
    bests.items.some((item) => item.resultId === fixture.legacyResult.resultId),
  ).toBe(true);
  mkdirSync(resolve("docs/verification/screenshots"), { recursive: true });
  await page.screenshot({
    path: resolve(
      "docs/verification/screenshots",
      formalRestart ? "wheelmaker-formal-public.png" : "wheelmaker-public.png",
    ),
    fullPage: true,
  });
  stage = "logout";
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Token 登录", exact: true }).first(),
  ).toBeVisible();
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "bg_session"),
  ).toBe(false);
  expect(
    (await page.request.get(`${origin}${basePath}api/history`)).status(),
  ).toBe(401);
  stage = "assets";
  expect(failedResources).toEqual([]);
  expect(escapedPaths).toEqual([]);
  expect(browserErrors).toEqual([]);
  await browser.close();
  browser = undefined;
  stage = "temporary-identity-cleanup";
  const database = new DatabaseSync(fixture.databasePath);
  try {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000");
    const user = database
      .prepare("SELECT id,name FROM users WHERE id=?")
      .get(fixture.identity.user.id);
    expect(user?.name).toBe(fixture.identity.user.name);
    expect(user?.name.startsWith("WheelMaker verification ")).toBe(true);
    expect(fixture.baseline.users.some((row) => row.id === user.id)).toBe(
      false,
    );
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of ["sessions", "credentials", "results"])
        database.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(user.id);
      database.prepare("DELETE FROM users WHERE id=?").run(user.id);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    stage = "original-data-preservation";
    expect(database.prepare("PRAGMA user_version").get().user_version).toBe(
      fixture.baseline.schema,
    );
    const fingerprint = (row) =>
      createHash("sha256").update(JSON.stringify(row)).digest("hex");
    for (const row of fixture.baseline.users)
      expect(
        fingerprint(
          database.prepare("SELECT * FROM users WHERE id=?").get(row.id),
        ),
      ).toBe(row.hash);
    for (const row of fixture.baseline.credentials)
      expect(
        fingerprint(
          database
            .prepare("SELECT * FROM credentials WHERE user_id=?")
            .get(row.user_id),
        ),
      ).toBe(row.hash);
    for (const row of fixture.baseline.results)
      expect(
        fingerprint(
          database
            .prepare("SELECT * FROM results WHERE user_id=? AND result_id=?")
            .get(row.user_id, row.result_id),
        ),
      ).toBe(row.hash);
  } finally {
    database.close();
  }
  const result = {
    passed: true,
    publicUrl: `${origin}${basePath}`,
    verificationMode: fixture.stage ?? "pre-upgrade",
    ...(formalRestart
      ? { preRestartToken: true, preRestartHistory: true }
      : { legacyToken: true, legacyHistory: true }),
    newGameSaved: true,
    secureCookie: true,
    logout: true,
    assetsWithinPrefix: true,
    forwardedHeaderCleaning: true,
    temporaryIdentityRemoved: true,
    originalDataPreserved: true,
  };
  writeFileSync(
    resolve(
      "data/wheelmaker-verification",
      formalRestart ? "formal-public-result.json" : "public-result.json",
    ),
    JSON.stringify(result, null, 2),
  );
  unlinkSync(privatePath);
  console.log(JSON.stringify({ ...result, publicUrl: "[private]" }));
} catch (error) {
  // Do not log Playwright action arguments, which may contain the test Token.
  console.error(`Public verification failed at ${stage} (${error.name})`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}

function assertStatus(response, expected) {
  if (response.status !== expected)
    throw new Error(`Unexpected HTTP status ${response.status}`);
}
