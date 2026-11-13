import { test, expect, chromium, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/server/store.js";
import { normalizeBasePath } from "../../src/shared/paths.js";
import { releaseServer } from "./pwa-server";

const basePath = normalizeBasePath(process.env.E2E_BASE_PATH);
test("PWA dual mode offline guest uses cached shell and never uploads after reconnect", async ({
  page,
  context,
}) => {
  await prime(page);
  await page.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  let uploads = 0;
  offline.on("request", (request) => {
    if (request.url().endsWith("/api/results")) uploads++;
  });
  await offline.goto(`${basePath}#color-n-back`);
  await expect(
    offline.getByRole("heading", { name: "位置＋颜色 N-back", exact: true }),
  ).toBeVisible();
  await playOffline(offline);
  await expect(offline.getByTestId("position-score")).toHaveText("50.0 分");
  await expect(offline.getByTestId("color-score")).toHaveText("50.0 分");
  await context.setOffline(false);
  await offline.bringToFront();
  expect(uploads).toBe(0);
  expect(await offline.evaluate(() => localStorage.length)).toBe(0);
});
async function prime(page: Page, url = basePath) {
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}
async function playOffline(page: Page) {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page
    .getByRole("button", { name: "以游客身份练习", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "记忆准备 1 / 2" }),
  ).toBeVisible();
  await page.clock.fastForward(81000);
  await expect(page.getByTestId("score")).toContainText("50.0");
  await expect(page.locator(".save-message")).toContainText("游客练习");
}

test("PWA manifest is installable and API responses bypass the worker", async ({
  baseURL,
}) => {
  // Installation is disabled by Chromium in Playwright's default incognito context.
  const profile = mkdtempSync(join(tmpdir(), "braingym-installability-"));
  const context = await chromium.launchPersistentContext(profile, {
    baseURL,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await prime(page);
    const session = await context.newCDPSession(page);
    const manifest = await session.send("Page.getAppManifest");
    expect(manifest.errors).toEqual([]);
    expect(JSON.parse(manifest.data!)).toMatchObject({
      id: basePath,
      start_url: basePath,
      scope: basePath,
      display: "standalone",
    });
    expect(
      (await session.send("Page.getInstallabilityErrors")).installabilityErrors,
    ).toEqual([]);
    const responseEvent = page.waitForResponse((response) =>
      response.url().endsWith(`${basePath}api/history`),
    );
    await page.evaluate(async (path) => {
      await fetch(`${path}api/history`, { cache: "no-store" });
    }, basePath);
    const response = await responseEvent;
    expect(response.status()).toBe(401);
    expect(response.fromServiceWorker()).toBe(false);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const icons = await page.evaluate(
      async (path) =>
        Promise.all(
          [
            ["icon-192.png", 192],
            ["icon-512.png", 512],
            ["maskable-512.png", 512],
            ["apple-touch-icon.png", 180],
          ].map(async ([name, size]) => {
            const image = new Image();
            image.src = `${path}icons/${name}`;
            await image.decode();
            return image.naturalWidth === size && image.naturalHeight === size;
          }),
        ),
      basePath,
    );
    expect(icons).toEqual([true, true, true, true]);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test("PWA cold start offline requires explicit guest choice and never uploads", async ({
  page,
  context,
}) => {
  await prime(page);
  await page.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  let uploads = 0;
  offline.on("request", (request) => {
    if (request.url().endsWith("/api/results")) uploads++;
  });
  await offline.goto(basePath);
  await expect(
    offline.getByRole("heading", { name: "训练大厅", exact: true }),
  ).toBeVisible();
  await offline
    .getByRole("article", { name: "空间 N-back", exact: true })
    .getByRole("button", { name: "开始训练", exact: true })
    .click();
  await expect(
    offline.getByRole("button", { name: "以游客身份练习", exact: true }),
  ).toBeVisible();
  await playOffline(offline);
  await context.setOffline(false);
  await offline.evaluate(() => dispatchEvent(new Event("online")));
  await expect(offline.locator(".save-message")).toContainText("游客练习");
  expect(uploads).toBe(0);
  const cacheURLs = await offline.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      urls.push(...(await cache.keys()).map((request) => request.url));
    }
    return urls;
  });
  expect(cacheURLs.length).toBeGreaterThan(5);
  expect(
    cacheURLs.every(
      (url) =>
        !url.includes("/api/") && new URL(url).pathname.startsWith(basePath),
    ),
  ).toBe(true);
  expect(await offline.evaluate(() => localStorage.length)).toBe(0);
  expect(await offline.evaluate(() => indexedDB.databases())).toEqual([]);
});

test("authenticated offline guest preserves session and stays guest after reconnection", async ({
  page,
  context,
}) => {
  const store = new Store(process.env.E2E_DATABASE_PATH!);
  const account = store.createUser(`PWA-${randomUUID().slice(0, 6)}`);
  store.close();
  await prime(page);
  await page.getByRole("button", { name: "Token 登录", exact: true }).click();
  await page.getByLabel("个人 Token", { exact: true }).fill(account.token);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const cookies = await context.cookies();
  await page
    .getByRole("article", { name: "空间 N-back", exact: true })
    .getByRole("button", { name: "开始训练", exact: true })
    .click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "开始本局", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "记忆准备 1 / 2" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "以游客身份练习", exact: true }),
  ).toBeVisible();
  await playOffline(page);
  expect(await context.cookies()).toEqual(cookies);
  await context.setOffline(false);
  const identity = await page.evaluate(
    async (path) =>
      (await fetch(`${path}api/me`, { cache: "no-store" })).json(),
    basePath,
  );
  expect(identity.user.id).toBe(account.user.id);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(page.locator(".save-message")).toContainText("游客练习");
  expect(
    (await (await page.request.get(`${basePath}api/history`)).json()).total,
  ).toBe(0);
  const cachedContents = await page.evaluate(async () => {
    const entries: { url: string; text: string }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({ url: request.url, text: await response!.text() });
      }
    }
    return entries;
  });
  expect(
    cachedContents.every(
      ({ url, text }) =>
        !url.includes("/api/") &&
        !text.includes(account.token) &&
        !text.includes(account.user.name),
    ),
  ).toBe(true);
});

test("PWA registration failure leaves online training usable", async ({
  page,
  context,
}) => {
  const service = await releaseServer(basePath);
  service.state.blockWorker = true;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(service.url);
    // Worker script requests belong to the browser, not the page response stream.
    await expect.poll(() => service.state.blockedWorkers).toBeGreaterThan(0);
    await expect(
      page.getByRole("heading", { name: "训练大厅", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("article", { name: "空间 N-back", exact: true })
      .getByRole("button", { name: "开始训练", exact: true })
      .click();
    await page.getByRole("button", { name: "开始本局", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "记忆准备 1 / 2" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(context.pages().map((item) => item.close()));
    await service.close();
  }
});

test("PWA storage quota failure leaves online app usable and retries on reload", async ({
  page,
  context,
  baseURL,
}) => {
  const session = await context.newCDPSession(page);
  const origin = new URL(baseURL!).origin;
  const statuses: string[] = [];
  await session.send("ServiceWorker.enable");
  session.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
    for (const version of versions) {
      if (version.scriptURL === `${origin}${basePath}sw.js`)
        statuses.push(version.status);
    }
  });
  await session.send("Storage.overrideQuotaForOrigin", {
    origin,
    quotaSize: 1,
  });
  try {
    await page.goto(basePath);
    await expect(
      page.getByRole("heading", { name: "训练大厅", exact: true }),
    ).toBeVisible();
    await expect.poll(() => statuses.includes("redundant")).toBe(true);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    await page
      .getByRole("article", { name: "空间 N-back", exact: true })
      .getByRole("button", { name: "开始训练", exact: true })
      .click();
    await page.getByRole("button", { name: "开始本局", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "记忆准备 1 / 2" }),
    ).toBeVisible();
    await session.send("Storage.overrideQuotaForOrigin", { origin });
    await prime(page);
    expect(await page.evaluate(() => caches.keys())).toHaveLength(1);
  } finally {
    await session.send("Storage.overrideQuotaForOrigin", { origin });
  }
});

test("PWA update waits for all windows and preserves a pending result", async ({
  page,
  context,
}) => {
  const service = await releaseServer(basePath);
  try {
    await prime(page, service.url);
    await page.getByRole("button", { name: "Token 登录", exact: true }).click();
    await page
      .getByLabel("个人 Token", { exact: true })
      .fill(service.account.token);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const oldVersion = await page
      .locator('meta[name="braingym-release"]')
      .getAttribute("content");
    const other = await context.newPage();
    await other.goto(service.url);
    const sentinel =
      basePath === "/"
        ? "braingym:pwa:%2Fother%2F:sentinel"
        : "braingym:pwa:%2F:sentinel";
    await page.evaluate(async (name) => {
      const cache = await caches.open(name);
      await cache.put("sentinel", new Response("untouched"));
    }, sentinel);
    await page
      .getByRole("article", { name: "空间 N-back", exact: true })
      .getByRole("button", { name: "开始训练", exact: true })
      .click();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.getByRole("button", { name: "开始本局", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "记忆准备 1 / 2" }),
    ).toBeVisible();
    service.state.failSaves = true;
    service.upgrade();
    const workerEvent = context.waitForEvent("serviceworker");
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    const next = await workerEvent;
    await expect
      .poll(() =>
        page.evaluate(
          async () => !!(await navigator.serviceWorker.ready).waiting,
        ),
      )
      .toBe(true);
    await expect(
      page.getByRole("heading", { name: "记忆准备 1 / 2" }),
    ).toBeVisible();
    await page.clock.fastForward(81000);
    await expect(page.locator(".save-message")).toContainText("未保存");
    await expect(page.getByRole("button", { name: "重试保存" })).toBeVisible();
    await expect(page.locator('meta[name="braingym-release"]')).toHaveAttribute(
      "content",
      oldVersion!,
    );
    await other.close();
    expect(
      await page.evaluate(
        async () => !!(await navigator.serviceWorker.ready).waiting,
      ),
    ).toBe(true);
    await page.close();
    await expect
      .poll(() =>
        next.evaluate(
          () =>
            !(self as unknown as { registration: { waiting: unknown } })
              .registration.waiting,
        ),
      )
      .toBe(true);
    const reopened = await context.newPage();
    await reopened.goto(service.url);
    await expect(reopened).toHaveTitle("BrainGym · 更新验收版本");
    await expect(
      reopened.locator('meta[name="braingym-release"]'),
    ).not.toHaveAttribute("content", oldVersion!);
    expect(
      await reopened.evaluate(
        async (name) => (await caches.keys()).includes(name),
        sentinel,
      ),
    ).toBe(true);
    const ownPrefix = `braingym:pwa:${encodeURIComponent(basePath)}:`;
    expect(
      await reopened.evaluate(
        async (prefix) =>
          (await caches.keys()).filter((name) => name.startsWith(prefix))
            .length,
        ownPrefix,
      ),
    ).toBe(1);
  } finally {
    await Promise.all(context.pages().map((item) => item.close()));
    await service.close();
  }
});

for (const fault of ["integrity", "missing", "shell"] as const) {
  test(`PWA ${fault} update keeps the old offline shell and can recover`, async ({
    page,
    context,
  }) => {
    const service = await releaseServer(basePath);
    try {
      await prime(page, service.url);
      const originalTitle = await page.title();
      service.state.resourceFault = fault;
      service.upgrade();
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.ready).update();
      });
      await expect.poll(() => service.state.faultHits).toBeGreaterThan(0);
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.ready;
            return !registration.installing && !registration.waiting;
          }),
        )
        .toBe(true);
      await context.setOffline(true);
      await page.reload();
      await expect(page).toHaveTitle(originalTitle);
      await expect(
        page.getByRole("heading", { name: "训练大厅", exact: true }),
      ).toBeVisible();
      service.state.resourceFault = "none";
      await context.setOffline(false);
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.ready).update();
      });
      await expect
        .poll(() =>
          page.evaluate(
            async () => !!(await navigator.serviceWorker.ready).waiting,
          ),
        )
        .toBe(true);
    } finally {
      await Promise.all(context.pages().map((item) => item.close()));
      await service.close();
    }
  });
}
