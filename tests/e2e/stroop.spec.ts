import { test, expect, type Page } from "@playwright/test";
import { Store } from "../../src/server/store.js";
import { normalizeBasePath } from "../../src/shared/paths.js";
import { STROOP_COLORS } from "../../src/shared/stroop.js";
const basePath = normalizeBasePath(process.env.E2E_BASE_PATH);
async function account(page: Page) {
  const store = new Store(process.env.E2E_DATABASE_PATH!);
  try {
    const a = store.createUser("隔离 Stroop 浏览器用户");
    const session = store.login(a.token, Date.now());
    await page
      .context()
      .addCookies([
        {
          name: "bg_session",
          value: session.session,
          domain: "127.0.0.1",
          path: basePath,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
    return a;
  } finally {
    store.close();
  }
}
async function prepare(page: Page) {
  await page.goto(`${basePath}#stroop`);
  await expect(
    page.getByRole("button", { name: "先做热身", exact: true }),
  ).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}
async function start(
  page: Page,
  kind: "guest" | "warmup" | "account" = "guest",
) {
  await page
    .getByRole("button", {
      name:
        kind === "warmup"
          ? "先做热身"
          : kind === "account"
            ? "开始本局"
            : "以游客身份练习",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("stroop-word")).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "选择字体颜色" })
      .getByRole("button")
      .first(),
  ).toHaveAttribute("aria-disabled", "false");
}
async function answerName(page: Page) {
  const color = await page
    .getByTestId("stroop-word")
    .evaluate((e) => getComputedStyle(e).color);
  const index = STROOP_COLORS.findIndex((c) => {
    const hex = c.value.slice(1);
    return (
      color ===
      `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`
    );
  });
  expect(index).toBeGreaterThanOrEqual(0);
  return STROOP_COLORS[index].name;
}
async function trial(
  page: Page,
  response: "correct" | "wrong" | "timeout" = "correct",
) {
  await expect(page.getByTestId("stroop-word")).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "选择字体颜色" })
      .getByRole("button")
      .first(),
  ).toHaveAttribute("aria-disabled", "false");
  if (response === "timeout") {
    // Let each real DOM receipt commit before advancing the next portion of virtual time.
    for (
      let i = 0;
      i < 62 && !(await page.getByTestId("stroop-feedback").count());
      i++
    )
      await page.clock.runFor(50);
  } else {
    const correct = await answerName(page);
    const name =
      response === "correct"
        ? correct
        : STROOP_COLORS.find((c) => c.name !== correct)!.name;
    await page.clock.runFor(120);
    await page
      .getByRole("group", { name: "选择字体颜色" })
      .getByRole("button", { name, exact: true })
      .click();
  }
  await expect(page.getByTestId("stroop-feedback")).toContainText(
    response === "correct" ? "正确" : response === "wrong" ? "错误" : "超时",
  );
  if (response !== "correct")
    await expect(page.getByTestId("stroop-feedback")).toContainText("正确颜色");
  await page.clock.runFor(350);
}
async function finish(
  page: Page,
  count = 40,
  response: "correct" | "wrong" | "timeout" = "correct",
) {
  for (let i = 0; i < count; i++) await trial(page, response);
  await expect(page.getByTestId("stroop-result")).toBeVisible();
}

test("Stroop 入口从大厅进入独立准备页", async ({ page }) => {
  await page.goto(basePath);
  const card = page.getByRole("article", {
    name: "颜色干扰 · Stroop",
    exact: true,
  });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page).toHaveURL(/#stroop$/);
  await expect(
    page.getByRole("heading", { name: "颜色干扰 · Stroop", exact: true }),
  ).toBeVisible();
});

test("热身、游客局、登录后不补传及记录导航", async ({ page }) => {
  let uploads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/results")) uploads++;
  });
  await prepare(page);
  await start(page, "warmup");
  await finish(page, 8);
  await expect(
    page.getByRole("heading", { name: "热身完成", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("stroop-score")).toHaveText("100.0%");
  expect(uploads).toBe(0);
  await page
    .getByRole("button", { name: "以游客身份练习", exact: true })
    .click();
  await finish(page);
  expect(uploads).toBe(0);
  await expect(page.getByTestId("stroop-result")).toContainText(
    "登录后也不会补传",
  );
  await account(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "退出", exact: true }),
  ).toBeVisible();
  expect(uploads).toBe(0);
  await page.getByRole("button", { name: "返回准备页", exact: true }).click();
  await start(page, "account");
  await finish(page);
  await expect(page.getByText("成绩已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看个人记录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "颜色干扰 · Stroop", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("stroop-best")).toContainText("100.0%");
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page).toHaveURL(/#stroop$/);
});

test("错误、全超时与零正确指标可见且不产生 NaN", async ({ page }) => {
  await prepare(page);
  await start(page, "warmup");
  await trial(page, "wrong");
  for (let i = 1; i < 8; i++) await trial(page, "timeout");
  const result = page.getByTestId("stroop-result");
  await expect(result).toBeVisible();
  await expect(page.getByTestId("stroop-score")).toHaveText("0.0%");
  await expect(result).toContainText("—");
  await expect(result).not.toContainText("NaN");
});

test("跨题指针长按、键盘重复和非专用按键不会污染下一题", async ({ page }) => {
  await prepare(page);
  await start(page);
  const button = page
    .getByRole("group", { name: "选择字体颜色" })
    .getByRole("button")
    .first();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(3020);
  await expect(page.getByTestId("stroop-feedback")).toContainText("超时");
  await page.clock.runFor(350);
  await expect(page.getByTestId("stroop-progress")).toHaveText("2 / 40");
  await page.mouse.up();
  await expect(page.getByTestId("stroop-word")).toBeVisible();
  await page.keyboard.press("Digit1");
  await page.keyboard.press("KeyD");
  await expect(page.getByTestId("stroop-word")).toBeVisible();
  await button.focus();
  await page.keyboard.down("Enter");
  await expect(page.getByTestId("stroop-feedback")).toBeVisible();
  await page.clock.runFor(350);
  await expect(page.getByTestId("stroop-progress")).toHaveText("3 / 40");
  await page.keyboard.down("Enter");
  await expect(page.getByTestId("stroop-word")).toBeVisible();
  await page.keyboard.up("Enter");
  await page.getByRole("button", { name: "结束本局", exact: true }).click();
  await expect(page.getByTestId("stroop-abort")).toBeVisible();
});

test("真实服务响应丢失后重试幂等，离开丢弃待保存结果", async ({ page }) => {
  await account(page);
  await prepare(page);
  await start(page, "account");
  let lose = true;
  await page.route("**/api/results", async (route) => {
    if (lose) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await finish(page);
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toBeVisible();
  lose = false;
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.getByText("成绩已保存", { exact: true })).toBeVisible();
  const history = await page.evaluate(
    async (p) => (await fetch(`${p}api/history?game=stroop`)).json(),
    basePath,
  );
  expect(history.total).toBe(1);
  await page.getByRole("button", { name: "返回准备页", exact: true }).click();
  await start(page, "account");
  await page.unroute("**/api/results");
  await page.route("**/api/results", (route) => route.abort("failed"));
  await finish(page);
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).length + Object.keys(sessionStorage).length,
    ),
  ).toBe(0);
});

test("跨标签页换账号拒绝原结果转存，重新登录原账号可重试", async ({ page }) => {
  const a = await account(page);
  await prepare(page);
  await start(page, "account");
  const other = await page.context().newPage();
  await account(other);
  await other.goto(basePath);
  await finish(page);
  await expect(page.getByTestId("stroop-result")).toContainText(
    "当前账户与开局账户不同",
  );
  const store = new Store(process.env.E2E_DATABASE_PATH!);
  try {
    expect(store.history(a.user.id, 1, "stroop").total).toBe(0);
    const session = store.login(a.token, Date.now());
    await page
      .context()
      .addCookies([
        {
          name: "bg_session",
          value: session.session,
          domain: "127.0.0.1",
          path: basePath,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
  } finally {
    store.close();
  }
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.getByText("成绩已保存", { exact: true })).toBeVisible();
  await other.close();
});

test("窄屏布局、刺激对比度与离开中断", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await start(page, "warmup");
  const names = await page
    .getByRole("group", { name: "选择字体颜色" })
    .getByRole("button")
    .allTextContents();
  expect(names).toEqual(["红", "蓝", "绿", "黄"]);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  for (const c of STROOP_COLORS) {
    const ratio = await page
      .getByTestId("stroop-stimulus")
      .evaluate((e, color) => {
        const lum = (rgb: number[]) =>
          rgb
            .map((v) => v / 255)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            )
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const bg = getComputedStyle(e)
          .backgroundColor.match(/\d+/g)!
          .map(Number);
        const hex = color.slice(1);
        const fg = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return (
          (Math.max(lum(fg), lum(bg)) + 0.05) /
          (Math.min(lum(fg), lum(bg)) + 0.05)
        );
      }, c.value);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("stroop-mobile.png"),
    fullPage: true,
  });
  const name = await answerName(page);
  await page
    .getByRole("group", { name: "选择字体颜色" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.getByTestId("stroop-feedback")).toContainText("正确");
  await page.evaluate(() => {
    location.hash = "home";
  });
  await expect(
    page.getByRole("heading", { name: "训练大厅", exact: true }),
  ).toBeVisible();
  await page.goto(`${basePath}#stroop`);
  await expect(page.getByTestId("stroop-word")).toHaveCount(0);
});

test("原生触屏点击仅提交当前题一次", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await prepare(page);
    await start(page, "warmup");
    const name = await answerName(page);
    await page
      .getByRole("group", { name: "选择字体颜色" })
      .getByRole("button", { name, exact: true })
      .tap();
    await expect(page.getByTestId("stroop-feedback")).toContainText("正确");
    await page.clock.runFor(350);
    await expect(page.getByTestId("stroop-progress")).toHaveText("2 / 8");
    await expect(page.getByTestId("stroop-word")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("PWA 缓存后的离线游客可完整热身且不写私人缓存", async ({ page }) => {
  await page.goto(basePath);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await prepare(page);
  await page.context().setOffline(true);
  await start(page, "warmup");
  await finish(page, 8);
  await expect(
    page.getByRole("heading", { name: "热身完成", exact: true }),
  ).toBeVisible();
  const urls = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) {
      for (const r of await (await caches.open(name)).keys())
        result.push(r.url);
    }
    return result;
  });
  expect(urls.some((x) => x.includes("/api/"))).toBe(false);
  await page.context().setOffline(false);
});
