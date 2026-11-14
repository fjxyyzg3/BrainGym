import { test as base, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../../src/server/app.js";
import { Store } from "../../src/server/store.js";
import { normalizeBasePath } from "../../src/shared/paths.js";
import {
  CORSI_FORWARD,
  CORSI_BACKWARD,
  type CorsiGameId,
  type CorsiResultInput,
} from "../../src/shared/contracts.js";

const basePath = normalizeBasePath(process.env.E2E_BASE_PATH);
const databasePath = resolve(
  "data",
  `e2e-corsi-${process.pid}-${randomUUID()}.sqlite`,
);
let serverOffset = 0;
const virtualPages = new WeakSet<Page>();
const test = base.extend<{}, { corsiServer: string }>({
  corsiServer: [
    async ({}, use) => {
      const store = new Store(databasePath);
      const settings = {
        store,
        origin: "http://127.0.0.1",
        basePath,
        staticRoot: resolve("dist/client"),
        now: () => Date.now() + serverOffset,
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
  baseURL: async ({ corsiServer }, use) => use(corsiServer),
});
test.beforeEach(() => {
  serverOffset = 0;
});
function account() {
  const store = new Store(databasePath);
  try {
    return store.createUser(`Corsi-${randomUUID().slice(0, 6)}`);
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
async function start(page: Page, guest = false, controlledClock = true) {
  if (controlledClock && !virtualPages.has(page)) {
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    virtualPages.add(page);
  }
  await page
    .getByRole("button", {
      name: guest ? "以游客身份练习" : "开始本局",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("corsi-phase")).toContainText("请记忆");
}
async function advanceUntil(page: Page, done: () => Promise<boolean>) {
  for (let step = 0; step < 100; step++) {
    if (await done()) return;
    if (await page.getByTestId("corsi-abort").count())
      throw new Error(await page.getByTestId("corsi-abort").innerText());
    serverOffset += 20;
    await page.clock.runFor(20);
  }
  expect(await done(), "真实 DOM 应在逻辑相位截止前呈现").toBe(true);
}
async function observe(page: Page, length: number): Promise<number[]> {
  const cells: number[] = [];
  for (let index = 0; index < length; index++) {
    if (virtualPages.has(page))
      await advanceUntil(
        page,
        async () =>
          (await page.getByTestId("corsi-stimulus-step").count()) === 1 &&
          (await page.getByTestId("corsi-stimulus-step").textContent()) ===
            String(index + 1) &&
          (await page.locator(".corsi-cell.lit").count()) === 1,
      );
    await expect(page.getByTestId("corsi-stimulus-step")).toHaveText(
      String(index + 1),
    );
    const lit = page.locator(".corsi-cell.lit");
    await expect(lit).toHaveCount(1);
    cells.push(Number(await lit.getAttribute("data-cell")));
    if (virtualPages.has(page))
      await advanceUntil(page, async () => (await lit.count()) === 0);
    else await expect(lit).toHaveCount(0);
  }
  if (virtualPages.has(page))
    await advanceUntil(page, async () =>
      (await page
        .getByTestId("corsi-phase")
        .textContent()
        .catch(() => ""))!.includes("复现"),
    );
  await expect(page.getByTestId("corsi-phase")).toContainText("复现");
  return cells;
}
async function giveUp(page: Page, length = 2) {
  await observe(page, length);
  await page.getByRole("button", { name: "记不住了", exact: true }).click();
}
async function completeFail(page: Page, length = 2) {
  await giveUp(page, length);
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await giveUp(page, length);
  await expect(
    page.getByRole("heading", { name: "本局完成", exact: true }),
  ).toBeVisible();
}
function seed(userId: string, patch: Partial<CorsiResultInput> = {}) {
  const store = new Store(databasePath);
  try {
    return store.save(
      { id: userId, name: "fixture" },
      {
        game: CORSI_FORWARD,
        version: 1,
        resultId: randomUUID(),
        startedByUserId: userId,
        progressEpoch: 0,
        completedAt: new Date(Date.now() - 60000).toISOString(),
        startLength: 2,
        failedLength: 4,
        firstTrialCorrect: true,
        maxFirstTryLength: 3,
        ...patch,
      },
      Date.now(),
    );
  } finally {
    store.close();
  }
}

test("入口：单张 Corsi 卡片、两个方向与键盘可访问的恢复确认", async ({
  page,
}) => {
  await page.goto(basePath);
  const card = page.getByRole("article", {
    name: "顺序记忆 · Corsi 方块",
    exact: true,
  });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page).toHaveURL(/#corsi$/);
  await expect(
    page.getByRole("heading", { name: "顺序记忆 · Corsi 方块", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "倒序", exact: true }).click();
  await expect(page).toHaveURL(/#corsi-backward$/);
  await page
    .getByRole("button", { name: "从 2 格重新开始", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "从 2 格重新开始", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: "test-results/corsi-setup.png",
    fullPage: true,
  });
});

for (const [hash, reverse] of [
  ["corsi", false],
  ["corsi-backward", true],
] as const) {
  test(`${hash}：真实刺激驱动正倒序作答，首题对仍做第二题`, async ({
    page,
  }) => {
    await page.goto(`${basePath}#${hash}`);
    await start(page, true);
    const cells = await observe(page, 2);
    if (reverse) cells.reverse();
    await page.keyboard.down(String(cells[0] + 1));
    await page.keyboard.down(String(cells[0] + 1));
    await page.keyboard.up(String(cells[0] + 1));
    await expect(page.getByTestId("corsi-entered")).toContainText("1 / 2");
    await expect(page.getByTestId("corsi-feedback")).toHaveCount(0);
    await page.keyboard.press(String(cells[1] + 1));
    await expect(page.getByTestId("corsi-feedback")).toContainText("正确");
    await expect(page.getByTestId("corsi-trial")).toContainText("1 / 2");
    await page.getByRole("button", { name: "下一题", exact: true }).click();
    await giveUp(page);
    await page.getByRole("button", { name: "下一题", exact: true }).click();
    await giveUp(page, 3);
    await page.getByRole("button", { name: "下一题", exact: true }).click();
    await giveUp(page, 3);
    await expect(page.getByTestId("corsi-score")).toHaveText("2 格");
    await page.screenshot({
      path: `test-results/${hash}-result.png`,
      fullPage: true,
    });
    await expect(
      page.getByText("游客成绩不会上传", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "再练一局", exact: true }).click();
    await expect(page.getByTestId("corsi-current-start")).toContainText("2 格");
  });
}

test("账号保存、记录导航、跨页面起点与恢复保留最佳", async ({
  page,
  context,
}) => {
  const a = account();
  seed(a.user.id);
  const legacyFuture: CorsiResultInput = {
    game: CORSI_FORWARD,
    version: 1,
    resultId: randomUUID(),
    startedByUserId: a.user.id,
    progressEpoch: 0,
    startLength: 2,
    failedLength: 3,
    firstTrialCorrect: true,
    maxFirstTryLength: 2,
    completedAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const legacyDb = new DatabaseSync(databasePath);
  legacyDb
    .prepare("INSERT INTO corsi_results VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      a.user.id,
      legacyFuture.resultId,
      CORSI_FORWARD,
      1,
      0,
      JSON.stringify(legacyFuture),
      2,
      legacyFuture.completedAt,
      new Date().toISOString(),
    );
  legacyDb.close();
  await page.goto(`${basePath}#corsi`);
  await login(page, a.token);
  await expect(page.getByTestId("corsi-current-start")).toContainText("3 格");
  await start(page);
  await completeFail(page, 3);
  await expect(page.getByTestId("corsi-save-status")).toContainText("已保存");
  await page.getByRole("button", { name: "查看个人记录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "顺序记忆 · 正序", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("corsi-best")).toContainText("3 格");
  await expect(
    page.getByText("完成时间异常，不决定起点", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/corsi-records.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  const other = await context.newPage();
  await other.goto(`${basePath}#corsi`);
  await expect(other.getByTestId("corsi-current-start")).toContainText("2 格");
  await page
    .getByRole("button", { name: "从 2 格重新开始", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认恢复", exact: true })
    .click();
  await expect(page.getByTestId("corsi-current-start")).toContainText("2 格");
  await page.reload();
  await expect(page.getByTestId("corsi-current-start")).toContainText("2 格");
  await expect(page.getByTestId("corsi-direction-best").first()).toContainText(
    "3 格",
  );
});

test("保存失败不更新起点，原结果重试后只保存一次", async ({
  page,
  baseURL,
}) => {
  const a = account();
  seed(a.user.id);
  await page.goto(`${basePath}#corsi`);
  await login(page, a.token);
  const ids: string[] = [];
  let fail = true;
  await page.route(`**${basePath}api/results`, async (route) => {
    ids.push(route.request().postDataJSON().resultId);
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        json: { code: "SERVER_ERROR", error: "隔离保存失败" },
      });
    } else await route.continue();
  });
  await start(page);
  await completeFail(page, 3);
  await expect(page.getByTestId("corsi-save-status")).toContainText("保存失败");
  const progress = await page.request.get(
    `${baseURL}${basePath}api/corsi/progress`,
  );
  expect((await progress.json()).items[0].nextStartLength).toBe(3);
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.getByTestId("corsi-save-status")).toContainText("已保存");
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await page.getByRole("button", { name: "再练一局", exact: true }).click();
  await expect(page.getByTestId("corsi-current-start")).toContainText("2 格");
  await expect(
    page.getByRole("button", { name: "开始本局", exact: true }),
  ).toBeEnabled();
});

test("恢复响应丢失先重查，不能重复清空新世代进度", async ({
  page,
  baseURL,
}) => {
  const a = account();
  seed(a.user.id);
  await page.goto(`${basePath}#corsi`);
  await login(page, a.token);
  await expect(page.getByTestId("corsi-current-start")).toContainText("3 格");
  let resets = 0;
  await page.route(`**${basePath}api/corsi/progress/reset`, async (route) => {
    resets++;
    await route.fetch();
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "从 2 格重新开始", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认恢复", exact: true })
    .click();
  await expect(page.getByTestId("corsi-current-start")).toContainText("2 格");
  await expect(
    page.getByRole("button", { name: "开始本局", exact: true }),
  ).toBeEnabled();
  expect(resets).toBe(1);
  const progress = await (
    await page.request.get(`${baseURL}${basePath}api/corsi/progress`)
  ).json();
  expect(progress.items[0].progressEpoch).toBe(1);
});

test("另一浏览器恢复后旧世代完整局只保留历史和最佳", async ({
  page,
  browser,
  baseURL,
}) => {
  const a = account();
  seed(a.user.id);
  await page.goto(`${basePath}#corsi`);
  await login(page, a.token);
  await start(page);
  const device = await browser.newContext({ baseURL });
  try {
    const remote = await device.newPage();
    await remote.goto(`${basePath}#corsi`);
    await login(remote, a.token);
    await expect(remote.getByTestId("corsi-current-start")).toContainText(
      "3 格",
    );
    await remote
      .getByRole("button", { name: "从 2 格重新开始", exact: true })
      .click();
    await remote
      .getByRole("dialog")
      .getByRole("button", { name: "确认恢复", exact: true })
      .click();
    await expect(remote.getByTestId("corsi-current-start")).toContainText(
      "2 格",
    );
    await completeFail(page, 3);
    await expect(page.getByTestId("corsi-save-status")).toContainText("已保存");
    await expect(
      page.getByText("本局属于恢复前进度", { exact: false }),
    ).toBeVisible();
    await remote.reload();
    await expect(remote.getByTestId("corsi-current-start")).toContainText(
      "2 格",
    );
    await expect(
      remote.getByTestId("corsi-direction-best").first(),
    ).toContainText("3 格");
    expect(
      (
        await (
          await remote.request.get(
            `${basePath}api/history?game=${CORSI_FORWARD}`,
          )
        ).json()
      ).total,
    ).toBe(2);
  } finally {
    await device.close();
  }
});

test("设备日期修改不污染完成时间，已保存但起点刷新失败仍可只重查", async ({
  page,
  baseURL,
}) => {
  const a = account();
  await page.goto(`${basePath}#corsi`);
  await login(page, a.token);
  let completedAt = "",
    saved = false,
    failRead = true;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/results")) {
      completedAt = request.postDataJSON().completedAt;
      saved = true;
    }
  });
  await page.route(`**${basePath}api/corsi/progress`, async (route) => {
    if (saved && failRead) {
      failRead = false;
      await route.fulfill({
        status: 503,
        json: { code: "SERVER_ERROR", error: "隔离起点读取失败" },
      });
    } else await route.continue();
  });
  await start(page);
  await page.clock.setSystemTime(new Date(Date.now() + 86400000));
  await completeFail(page);
  await expect(page.getByTestId("corsi-save-status")).toContainText("已保存");
  await expect(
    page.getByText("成绩已保存，当前起点读取失败", { exact: false }),
  ).toBeVisible();
  expect(
    Math.abs(Date.parse(completedAt) - (Date.now() + serverOffset)),
  ).toBeLessThan(5000);
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "重新读取起点", exact: true }).click();
  await expect(
    page.getByText("成绩已保存，当前起点读取失败", { exact: false }),
  ).toHaveCount(0);
  const history = await (
    await page.request.get(
      `${baseURL}${basePath}api/history?game=${CORSI_FORWARD}`,
    )
  ).json();
  expect(history.total).toBe(1);
});

test("跨标签页换账号拒绝原局保存，回原账号按原 ID 重试", async ({
  page,
  context,
  baseURL,
}) => {
  const a = account(),
    b = account();
  await page.goto(`${basePath}#corsi`);
  await login(page, a.token);
  let fail = true;
  await page.route(`**${basePath}api/results`, async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({ status: 503, json: { error: "隔离首次保存失败" } });
    } else await route.continue();
  });
  await start(page);
  await completeFail(page);
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toBeVisible();
  await context.request.post(`${baseURL}${basePath}api/login`, {
    headers: { origin: baseURL! },
    data: { token: b.token },
  });
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(
    page.getByText("当前账户与开局账户不同", { exact: false }),
  ).toBeVisible();
  await context.request.post(`${baseURL}${basePath}api/login`, {
    headers: { origin: baseURL! },
    data: { token: a.token },
  });
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.getByTestId("corsi-save-status")).toContainText("已保存");
});

test("前台阻塞漏展示作废，不保存或降低起点", async ({ page }) => {
  const a = account();
  seed(a.user.id);
  await page.goto(`${basePath}#corsi`);
  await login(page, a.token);
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/results")) writes++;
  });
  await start(page, false, false);
  await page.evaluate(() => {
    const end = performance.now() + 1200;
    while (performance.now() < end) {
      /* real foreground stall */
    }
  });
  await expect(page.getByTestId("corsi-abort")).toContainText("本局未计入");
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "返回准备页", exact: true }).click();
  await expect(page.getByTestId("corsi-current-start")).toContainText("3 格");
});

test("异常超长起点可安全退出并恢复，保留无限长度合同", async ({ page }) => {
  const a = account();
  seed(a.user.id, {
    startLength: 4294967298,
    failedLength: 4294967298,
    firstTrialCorrect: false,
    maxFirstTryLength: 0,
  });
  await page.goto(`${basePath}#corsi`);
  await login(page, a.token);
  await expect(page.getByTestId("corsi-current-start")).toContainText(
    "4294967297",
  );
  await page.getByRole("button", { name: "开始本局", exact: true }).click();
  await expect(page.getByTestId("corsi-abort")).toContainText("资源");
  await page
    .getByRole("button", { name: "从 2 格重新开始", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认恢复", exact: true })
    .click();
  await expect(page.getByTestId("corsi-current-start")).toContainText("2 格");
});

test("九格之后仍增加长度，离开未完成局不保存", async ({ page }) => {
  const a = account();
  seed(a.user.id, { failedLength: 10, maxFirstTryLength: 9 });
  await page.goto(`${basePath}#corsi`);
  await login(page, a.token);
  await expect(page.getByTestId("corsi-current-start")).toContainText("9 格");
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/results")) writes++;
  });
  await start(page);
  for (const cell of await observe(page, 9))
    await page
      .getByRole("button", { name: `方块 ${cell + 1}`, exact: true })
      .click();
  await expect(page.getByTestId("corsi-feedback")).toContainText("正确");
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await giveUp(page, 9);
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await observe(page, 10);
  await page.getByRole("link", { name: "训练大厅", exact: true }).click();
  expect(writes).toBe(0);
  await page
    .getByRole("article", { name: "顺序记忆 · Corsi 方块", exact: true })
    .getByRole("button", { name: "开始训练", exact: true })
    .click();
  await expect(page.getByTestId("corsi-current-start")).toContainText("9 格");
});

test("游客起点按方向保留在当前文档，刷新后重置且登录不补传", async ({
  page,
}) => {
  await page.goto(`${basePath}#corsi`);
  await start(page, true);
  for (const length of [2, 3]) {
    for (const cell of await observe(page, length))
      await page.keyboard.press(String(cell + 1));
    await page.getByRole("button", { name: "下一题", exact: true }).click();
    await giveUp(page, length);
    await page.getByRole("button", { name: "下一题", exact: true }).click();
  }
  await completeFail(page, 4);
  await page.getByRole("button", { name: "再练一局", exact: true }).click();
  await expect(page.getByTestId("corsi-current-start")).toContainText("3 格");
  await page.getByRole("button", { name: "倒序", exact: true }).click();
  await expect(page.getByTestId("corsi-current-start")).toContainText("2 格");
  await page.getByRole("button", { name: "正序", exact: true }).click();
  await expect(page.getByTestId("corsi-current-start")).toContainText("3 格");
  const a = account();
  await login(page, a.token);
  await expect(page.getByTestId("corsi-current-start")).toContainText("2 格");
  expect(
    (
      await (
        await page.request.get(`${basePath}api/history?game=${CORSI_FORWARD}`)
      ).json()
    ).total,
  ).toBe(0);
  await page.reload();
  await expect(page.getByTestId("corsi-current-start")).toContainText("2 格");
});

test("移动触屏、首次输入与游客刷新边界", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(`${basePath}#corsi`);
    await start(page, true);
    const cells = await observe(page, 2);
    await page
      .getByRole("button", { name: `方块 ${cells[0] + 1}`, exact: true })
      .tap();
    await expect(page.getByTestId("corsi-entered")).toContainText("1 / 2");
    await page
      .getByRole("button", { name: `方块 ${cells[1] + 1}`, exact: true })
      .tap();
    await expect(page.getByTestId("corsi-feedback")).toContainText("正确");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/corsi-mobile.png",
      fullPage: true,
    });
    await page.reload();
    await expect(page.getByTestId("corsi-current-start")).toContainText("2 格");
  } finally {
    await context.close();
  }
});
