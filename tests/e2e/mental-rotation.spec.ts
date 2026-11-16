import { test, expect, type Page } from "@playwright/test";
import { normalizeBasePath } from "../../src/shared/paths.js";
import { Store } from "../../src/server/store.js";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const basePath = normalizeBasePath(process.env.E2E_BASE_PATH);
const evidence = resolve(".runtime/rotation-evidence");
mkdirSync(evidence, { recursive: true });
async function account(page: Page) {
  const store = new Store(process.env.E2E_DATABASE_PATH!);
  try {
    const a = store.createUser("隔离心理旋转浏览器用户");
    await restoreAccount(page, a.token, store);
    return a;
  } finally {
    store.close();
  }
}
async function restoreAccount(page: Page, token: string, store: Store) {
  const session = store.login(token, Date.now());
  await page.context().addCookies([
    {
      name: "bg_session",
      value: session.session,
      domain: "127.0.0.1",
      path: basePath,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
}
async function prepare(page: Page) {
  await page.goto(`${basePath}#mental-rotation`);
  await expect(
    page.getByRole("button", { name: "先做热身", exact: true }),
  ).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}
const answers = (page: Page) =>
  page.getByRole("group", { name: "判断图形关系" });
async function ready(page: Page) {
  await expect(answers(page).getByRole("button").first()).toHaveAttribute(
    "aria-disabled",
    "false",
  );
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
  await ready(page);
}
async function answerName(page: Page) {
  // Read the actual rendered geometry, without a production answer attribute/API.
  const areas = await page
    .getByTestId("rotation-pair")
    .locator("path")
    .evaluateAll((paths) =>
      paths.map((path) => {
        const points = [
          ...path.getAttribute("d")!.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g),
        ].map((m) => [Number(m[1]), Number(m[2])]);
        return (
          points.reduce((s, [x, y], i) => {
            const [a, b] = points[(i + 1) % points.length];
            return s + x * b - y * a;
          }, 0) / 2
        );
      }),
    );
  expect(areas).toHaveLength(2);
  expect(Math.abs(areas[0])).toBeGreaterThan(5);
  return areas[0] * areas[1] < 0 ? "镜像" : "仅旋转";
}
async function trial(page: Page, correct = true) {
  await ready(page);
  const name = await answerName(page);
  await page.clock.runFor(120);
  await answers(page)
    .getByRole("button", {
      name: correct ? name : name === "镜像" ? "仅旋转" : "镜像",
      exact: true,
    })
    .click();
  await expect(
    page.getByTestId("rotation-feedback").locator("strong"),
  ).toHaveText(correct ? "正确" : "错误");
  await expect(page.getByTestId("rotation-feedback")).toContainText(
    `正确答案：${name}`,
  );
  await page.clock.runFor(850);
}
async function finish(page: Page, count = 32, correct = true) {
  for (let i = 0; i < count; i++) await trial(page, correct);
  await expect(page.getByTestId("rotation-result")).toBeVisible();
}
test("心理旋转从大厅进入独立准备页", async ({ page }) => {
  await page.goto(basePath);
  const card = page.getByRole("article", { name: "心理旋转", exact: true });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page).toHaveURL(/#mental-rotation$/);
  await expect(
    page.getByRole("heading", { name: "心理旋转", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/心理旋转/);
  await page.screenshot({
    path: resolve(evidence, "setup-desktop.png"),
    fullPage: true,
  });
});

test("热身、游客、账号成绩及私人记录导航互相独立", async ({ page }) => {
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
  await expect(page.getByTestId("rotation-score")).toHaveText("100.0%");
  expect(uploads).toBe(0);
  await start(page);
  await finish(page);
  expect(uploads).toBe(0);
  await expect(page.getByTestId("rotation-result")).toContainText(
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
  expect(uploads).toBe(1);
  await expect(page.getByTestId("rotation-result")).toContainText("正确 32 题");
  await page.screenshot({
    path: resolve(evidence, "result-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "查看个人记录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "心理旋转", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("rotation-best")).toContainText("100.0%");
  await page.screenshot({
    path: resolve(evidence, "records-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page).toHaveURL(/#mental-rotation$/);
});
test("不限时思考、反馈节奏和零正确用时", async ({ page }) => {
  await prepare(page);
  await start(page, "warmup");
  await page.clock.fastForward(60000);
  await expect(page.getByTestId("rotation-progress")).toHaveText("1 / 8");
  await ready(page);
  const name = await answerName(page);
  await answers(page)
    .getByRole("button", {
      name: name === "镜像" ? "仅旋转" : "镜像",
      exact: true,
    })
    .click();
  await expect(
    page.getByTestId("rotation-feedback").locator("strong"),
  ).toHaveText("错误");
  await page.clock.runFor(700);
  await expect(page.getByTestId("rotation-progress")).toHaveText("1 / 8");
  await page.clock.runFor(150);
  await expect(page.getByTestId("rotation-progress")).toHaveText("2 / 8");
  for (let i = 1; i < 8; i++) await trial(page, false);
  const result = page.getByTestId("rotation-result");
  await expect(result).toBeVisible();
  await expect(page.getByTestId("rotation-score")).toHaveText("0.0%");
  await expect(result).toContainText("—");
  await expect(result).not.toContainText("NaN");
  await expect(result).not.toContainText("0 ms");
});
test("跨题指针释放、Enter 重复和非专用按键不作答下一题", async ({ page }) => {
  await prepare(page);
  await start(page, "warmup");
  const button = answers(page).getByRole("button").first();
  await button.focus();
  await page.keyboard.down("Enter");
  await expect(
    page.getByTestId("rotation-feedback").locator("strong"),
  ).toBeVisible();
  await page.clock.runFor(850);
  await expect(page.getByTestId("rotation-progress")).toHaveText("2 / 8");
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await ready(page);
  await page.keyboard.press("KeyF");
  await page.keyboard.press("KeyJ");
  await page.keyboard.press("Digit1");
  await ready(page);
  await button.click();
  await expect(
    page.getByTestId("rotation-feedback").locator("strong"),
  ).toBeVisible();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(850);
  await expect(page.getByTestId("rotation-progress")).toHaveText("3 / 8");
  await page.mouse.up();
  await ready(page);
  await button.focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByTestId("rotation-feedback").locator("strong"),
  ).toBeVisible();
  await page.getByRole("button", { name: "结束本局", exact: true }).click();
  await expect(page.getByTestId("rotation-abort")).toBeVisible();
});
test("响应丢失后原请求幂等重试，刷新丢弃未保存结果", async ({ page }) => {
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
    async (p) => (await fetch(`${p}api/history?game=mental-rotation`)).json(),
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
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});
test("跨标签页换账号拒绝转存，原账号恢复后可保存", async ({ page }) => {
  const a = await account(page);
  await prepare(page);
  await start(page, "account");
  const other = await page.context().newPage();
  await account(other);
  await other.goto(basePath);
  await finish(page);
  await expect(page.getByTestId("rotation-result")).toContainText(
    "当前账户与开局账户不同",
  );
  const store = new Store(process.env.E2E_DATABASE_PATH!);
  try {
    expect(store.history(a.user.id, 1, "mental-rotation").total).toBe(0);
    await restoreAccount(page, a.token, store);
  } finally {
    store.close();
  }
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.getByText("成绩已保存", { exact: true })).toBeVisible();
  await other.close();
});
test("窄屏、同尺度完整 SVG、缩放及离开中断", async ({ page }) => {
  await prepare(page);
  await start(page, "warmup");
  expect(await answers(page).getByRole("button").allTextContents()).toEqual([
    "仅旋转",
    "镜像",
  ]);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const boxes = await page
      .getByTestId("rotation-pair")
      .locator("svg")
      .evaluateAll((elements) =>
        elements.map((svg) => {
          const s = svg as SVGSVGElement,
            b = s.viewBox.baseVal,
            p = s.querySelector("path")!.getBBox(),
            rect = s.getBoundingClientRect();
          return {
            viewBox: s.getAttribute("viewBox"),
            width: rect.width,
            height: rect.height,
            fits:
              p.x > b.x &&
              p.y > b.y &&
              p.x + p.width < b.x + b.width &&
              p.y + p.height < b.y + b.height,
          };
        }),
      );
    expect(boxes[0].viewBox).toBe(boxes[1].viewBox);
    expect(boxes[0].width).toBe(boxes[1].width);
    expect(
      boxes.every(
        (b) => b.fits && b.width > 80 && Math.abs(b.width - b.height) < 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: resolve(evidence, `question-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
    location.hash = "home";
  });
  await expect(
    page.getByRole("heading", { name: "训练大厅", exact: true }),
  ).toBeVisible();
  await page.goto(`${basePath}#mental-rotation`);
  await expect(answers(page)).toHaveCount(0);
});
test("触屏 tap 只提交当前题一次", async ({ browser, baseURL }) => {
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
    await answers(page)
      .getByRole("button", { name: await answerName(page), exact: true })
      .tap();
    await expect(
      page.getByTestId("rotation-feedback").locator("strong"),
    ).toHaveText("正确");
    await page.clock.runFor(850);
    await expect(page.getByTestId("rotation-progress")).toHaveText("2 / 8");
    await ready(page);
  } finally {
    await context.close();
  }
});
test("缓存后离线重开可热身及游客正式训练，联网后不补传", async ({
  page,
  context,
}) => {
  await page.goto(basePath);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await page.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  let uploads = 0;
  offline.on("request", (r) => {
    if (r.url().endsWith("/api/results")) uploads++;
  });
  await prepare(offline);
  await start(offline, "warmup");
  await finish(offline, 8);
  await start(offline);
  await finish(offline);
  await expect(offline.getByTestId("rotation-result")).toContainText(
    "游客练习",
  );
  expect(uploads).toBe(0);
  const urls = await offline.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const r of await (await caches.open(name)).keys()) urls.push(r.url);
    return urls;
  });
  expect(urls.some((url) => url.includes("/api/"))).toBe(false);
  expect(
    await offline.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  await context.setOffline(false);
  await account(offline);
  await offline.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    offline.getByRole("button", { name: "退出", exact: true }),
  ).toBeVisible();
  expect(uploads).toBe(0);
});

test("离开准备页后迟到的开局身份响应不能重启旧局", async ({ page }) => {
  await account(page);
  await prepare(page);
  await expect(
    page.getByRole("button", { name: "开始本局", exact: true }),
  ).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "开始本局", exact: true }).click();
  await expect(page.getByText("正在准备…", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    location.hash = "home";
  });
  await expect(
    page.getByRole("heading", { name: "训练大厅", exact: true }),
  ).toBeVisible();
  const response = page.waitForResponse((r) => r.url().endsWith("/api/me"));
  release();
  await response;
  await page.clock.runFor(50);
  await expect(
    page.getByRole("heading", { name: "训练大厅", exact: true }),
  ).toBeVisible();
  await expect(answers(page)).toHaveCount(0);
});

test("生成失败留在准备页且不保存，合法退化随机源仍能开局", async ({ page }) => {
  await prepare(page);
  let uploads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/results")) uploads++;
  });
  await page.evaluate(() => {
    Math.random = () => NaN;
  });
  await page.getByRole("button", { name: "先做热身", exact: true }).click();
  await expect(page.getByText("随机源无效", { exact: true })).toBeVisible();
  await expect(answers(page)).toHaveCount(0);
  expect(uploads).toBe(0);
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  await start(page, "warmup");
  await expect(page.getByTestId("rotation-progress")).toHaveText("1 / 8");
});
