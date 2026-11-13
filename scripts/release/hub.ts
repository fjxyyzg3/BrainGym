import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { parseEnv } from "node:util";
import { createServer } from "node:net";
import { registryClient } from "../wheelmaker-rpc.mjs";
import type { DeploymentControl, ManagedState } from "./deploy.js";
import { appId, serviceId, hash } from "./paths.js";
import { guardConfiguration, windows, privateDirectory } from "./files.js";
import { delay, ReleaseError } from "./process.js";
import { assertNoLinks } from "../../src/server/environment.js";

export interface Definition {
  id: string;
  name?: string;
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}
export interface HubConfig extends Record<string, unknown> {
  apps: Definition[];
  publicUrl: string;
  hubId: string;
  token?: string;
}
export interface HubSnapshot {
  apps: ManagedState[];
  mappings: {
    id: string;
    state: string;
    target?: string;
    publicUrl?: string;
  }[];
}
export interface Hub {
  config: HubConfig;
  configPath: string;
  stateDir: string;
  snapshot(): Promise<HubSnapshot>;
  action(action: "start" | "stop" | "reload"): Promise<void>;
  close(): void;
}

export function readHubConfig(stateDir: string): HubConfig {
  assertNoLinks(join(stateDir, "config.json"));
  const config = JSON.parse(
    readFileSync(join(stateDir, "config.json"), "utf8"),
  ) as HubConfig;
  if (
    !Array.isArray(config.apps) ||
    config.apps.filter((app) => app.id === appId).length !== 1 ||
    !config.hubId
  )
    throw new ReleaseError(
      "HUB_CONFIG_INVALID",
      "正式 Hub 或 BrainGym 定义不唯一",
    );
  return config;
}

export function configuredStateDir(root: string) {
  const path = join(root, ".env.production.local");
  assertNoLinks(path);
  const local = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  return resolve(
    local.WHEELMAKER_STATE_DIR ??
      process.env.WHEELMAKER_STATE_DIR ??
      join(homedir(), ".wheelmaker"),
  );
}

export async function connectHub(
  root: string,
  options: { stateDir?: string; token?: string; isolated?: boolean } = {},
): Promise<Hub> {
  const localPath = join(root, ".env.production.local");
  if (!options.isolated) assertNoLinks(localPath);
  const local =
    !options.isolated && existsSync(localPath)
      ? parseEnv(readFileSync(localPath, "utf8"))
      : {};
  const stateDir = resolve(
    options.stateDir ??
      local.WHEELMAKER_STATE_DIR ??
      process.env.WHEELMAKER_STATE_DIR ??
      join(homedir(), ".wheelmaker"),
  );
  const config = readHubConfig(stateDir);
  const url = new URL(config.publicUrl);
  if (
    url.origin !== config.publicUrl ||
    !(
      url.protocol === "https:" ||
      (options.isolated &&
        url.protocol === "http:" &&
        url.hostname === "127.0.0.1")
    )
  )
    throw new ReleaseError(
      "REGISTRY_ORIGIN_INVALID",
      "Registry 控制入口必须为可信 HTTPS Origin",
    );
  const token =
    options.token ??
    local.BRAINGYM_REGISTRY_TOKEN ??
    process.env.BRAINGYM_REGISTRY_TOKEN ??
    config.token;
  if (!token)
    throw new ReleaseError(
      "AUTH_REQUIRED",
      "请在未跟踪 .env.production.local 中配置现有 BRAINGYM_REGISTRY_TOKEN",
    );
  let client: Awaited<ReturnType<typeof registryClient>>;
  try {
    client = await registryClient({
      origin: url.origin,
      token,
      hubId: config.hubId,
    });
  } catch {
    throw new ReleaseError(
      "HUB_UNAVAILABLE",
      "现有 Hub 控制认证或连接失败；正式实例未停止",
    );
  }
  return {
    config,
    configPath: join(stateDir, "config.json"),
    stateDir,
    async snapshot() {
      try {
        const response = (await client.call("hub.state.get", {
          sections: ["monitor", "forwarding"],
        })) as {
          state?: { sections?: Record<string, { data?: unknown }> };
          sections?: Record<string, { data?: unknown }>;
        };
        const sections = (response.state ?? response).sections;
        const apps = (sections?.monitor?.data as { apps?: ManagedState[] })
          ?.apps;
        const mappings = (
          sections?.forwarding?.data as { mappings?: HubSnapshot["mappings"] }
        )?.mappings;
        if (!Array.isArray(apps) || !Array.isArray(mappings))
          throw new Error("Invalid snapshot");
        return { apps, mappings };
      } catch {
        throw new ReleaseError(
          "HUB_STATE",
          "无法取得可信 Monitor 和 Forwarding 状态",
        );
      }
    },
    async action(action) {
      try {
        await client.call(
          "hub.state.action",
          {
            section: "monitor",
            action,
            ...(action === "reload" ? {} : { params: { appId } }),
          },
          60000,
        );
      } catch {
        throw new ReleaseError(
          "HUB_ACTION",
          "Monitor 控制未确认，必须核对实际状态",
        );
      }
    },
    close: client.close,
  };
}

export function targetDefinition(
  hub: Hub,
  target: string,
  isolated = false,
): Definition {
  const original = hub.config.apps.find((app) => app.id === appId)!;
  if (
    !original.cwd ||
    !original.executable ||
    !original.env?.DATABASE_PATH ||
    JSON.stringify(original.args) !==
      JSON.stringify(["dist/server/server/main.js"])
  )
    throw new ReleaseError(
      "DEFINITION_INVALID",
      "现有启动定义不符合直接 Node 托管合同",
    );
  const origin = new URL(original.env.APP_ORIGIN);
  if (
    origin.origin !== original.env.APP_ORIGIN ||
    (!isolated &&
      (origin.protocol !== "https:" ||
        original.env.COOKIE_SECURE !== "true" ||
        original.env.PORT !== "3001")) ||
    original.env.HOST !== "127.0.0.1" ||
    original.env.APP_BASE_PATH !== "/braingym/" ||
    original.env.WHEELMAKER_SERVICE_ID !== serviceId
  )
    throw new ReleaseError(
      "DEFINITION_INVALID",
      "现有正式入口、安全属性或回环端口不符",
    );
  return {
    ...original,
    cwd: resolve(target),
    args: [...original.args],
    env: {
      ...original.env,
      DATABASE_PATH: resolve(original.cwd, original.env.DATABASE_PATH),
      BRAINGYM_ENV: isolated ? "test" : "production",
      NODE_ENV: "production",
    },
  };
}

const nonTarget = (definitions: Definition[]) =>
  definitions
    .filter((app) => app.id !== appId)
    .sort((a, b) => a.id.localeCompare(b.id));
export function validateReload(
  config: HubConfig,
  snapshot: HubSnapshot,
  baseline?: { hubId: string; apps: Definition[] },
) {
  const others = nonTarget(config.apps);
  const states = snapshot.apps
    .filter((app) => app.id !== appId)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (
    JSON.stringify(others.map((app) => app.id)) !==
      JSON.stringify(states.map((app) => app.id)) ||
    states.some(
      (app) =>
        app.pendingRestart || !["running", "stopped"].includes(app.phase),
    )
  )
    throw new ReleaseError(
      "GLOBAL_RELOAD_UNSAFE",
      "其它应用有待加载、待重启或不稳定变更，拒绝全局 Reload",
    );
  if (
    others.length &&
    (!baseline ||
      baseline.hubId !== config.hubId ||
      JSON.stringify(nonTarget(baseline.apps)) !== JSON.stringify(others))
  )
    throw new ReleaseError(
      "LOADED_BASELINE_REQUIRED",
      "缺少可信已加载非目标定义基线，不能从简化快照推定安全",
    );
  return JSON.stringify(
    states.map(({ id, phase, pid, instanceId, pendingRestart, health }) => ({
      id,
      phase,
      pid,
      instanceId,
      pendingRestart,
      health,
    })),
  );
}

export async function setDefinition(
  hub: Hub,
  expected: Definition,
  next: Definition,
  baseline?: { hubId: string; apps: Definition[] },
  options: {
    diskOnly?: boolean;
    onWritten?: () => void;
    onLoadRequested?: () => void;
    onLoaded?: () => void;
  } = {},
) {
  if (JSON.stringify(expected) === JSON.stringify(next)) return;
  const raw = readFileSync(hub.configPath);
  const config: HubConfig = JSON.parse(raw.toString());
  if (
    JSON.stringify(config.apps.find((app) => app.id === appId)) !==
    JSON.stringify(expected)
  )
    throw new ReleaseError(
      "CONFIG_CHANGED",
      "BrainGym 定义已被其他操作修改，拒绝覆盖",
    );
  const before = options.diskOnly
    ? ""
    : validateReload(config, await hub.snapshot(), baseline);
  const candidate = {
    ...config,
    apps: config.apps.map((app) => (app.id === appId ? next : app)),
  };
  const suffix = randomUUID();
  const directory = join(hub.stateDir, ".tmp", `braingym-release-${suffix}`);
  privateDirectory(directory);
  const candidatePath = join(directory, `braingym-release-${suffix}.json`);
  const backupPath = join(directory, `braingym-release-backup-${suffix}.json`);
  writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  try {
    windows("replace", [
      "-Path",
      hub.configPath,
      "-Candidate",
      candidatePath,
      "-Destination",
      backupPath,
      "-ExpectedHash",
      hash(raw),
    ]);
    options.onWritten?.();
    if (options.diskOnly) return;
    const releaseGuard = await guardConfiguration(
      hub.configPath,
      hash(readFileSync(hub.configPath)),
    );
    try {
      if (
        JSON.stringify(JSON.parse(readFileSync(hub.configPath, "utf8"))) !==
        JSON.stringify(candidate)
      )
        throw new ReleaseError("CONFIG_CHANGED", "受保护配置与发布候选不一致");
      options.onLoadRequested?.();
      await hub.action("reload");
      options.onLoaded?.();
      const after = validateReload(candidate, await hub.snapshot(), {
        hubId: config.hubId,
        apps: config.apps,
      });
      if (before !== after)
        throw new ReleaseError(
          "OTHER_APP_CHANGED",
          "非目标应用状态发生变化，停止发布并保留现场",
        );
    } finally {
      await releaseGuard();
    }
  } finally {
    if (existsSync(candidatePath)) rmSync(candidatePath);
  }
}

async function portFree(port: number): Promise<boolean> {
  const server = createServer();
  return await new Promise<boolean>((done) => {
    server.once("error", () => done(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
      server.close(() => done(true)),
    );
  });
}

export function controller(
  hub: Hub,
  definition: Definition,
): DeploymentControl {
  const state = async () => {
    const snapshot = await hub.snapshot();
    const matches = snapshot.apps.filter((app) => app.id === appId);
    if (matches.length !== 1)
      throw new ReleaseError("APP_IDENTITY", "Monitor 中 BrainGym 身份不唯一");
    return matches[0];
  };
  const wait = async (predicate: () => Promise<boolean>) => {
    const end = Date.now() + 45000;
    do {
      try {
        if (await predicate()) return;
      } catch {
        /* Startup/reconnection may not have published a snapshot yet. */
      }
      await delay(200);
    } while (Date.now() < end);
    throw new ReleaseError("STATE_TIMEOUT", "进程或转发状态未在期限内收敛");
  };
  return {
    state,
    stop: () => hub.action("stop"),
    start: () => hub.action("start"),
    waitStopped: (previous) =>
      wait(async () => {
        const current = await state();
        if (current.phase !== "stopped" || current.pid) return false;
        if (previous.pid) {
          try {
            process.kill(previous.pid, 0);
            return false;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
          }
        }
        const snapshot = await hub.snapshot();
        return (
          !snapshot.mappings.some((mapping) => mapping.id === serviceId) &&
          (await portFree(Number(definition.env.PORT)))
        );
      }),
    waitReady: () =>
      wait(async () => {
        const current = await state();
        const snapshot = await hub.snapshot();
        const mapping = snapshot.mappings.find(
          (mapping) => mapping.id === serviceId,
        );
        if (
          current.phase !== "running" ||
          current.health?.state !== "healthy" ||
          !current.pid ||
          mapping?.state !== "ready" ||
          mapping.target !== `http://127.0.0.1:${definition.env.PORT}` ||
          mapping.publicUrl !== `${definition.env.APP_ORIGIN}/braingym/`
        )
          return false;
        try {
          return (
            await fetch(
              `http://127.0.0.1:${definition.env.PORT}/braingym/api/health`,
              { signal: AbortSignal.timeout(3000) },
            )
          ).ok;
        } catch {
          return false;
        }
      }),
  };
}
