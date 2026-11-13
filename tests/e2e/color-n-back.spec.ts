import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Store } from "../../src/server/store.js";
import { normalizeBasePath } from "../../src/shared/paths.js";

const basePath = normalizeBasePath(process.env.E2E_BASE_PATH);
const mode = "spatial-color-n-back";
function account() {
  const store = new Store(process.env.E2E_DATABASE_PATH!);
  try {
    return store.createUser(`Dual-${randomUUID().slice(0, 6)}`);
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
  await expect(
    page.getByRole("heading", { name: "练习完成，做得不错。" }),
  ).toBeVisible();
}

test("dual mode has an independent lobby entry and two response buttons", async ({
  page,
}) => {
  await page.goto(basePath);
  const card = page.getByRole("article", {
    name: "位置＋颜色 N-back",
    exact: true,
  });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "位置＋颜色 N-back", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始本局", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "位置匹配", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "颜色匹配", exact: true }),
  ).toBeVisible();
});

test("dual mode visible stimuli drive correct independent answers and mode-aware record navigation", async ({
  page,
}) => {
  const user = account();
  await page.goto(`${basePath}#color-n-back`);
  await login(page, user.token);
  await expect(page.locator(".color-palette i")).toHaveCount(6);
  expect(
    new Set(
      await page
        .locator(".color-palette i")
        .evaluateAll((elements) =>
          elements.map((x) => getComputedStyle(x).backgroundColor),
        ),
    ).size,
  ).toBe(6);
  await start(page);
  const stimuli: { cell: string; color: string }[] = [];
  for (let i = 0; i < 32; i++) {
    const cell = page.locator(".cell.lit");
    await expect(cell).toHaveCount(1);
    stimuli.push({
      cell: (await cell.getAttribute("data-testid"))!,
      color: await cell.evaluate((x) => getComputedStyle(x).backgroundColor),
    });
    if (i >= 2) {
      if (stimuli[i].cell === stimuli[i - 2].cell)
        await page.keyboard.press("f");
      if (stimuli[i].color === stimuli[i - 2].color)
        await page.keyboard.press("j");
    }
    if (i === 2)
      await page.screenshot({
        path: "test-results/dual-desktop-playing.png",
        fullPage: true,
      });
    await page.clock.fastForward(2500);
  }
  await expect(page.getByTestId("score")).toContainText("100.0");
  await expect(page.getByTestId("position-score")).toHaveText("100.0 分");
  await expect(page.getByTestId("color-score")).toHaveText("100.0 分");
  await expect(page.locator(".save-message")).toContainText("已保存到");
  await page.screenshot({
    path: "test-results/dual-desktop-result.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "查看个人记录" }).click();
  const selected = page.getByRole("group", { name: "记录模式" });
  await expect(
    selected.getByRole("button", { name: "位置＋颜色 N-back", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("共 1 局", { exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toContainText("位置");
  await expect(page.getByRole("table")).toContainText("颜色");
  await page.screenshot({
    path: "test-results/dual-desktop-records.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "位置＋颜色 N-back", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "个人记录", exact: true }).click();
  await expect(
    selected.getByRole("button", { name: "空间 N-back", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "开始第一局" }).click();
  await expect(
    page.getByRole("heading", { name: "空间 N-back", exact: true }),
  ).toBeVisible();
  await page.goto(`${basePath}#records`);
  await selected
    .getByRole("button", { name: "位置＋颜色 N-back", exact: true })
    .click();
  await page.goto(`${basePath}#home`);
  await page.goto(`${basePath}#records`);
  await expect(
    selected.getByRole("button", { name: "空间 N-back", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const data = await (
    await page.request.get(`${basePath}api/history?game=${mode}`)
  ).json();
  expect(data.items[0].score).toBe(100);
  expect(data.items[0].game).toBe(mode);
});

test("dual mode F/J are independent, blank accepts input, held keys do not answer next round, mode navigation aborts", async ({
  page,
}) => {
  await page.goto(`${basePath}#color-n-back`);
  await start(page);
  const position = page.getByRole("button", { name: "位置匹配", exact: true }),
    color = page.getByRole("button", { name: "颜色匹配", exact: true });
  await expect(position).toBeDisabled();
  await expect(color).toBeDisabled();
  await page.clock.fastForward(5600);
  await expect(page.locator(".cell.lit")).toHaveCount(0);
  await page.keyboard.down("f");
  await expect(position).toHaveAttribute("aria-pressed", "true");
  await expect(color).toBeEnabled();
  await page.keyboard.press("j");
  await expect(color).toHaveAttribute("aria-pressed", "true");
  await page.clock.fastForward(2500);
  await page.keyboard.down("f");
  await expect(position).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.up("f");
  await page.keyboard.press("f");
  await expect(position).toHaveAttribute("aria-pressed", "true");
  await page.goto(`${basePath}#n-back`);
  await expect(
    page.getByRole("heading", { name: "空间 N-back", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("本局已结束，未计入历史和最佳成绩。", { exact: true }),
  ).toBeVisible();
});

test("dual mode guest result is never uploaded after login", async ({
  page,
}) => {
  let uploads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/results")) uploads++;
  });
  await page.goto(`${basePath}#color-n-back`);
  await start(page);
  await finish(page);
  await expect(page.getByTestId("score")).toContainText("50.0");
  await expect(page.getByTestId("position-score")).toHaveText("50.0 分");
  await expect(page.getByTestId("color-score")).toHaveText("50.0 分");
  await login(page, account().token);
  expect(uploads).toBe(0);
});

test("dual mode lost response stays idempotent and cross-account retry is refused", async ({
  page,
  context,
}) => {
  const a = account(),
    b = account();
  await page.goto(`${basePath}#color-n-back`);
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

test("dual mode invalidated session preserves result for original account retry", async ({
  page,
}) => {
  const a = account();
  await page.goto(`${basePath}#color-n-back`);
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

test("dual mode empty records training entry follows selection and old responses cannot replace selected mode", async ({
  page,
}) => {
  const a = account();
  await page.goto(basePath);
  await login(page, a.token);
  const seeded = await page.request.post(`${basePath}api/results`, {
    headers: { origin: new URL(page.url()).origin },
    data: {
      resultId: randomUUID(),
      startedByUserId: a.user.id,
      game: "spatial-n-back",
      version: 1,
      n: 2,
      completedAt: new Date().toISOString(),
      tp: 9,
      fn: 0,
      fp: 0,
      tn: 21,
    },
  });
  expect(seeded.status()).toBe(200);
  await page.getByRole("link", { name: "个人记录", exact: true }).click();
  const modes = page.getByRole("group", { name: "记录模式" });
  await modes
    .getByRole("button", { name: "位置＋颜色 N-back", exact: true })
    .click();
  await page.getByRole("button", { name: "开始第一局" }).click();
  await expect(
    page.getByRole("heading", { name: "位置＋颜色 N-back", exact: true }),
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
  await modes
    .getByRole("button", { name: "位置＋颜色 N-back", exact: true })
    .click();
  await modes.getByRole("button", { name: "空间 N-back", exact: true }).click();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await modes
    .getByRole("button", { name: "位置＋颜色 N-back", exact: true })
    .click();
  await expect(page.getByText("共 0 局", { exact: true })).toBeVisible();
  for (const release of held) await release();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByText("共 0 局", { exact: true })).toBeVisible();
  await expect(
    modes.getByRole("button", { name: "位置＋颜色 N-back", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".section-heading").first()).toContainText(
    "位置＋颜色 N-back",
  );
});

test.describe("dual mode mobile", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("dual mode simultaneous touch marks both channels without overflow", async ({
    page,
    context,
  }) => {
    await page.goto(`${basePath}#color-n-back`);
    await start(page);
    await page.clock.fastForward(5000);
    const position = page.getByRole("button", {
        name: "位置匹配",
        exact: true,
      }),
      color = page.getByRole("button", { name: "颜色匹配", exact: true });
    await page.screenshot({
      path: "test-results/dual-mobile-playing.png",
      fullPage: true,
    });
    const boxes = [await position.boundingBox(), await color.boundingBox()];
    const session = await context.newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: boxes.map((box, id) => ({
        x: box!.x + box!.width / 2,
        y: box!.y + box!.height / 2,
        id,
      })),
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(position).toHaveAttribute("aria-pressed", "true");
    await expect(color).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await finish(page);
    await page.screenshot({
      path: "test-results/dual-mobile-result.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});
