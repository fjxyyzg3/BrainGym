import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  assertNoLinks,
  withoutControlCredentials,
} from "../../src/server/environment.js";
import {
  assertOwnedProgram,
  assertSeparated,
  atomicJson,
  hash,
  manifest,
  appId,
} from "./paths.js";
import {
  privateDirectory,
  copyProgram,
  clearProgram,
  backupDatabase,
  databaseFingerprints,
  assertPreserved,
  guardConfiguration,
  programManifest,
  type Fingerprints,
} from "./files.js";
import {
  controller,
  setDefinition,
  targetDefinition,
  validateReload,
  readHubConfig,
  type Hub,
  type Definition,
} from "./hub.js";
import { deploy, type DeploymentOperations } from "./deploy.js";
import { ReleaseError, assertNodeRuntime } from "./process.js";
import { chromium } from "@playwright/test";

interface Context {
  target: string;
  original: Definition;
  next: Definition;
  runtime: string;
  configPath: string;
  hubId: string;
  definitionWritten: boolean;
  loadRequested: boolean;
  fingerprints?: Fingerprints;
  baseline?: { hubId: string; apps: Definition[] };
}

export async function verifyHttp(origin: string, release?: string) {
  const base = `${origin}/braingym/`;
  const get = (path: string) =>
    fetch(new URL(path, base), {
      signal: AbortSignal.timeout(10000),
      redirect: "error",
      cache: "no-store",
    });
  try {
    const health = await get("api/health");
    if (health.status !== 200 || (await health.json()).ok !== true)
      throw new Error("health");
    const html = await get("");
    if (
      html.status !== 200 ||
      !html.headers
        .get("content-security-policy")
        ?.includes("frame-ancestors 'none'") ||
      html.headers.get("x-content-type-options") !== "nosniff" ||
      html.headers.get("referrer-policy") !== "same-origin"
    )
      throw new Error("headers");
    const text = await html.text();
    if (
      !text.includes('<base href="/braingym/"') ||
      (release &&
        !text.includes(`name="braingym-release" content="${release}"`))
    )
      throw new Error("release");
    for (const match of text.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (!/^(?:assets\/|icons\/|favicon|manifest)/.test(match[1])) continue;
      const url = new URL(match[1], base);
      if (
        url.origin !== new URL(base).origin ||
        !url.pathname.startsWith("/braingym/")
      )
        throw new Error("path");
      const resource = await get(match[1]);
      if (!resource.ok) throw new Error("resource");
      await resource.arrayBuffer();
    }
    for (const path of ["api/me", "api/history", "api/bests"])
      if ((await get(path)).status !== 401) throw new Error("anonymous");
    return {
      passed: true,
      https: new URL(origin).protocol === "https:",
      hstsPresent: html.headers.has("strict-transport-security"),
      permissionsPolicyPresent: html.headers.has("permissions-policy"),
    };
  } catch {
    throw new ReleaseError(
      "HTTP_VERIFICATION",
      "实际入口的健康、资源、发行标记、匿名授权或安全头验证失败",
    );
  }
}

export function browserExecutable() {
  return (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ].find((path) => existsSync(path))
  );
}

export async function verifyBrowser(origin: string, release: string) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutable(),
    env: withoutControlCredentials(process.env),
  });
  try {
    const page = await browser.newPage();
    let failed = false;
    const asset = (kind: string) =>
      ["script", "stylesheet", "image", "font"].includes(kind);
    page.on("pageerror", () => {
      failed = true;
    });
    page.on("requestfailed", (request) => {
      if (asset(request.resourceType())) failed = true;
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && asset(response.request().resourceType()))
        failed = true;
    });
    await page.goto(`${origin}/braingym/`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    if (
      failed ||
      (await page
        .locator('meta[name="braingym-release"]')
        .getAttribute("content")) !== release ||
      (await page.locator("main").count()) !== 1
    )
      throw new ReleaseError(
        "BROWSER_VERIFICATION",
        "真实浏览器加载、运行或发行版本检查失败",
      );
  } catch {
    throw new ReleaseError(
      "BROWSER_VERIFICATION",
      "真实浏览器页面或资源检查失败；未输出私有 URL",
    );
  } finally {
    await browser.close();
  }
}

export function deploymentOperations(
  hub: Hub,
  target: string,
  runtime: string,
  home: string,
  options: {
    isolated?: boolean;
    expectedFiles: Record<string, string>;
    release: string;
    resume?: boolean;
  },
) {
  const key = hash(resolve(target).toLowerCase()).slice(0, 24);
  const contextPath = join(home, `${key}.context.json`);
  const original = hub.config.apps.find((app) => app.id === appId)!;
  let context: Context = options.resume
    ? JSON.parse(readFileSync(contextPath, "utf8"))
    : {
        target: resolve(target),
        runtime: resolve(runtime),
        original,
        next: targetDefinition(hub, target, options.isolated),
        configPath: hub.configPath,
        hubId: hub.config.hubId,
        definitionWritten: false,
        loadRequested: false,
      };
  if (
    context.target !== resolve(target) ||
    context.hubId !== hub.config.hubId ||
    context.configPath !== hub.configPath
  )
    throw new ReleaseError("RECOVERY_IDENTITY", "恢复现场与当前正式目标不一致");
  const database = resolve(
    context.original.cwd,
    context.original.env.DATABASE_PATH,
  );
  const control = controller(hub, context.next);
  let oldGuard: (() => Promise<void>) | undefined;
  const save = () => atomicJson(contextPath, context);
  const changedDefinition =
    JSON.stringify(context.original) !== JSON.stringify(context.next);
  const operations: DeploymentOperations = {
    async preflight() {
      assertNodeRuntime(context.next.executable);
      assertNoLinks(target);
      assertNoLinks(runtime);
      assertNoLinks(database);
      assertSeparated(target, dirname(database));
      assertSeparated(target, home);
      assertSeparated(dirname(database), home);
      if (resolve(context.original.cwd) !== resolve(target))
        assertSeparated(target, context.original.cwd);
      assertOwnedProgram(target);
      if (
        JSON.stringify(manifest(runtime)) !==
        JSON.stringify(options.expectedFiles)
      )
        throw new ReleaseError("ARTIFACT_CHANGED", "发布前候选或依赖已变化");
      const current = readHubConfig(hub.stateDir);
      if (JSON.stringify(current.apps) !== JSON.stringify(hub.config.apps))
        throw new ReleaseError("CONFIG_CHANGED", "预检期间 Hub 定义已变化");
      const snapshot = await hub.snapshot();
      if (snapshot.apps.find((app) => app.id === appId)?.pendingRestart)
        throw new ReleaseError(
          "APP_PENDING_RESTART",
          "BrainGym 已有待重启定义，需先确认现役版本",
        );
      if (changedDefinition) {
        const baselinePath = join(dirname(home), "loaded-config.json");
        if (existsSync(baselinePath))
          context.baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
        validateReload(current, snapshot, context.baseline);
        oldGuard = await guardConfiguration(
          hub.configPath,
          hash(readFileSync(hub.configPath)),
        );
      }
      databaseFingerprints(database);
      const initial = await control.state();
      if (initial.phase === "running") await control.waitReady();
      save();
    },
    async backup(directory) {
      privateDirectory(directory);
      context.fingerprints = databaseFingerprints(database);
      save();
      backupDatabase(database, join(directory, "database"));
      copyProgram(context.original.cwd, join(directory, "program"));
      atomicJson(join(directory, "original-definition.json"), context.original);
      atomicJson(
        join(directory, "program-files.json"),
        manifest(join(directory, "program")),
      );
    },
    async replace() {
      if (
        JSON.stringify(manifest(runtime)) !==
        JSON.stringify(options.expectedFiles)
      )
        throw new ReleaseError("ARTIFACT_CHANGED", "切换前候选摘要不一致");
      privateDirectory(target);
      clearProgram(target);
      copyProgram(runtime, target);
      if (
        JSON.stringify(manifest(target)) !==
        JSON.stringify(options.expectedFiles)
      )
        throw new ReleaseError("COPY_INCOMPLETE", "正式程序复制不完整");
    },
    async loadDefinition() {
      if (oldGuard) {
        await oldGuard();
        oldGuard = undefined;
      }
      if (!changedDefinition) return;
      await setDefinition(
        hub,
        context.original,
        context.next,
        context.baseline,
        {
          onWritten() {
            context.definitionWritten = true;
            save();
          },
          onLoadRequested() {
            context.loadRequested = true;
            save();
          },
        },
      );
    },
    async verify() {
      if (
        JSON.stringify(manifest(target)) !==
        JSON.stringify(options.expectedFiles)
      )
        throw new ReleaseError("COPY_INCOMPLETE", "正式程序与演练产物不一致");
      if (!context.fingerprints)
        throw new ReleaseError("BASELINE_MISSING", "缺少迁移前数据基线");
      assertPreserved(context.fingerprints, databaseFingerprints(database));
      const loopback = await verifyHttp(
        `http://127.0.0.1:${context.next.env.PORT}`,
        options.release,
      );
      const published = await verifyHttp(
        context.next.env.APP_ORIGIN,
        options.release,
      );
      await verifyBrowser(context.next.env.APP_ORIGIN, options.release);
      atomicJson(join(home, `${key}.verification.json`), {
        loopback,
        published,
        browser: true,
        dataPreserved: true,
      });
      if (context.loadRequested)
        atomicJson(
          join(dirname(home), "loaded-config.json"),
          readHubConfig(hub.stateDir),
        );
    },
    async restoreProgram(directory) {
      const backup = join(directory, "program");
      const expected = JSON.parse(
        readFileSync(join(directory, "program-files.json"), "utf8"),
      );
      if (JSON.stringify(manifest(backup)) !== JSON.stringify(expected))
        throw new ReleaseError("BACKUP_CHANGED", "程序备份摘要不符");
      clearProgram(target);
      if (resolve(context.original.cwd) === resolve(target))
        copyProgram(backup, target);
      else {
        const originalManifest = programManifest(context.original.cwd);
        for (const [path, digest] of Object.entries(
          expected as Record<string, string>,
        ))
          if (originalManifest[path] !== digest)
            throw new ReleaseError(
              "ORIGINAL_CHANGED",
              "原仓库运行程序被外部修改，不能覆盖他人的改动",
            );
      }
    },
    async restoreDefinition() {
      if (oldGuard) {
        await oldGuard();
        oldGuard = undefined;
      }
      const actual = readHubConfig(hub.stateDir).apps.find(
        (app) => app.id === appId,
      )!;
      if (
        JSON.stringify(actual) === JSON.stringify(context.original) &&
        !context.loadRequested
      )
        return;
      if (
        JSON.stringify(actual) !== JSON.stringify(context.next) &&
        JSON.stringify(actual) !== JSON.stringify(context.original)
      )
        throw new ReleaseError(
          "CONFIG_CHANGED",
          "恢复时目标定义已被外部修改，拒绝覆盖",
        );
      if (JSON.stringify(actual) === JSON.stringify(context.original)) {
        if (context.loadRequested) {
          const config = readHubConfig(hub.stateDir);
          const before = validateReload(
            config,
            await hub.snapshot(),
            context.baseline,
          );
          const releaseGuard = await guardConfiguration(
            hub.configPath,
            hash(readFileSync(hub.configPath)),
          );
          try {
            await hub.action("reload");
            if (
              before !==
              validateReload(config, await hub.snapshot(), context.baseline)
            )
              throw new ReleaseError(
                "OTHER_APP_CHANGED",
                "恢复重载后非目标应用状态发生变化，保留现场",
              );
          } finally {
            await releaseGuard();
          }
        }
        return;
      }
      await setDefinition(hub, actual, context.original, context.baseline, {
        diskOnly: !context.loadRequested,
      });
    },
  };
  return {
    control,
    operations,
    context,
    async close() {
      if (oldGuard) {
        await oldGuard();
        oldGuard = undefined;
      }
    },
  };
}

export async function publish(
  hub: Hub,
  target: string,
  runtime: string,
  home: string,
  expectedFiles: Record<string, string>,
  release: string,
  isolated = false,
) {
  privateDirectory(home);
  const connection = deploymentOperations(hub, target, runtime, home, {
    expectedFiles,
    release,
    isolated,
  });
  try {
    return await deploy(
      target,
      home,
      connection.control,
      connection.operations,
    );
  } finally {
    await connection.close();
  }
}
