import { test as base, expect, chromium, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../../src/server/store.js";
import { normalizeBasePath } from "../../src/shared/paths.js";

const basePath = normalizeBasePath(process.env.E2E_BASE_PATH);
const screenshotDirectory = `test-results/screenshots${basePath === "/" ? "-root" : "-prefix"}`;
mkdirSync(screenshotDirectory, { recursive: true });

const test = base.extend<{
  accounts: {
    a: ReturnType<Store["createUser"]>;
    b: ReturnType<Store["createUser"]>;
  };
}>({
  accounts: async ({}, use) => {
    const store = new Store(process.env.E2E_DATABASE_PATH!);
    const a = store.createUser(`A-${randomUUID().slice(0, 6)}`),
      b = store.createUser(`B-${randomUUID().slice(0, 6)}`);
    store.close();
    await use({ a, b });
  },
});
async function login(page: Page, token: string) {
  const logout = page.getByRole("button", { name: "退出", exact: true });
  if (await logout.isVisible()) await logout.click();
  await page
    .getByRole("button", { name: "Token 登录", exact: true })
    .first()
    .click();
  await page.getByLabel("个人 Token", { exact: true }).fill(token);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function training(page: Page) {
  await page.goto(`${basePath}#n-back`);
  await expect(page.getByRole("button", { name: "开始本局" })).toBeVisible();
}
const clockPages = new WeakSet<Page>();
async function start(page: Page) {
  if (!clockPages.has(page)) {
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    clockPages.add(page);
  }
  await page.getByRole("button", { name: "开始本局" }).click();
  await expect(
    page.getByRole("heading", { name: "记忆准备 1 / 2" }),
  ).toBeVisible();
}
async function finish(page: Page) {
  await page.clock.fastForward(81000);
  await expect(
    page.getByRole("heading", { name: "练习完成，做得不错。" }),
  ).toBeVisible();
}

test("desktop guest completes a real game; login on result does not upload it", async ({
  page,
  accounts,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let uploads = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/results")) uploads++;
  });
  await page.goto(basePath);
  await expect(
    page.getByRole("heading", { name: /给大脑，留一段\s*专注时间。/ }),
  ).toBeVisible();
  await page.screenshot({
    path: join(screenshotDirectory, "desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await start(page);
  await finish(page);
  await expect(page.getByTestId("score")).toContainText("50.0");
  const counts = await Promise.all(
    ["tp", "fn", "fp", "tn"].map((x) => page.getByTestId(x).innerText()),
  );
  expect(counts.reduce((sum, x) => sum + Number(x), 0)).toBe(30);
  await login(page, accounts.a.token);
  await expect(
    page.getByText("游客练习：本局结果仅在此页面展示，不会保存。"),
  ).toBeVisible();
  expect(uploads).toBe(0);
  await expect(
    (await page.request.get(`${basePath}api/history`)).json(),
  ).resolves.toMatchObject({ total: 0 });
  expect(errors).toEqual([]);
});
test.describe("mobile device", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test("mobile touch and keyboard do not duplicate input; leaving a running page aborts", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(basePath);
    await page.screenshot({
      path: join(screenshotDirectory, "mobile.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await training(page);
    await start(page);
    await page.clock.fastForward(5000);
    await page.getByRole("button", { name: "匹配", exact: true }).tap();
    await expect(
      page.getByRole("button", { name: "已标记匹配" }),
    ).toBeDisabled();
    await page.clock.fastForward(2500);
    const scroll = await page.evaluate(() => scrollY);
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("button", { name: "已标记匹配" }),
    ).toBeDisabled();
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await page.screenshot({
      path: join(screenshotDirectory, "mobile-training.png"),
      fullPage: true,
    });
    await page.getByRole("link", { name: "个人记录", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "本局已结束" }),
    ).toContainText("本局已结束");
    await page.getByRole("link", { name: "训练大厅", exact: true }).click();
    await training(page);
    await expect(page.getByRole("button", { name: "开始本局" })).toBeVisible();
  });
});
test("network failure can retry manually; refresh drops pending result", async ({
  page,
  accounts,
}) => {
  await page.goto(basePath);
  await login(page, accounts.a.token);
  await training(page);
  let attempts = 0;
  await page.route("**/api/results", (route) => {
    attempts++;
    return route.abort("failed");
  });
  await start(page);
  await finish(page);
  await expect(page.locator(".save-message")).toContainText("未保存");
  await page.unroute("**/api/results");
  await page.route("**/api/results", (route) => {
    attempts++;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "SERVER_UNAVAILABLE",
        error: "服务暂不可用，请稍后重试",
      }),
    });
  });
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.locator(".save-message")).toContainText("服务暂不可用");
  await page.reload();
  await expect(page.getByRole("button", { name: "开始本局" })).toBeVisible();
  expect(attempts).toBe(2);
  await page.unroute("**/api/results");
  await start(page);
  await finish(page);
  await expect(page.locator(".save-message")).toContainText("已保存到");
  await page.getByRole("button", { name: "查看个人记录" }).click();
  await expect(page.getByText("共 1 局", { exact: true })).toBeVisible();
});
test("lost response retries idempotently and renders private history and best", async ({
  page,
  accounts,
}) => {
  await page.goto(basePath);
  await login(page, accounts.a.token);
  await training(page);
  await page.route("**/api/results", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await start(page);
  await finish(page);
  await expect(page.locator(".save-message")).toContainText("未保存");
  await page.unroute("**/api/results");
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.locator(".save-message")).toContainText("已保存到");
  const history = await (
    await page.request.get(`${basePath}api/history`)
  ).json();
  expect(history.total).toBe(1);
  await page.getByRole("button", { name: "查看个人记录" }).click();
  await expect(page.getByText("共 1 局", { exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toContainText("2-back");
});
test("shared-cookie account switch refuses wrong owner; original user can login and retry", async ({
  page,
  context,
  accounts,
}) => {
  await page.goto(basePath);
  await login(page, accounts.a.token);
  await training(page);
  await page.route("**/api/results", (route) => route.abort("failed"));
  await start(page);
  await finish(page);
  await expect(page.locator(".save-message")).toContainText("未保存");
  await page.unroute("**/api/results");
  const other = await context.newPage();
  await other.goto(basePath);
  await login(other, accounts.b.token);
  await page.bringToFront();
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.locator(".save-message")).toContainText(
    "当前账户与开局账户不同",
  );
  expect(
    (await (await page.request.get(`${basePath}api/history`)).json()).total,
  ).toBe(0);
  await page.getByRole("button", { name: "登录开局账户" }).click();
  await page.getByLabel("个人 Token", { exact: true }).fill(accounts.a.token);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.locator(".save-message")).toContainText("已保存到");
  expect(
    (await (await page.request.get(`${basePath}api/history`)).json()).total,
  ).toBe(1);
});
test("invalid session preserves completed result and original login can retry", async ({
  page,
  accounts,
}) => {
  await page.goto(basePath);
  await login(page, accounts.a.token);
  await training(page);
  await start(page);
  await page.request.post(`${basePath}api/logout`, {
    headers: { origin: new URL(page.url()).origin },
    data: {},
  });
  await finish(page);
  await expect(page.locator(".save-message")).toContainText("未保存");
  await page.getByRole("button", { name: "登录开局账户" }).click();
  await page.getByLabel("个人 Token", { exact: true }).fill(accounts.a.token);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.locator(".save-message")).toContainText("已保存到");
});
test("native browser background event aborts an authenticated game without saving", async ({
  baseURL,
}) => {
  const run = spawnSync(
    process.execPath,
    ["scripts/check-native-visibility.mjs"],
    {
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        PLAYWRIGHT_CHROMIUM_EXECUTABLE:
          process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
          chromium.executablePath(),
        VISIBILITY_BASE_URL: baseURL,
        NATIVE_VISIBILITY_DATABASE: process.env.E2E_DATABASE_PATH,
      },
    },
  );
  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout).toContain("PASS: native Chromium");
});
