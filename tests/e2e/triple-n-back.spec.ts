import { test as base, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { buildApp } from "../../src/server/app.js";
import { Store } from "../../src/server/store.js";
import { normalizeBasePath } from "../../src/shared/paths.js";

const basePath = normalizeBasePath(process.env.E2E_BASE_PATH);
const databasePath = resolve(
  "data",
  `e2e-triple-${process.pid}-${randomUUID()}.sqlite`,
);
// Each suite uses a real isolated server so UI logins do not consume another
// suite's production-equivalent IP budget. No rate limit is disabled or mocked.
const test = base.extend<{}, { tripleServer: string }>({
  tripleServer: [
    async ({}, use) => {
      const store = new Store(databasePath);
      const settings = {
        store,
        origin: "http://127.0.0.1",
        basePath,
        staticRoot: resolve("dist/client"),
      };
      const app = await buildApp(settings);
      try {
        const origin = await app.listen({ host: "127.0.0.1", port: 0 });
        settings.origin = origin;
        await use(origin);
      } finally {
        await app.close();
        store.close();
        for (const suffix of ["", "-wal", "-shm"])
          rmSync(databasePath + suffix, { force: true });
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ tripleServer }, use) => {
    await use(tripleServer);
  },
});
const title = "位置＋颜色＋数字 N-back";
const mode = "spatial-color-number-n-back";
const names = ["位置匹配", "颜色匹配", "数字匹配"];
function account() {
  const store = new Store(databasePath);
  try {
    return store.createUser(`Triple-${randomUUID().slice(0, 6)}`);
  } finally {
    store.close();
  }
}
async function login(page: Page, token: string) {
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
async function start(page: Page) {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("button", { name: "开始本局", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "记忆准备 1 / 2" }),
  ).toBeVisible();
}
async function finish(page: Page) {
  await page.clock.fastForward(81000);
  await expect(page.getByTestId("score")).toContainText("50.0");
}

test("triple mode has an independent lobby entry and three response buttons", async ({
  page,
}) => {
  await page.goto(basePath);
  const card = page.getByRole("article", { name: title, exact: true });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始本局", exact: true }).click();
  for (const name of ["位置匹配", "颜色匹配", "数字匹配"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
});

test("visible triple stimuli drive correct independent answers, scores, storage and record navigation", async ({
  page,
}) => {
  const a = account();
  await page.goto(`${basePath}#triple-n-back`);
  await login(page, a.token);
  await page.screenshot({
    path: "test-results/triple-desktop-setup.png",
    fullPage: true,
  });
  const contrasts = await page
    .locator(".color-palette i")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const luminance = (value: string) => {
          const rgb = value
            .match(/\d+/g)!
            .slice(0, 3)
            .map((x) => {
              const s = Number(x) / 255;
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const style = getComputedStyle(element);
        const background = luminance(style.backgroundColor),
          text = luminance(style.color);
        return (
          (Math.max(background, text) + 0.05) /
          (Math.min(background, text) + 0.05)
        );
      }),
    );
  expect(contrasts).toHaveLength(6);
  expect(Math.min(...contrasts)).toBeGreaterThanOrEqual(4.5);
  await start(page);
  const stimuli: { cell: string; color: string; number: string }[] = [];
  for (let i = 0; i < 32; i++) {
    const cell = page.locator(".cell.lit");
    await expect(cell).toHaveCount(1);
    const number = await cell.innerText();
    expect(number).toMatch(/^[1-9]$/);
    stimuli.push({
      cell: (await cell.getAttribute("data-testid"))!,
      color: await cell.evaluate((x) => getComputedStyle(x).backgroundColor),
      number,
    });
    if (i >= 2)
      for (const [j, key] of (["cell", "color", "number"] as const).entries())
        if (stimuli[i][key] === stimuli[i - 2][key])
          await page.keyboard.press(["f", "j", "k"][j]);
    if (i === 2)
      await page.screenshot({
        path: "test-results/triple-desktop-playing.png",
        fullPage: true,
      });
    await page.clock.fastForward(2500);
  }
  await expect(page.getByTestId("score")).toContainText("100.0");
  for (const channel of ["position", "color", "number"])
    await expect(page.getByTestId(`${channel}-score`)).toHaveText("100.0 分");
  await expect(page.locator(".save-message")).toContainText("已保存到");
  await page.screenshot({
    path: "test-results/triple-desktop-result.png",
    fullPage: true,
  });
  const history = await (
    await page.request.get(`${basePath}api/history?game=${mode}`)
  ).json();
  expect(history.total).toBe(1);
  expect(history.items[0].score).toBe(100);
  for (const channel of ["position", "color", "number"])
    expect(history.items[0][channel].fn + history.items[0][channel].fp).toBe(0);
  await page.getByRole("button", { name: "查看个人记录", exact: true }).click();
  const modes = page.getByRole("group", { name: "记录模式" });
  await expect(
    modes.getByRole("button", { name: title, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const word of ["位置", "颜色", "数字"])
    await expect(page.getByRole("table")).toContainText(word);
  await page.screenshot({
    path: "test-results/triple-desktop-records.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "个人记录", exact: true }).click();
  await expect(
    modes.getByRole("button", { name: "空间 N-back", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("F J K are independent, blank accepts answers, K repeat does not cross rounds and navigation aborts", async ({
  page,
}) => {
  await page.goto(`${basePath}#triple-n-back`);
  await start(page);
  const buttons = names.map((name) =>
    page.getByRole("button", { name, exact: true }),
  );
  for (const button of buttons) await expect(button).toBeDisabled();
  await page.keyboard.press("k");
  await page.clock.fastForward(5700);
  await expect(page.locator(".cell.lit")).toHaveCount(0);
  await expect(page.locator(".stimulus-number")).toHaveCount(0);
  await expect(page.locator(".board")).toHaveAttribute(
    "aria-label",
    "九宫格留空",
  );
  await page.keyboard.down("k");
  await page.keyboard.press("f");
  await expect(buttons[1]).toBeEnabled();
  await buttons[1].click();
  for (const button of buttons)
    await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: "test-results/triple-desktop-blank-marked.png",
    fullPage: true,
  });
  await page.clock.fastForward(2500);
  await page.keyboard.down("k");
  await expect(buttons[2]).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.up("k");
  await page.keyboard.press("k");
  await expect(buttons[2]).toHaveAttribute("aria-pressed", "true");
  await page.goto(`${basePath}#color-n-back`);
  await expect(
    page.getByRole("heading", { name: "位置＋颜色 N-back", exact: true }),
  ).toBeVisible();
  await page.goto(`${basePath}#triple-n-back`);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("score")).toHaveCount(0);
});

test("triple guest result remains local after login", async ({ page }) => {
  let uploads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/results")) uploads++;
  });
  await page.goto(`${basePath}#triple-n-back`);
  await start(page);
  await finish(page);
  for (const channel of ["position", "color", "number"])
    await expect(page.getByTestId(`${channel}-score`)).toHaveText("50.0 分");
  await login(page, account().token);
  expect(uploads).toBe(0);
});

test("lost triple save response stays idempotent and cross-tab account retry is refused", async ({
  page,
  context,
}) => {
  const a = account(),
    b = account();
  await page.goto(`${basePath}#triple-n-back`);
  await login(page, a.token);
  await page.route("**/api/results", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await start(page);
  await finish(page);
  await expect(page.locator(".save-message")).toContainText("未保存");
  await page.unroute("**/api/results");
  const other = await context.newPage();
  await other.goto(basePath);
  await other.getByRole("button", { name: "退出", exact: true }).click();
  await login(other, b.token);
  await page.bringToFront();
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.locator(".save-message")).toContainText(
    "当前账户与开局账户不同",
  );
  expect(
    (
      await (
        await page.request.get(`${basePath}api/history?game=${mode}`)
      ).json()
    ).total,
  ).toBe(0);
  await page.getByRole("button", { name: "登录开局账户" }).click();
  await page.getByLabel("个人 Token", { exact: true }).fill(a.token);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.locator(".save-message")).toContainText("已保存到");
  expect(
    (
      await (
        await page.request.get(`${basePath}api/history?game=${mode}`)
      ).json()
    ).total,
  ).toBe(1);
});

test("invalid triple session preserves current result for original account retry", async ({
  page,
}) => {
  const a = account();
  await page.goto(`${basePath}#triple-n-back`);
  await login(page, a.token);
  await start(page);
  await page.request.post(`${basePath}api/logout`, {
    headers: { origin: new URL(page.url()).origin },
    data: {},
  });
  await finish(page);
  await expect(page.locator(".save-message")).toContainText("未保存");
  await page.getByRole("button", { name: "登录开局账户" }).click();
  await page.getByLabel("个人 Token", { exact: true }).fill(a.token);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.locator(".save-message")).toContainText("已保存到");
});

test("empty triple records choose correct training and reject stale mode responses", async ({
  page,
}) => {
  await page.goto(basePath);
  await login(page, account().token);
  await page.getByRole("link", { name: "个人记录", exact: true }).click();
  const modes = page.getByRole("group", { name: "记录模式" });
  await modes.getByRole("button", { name: title, exact: true }).click();
  await page.getByRole("button", { name: "开始第一局" }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "个人记录", exact: true }).click();
  const held: (() => Promise<void>)[] = [];
  await page.route("**/api/history?**", async (route) => {
    const response = await route.fetch();
    if (
      new URL(route.request().url()).searchParams.get("game") ===
      "spatial-n-back"
    )
      held.push(async () => {
        await route.fulfill({ response });
      });
    else await route.fulfill({ response });
  });
  await modes.getByRole("button", { name: title, exact: true }).click();
  await modes.getByRole("button", { name: "空间 N-back", exact: true }).click();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await modes.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByText("共 0 局", { exact: true })).toBeVisible();
  for (const release of held) await release();
  await expect(
    modes.getByRole("button", { name: title, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".section-heading").first()).toContainText(title);
  await page.unroute("**/api/history?**");
});

test.describe("triple mobile", () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const width of [320, 390])
    test(`three simultaneous touches at ${width}px keep controls usable`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${basePath}#triple-n-back`);
      await start(page);
      await page.clock.fastForward(5100);
      await expect(page.locator(".stimulus-number")).toHaveCount(1);
      const buttons = names.map((name) =>
        page.getByRole("button", { name, exact: true }),
      );
      const boxes = await Promise.all(
        buttons.map((button) => button.boundingBox()),
      );
      for (const box of boxes) {
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: boxes.map((box, id) => ({
          x: box!.x + box!.width / 2,
          y: box!.y + box!.height / 2,
          id,
        })),
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      for (const button of buttons)
        await expect(button).toHaveAttribute("aria-pressed", "true");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/triple-mobile-${width}-playing.png`,
        fullPage: true,
      });
      await page.clock.fastForward(81000);
      await expect(page.getByTestId("number-score")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/triple-mobile-${width}-result.png`,
        fullPage: true,
      });
    });
});
