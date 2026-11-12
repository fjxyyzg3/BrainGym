import { homedir } from "node:os";
import { resolve } from "node:path";
import { normalizeBasePath } from "../shared/paths.js";
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT 无效");
  const origin = env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;
  if (
    new URL(origin).origin !== origin ||
    !["http:", "https:"].includes(new URL(origin).protocol)
  )
    throw new Error("APP_ORIGIN 必须是无尾斜杠的 HTTP(S) origin");
  const managed = env.WHEELMAKER_APP_MANAGED === "1",
    basePath = normalizeBasePath(env.APP_BASE_PATH);
  const serviceId = env.WHEELMAKER_SERVICE_ID ?? "braingym",
    host = env.HOST ?? "127.0.0.1";
  if (
    managed &&
    (!/^[a-z][a-z0-9-]{0,62}$/.test(serviceId) ||
      basePath !== `/${serviceId}/` ||
      host !== "127.0.0.1")
  )
    throw new Error("托管服务 ID、APP_BASE_PATH 和回环 HOST 必须一致");
  return {
    port,
    host,
    origin,
    basePath,
    managed,
    serviceId,
    target: `http://127.0.0.1:${port}`,
    publicUrl: `${origin}${basePath}`,
    stateDir: resolve(
      env.WHEELMAKER_STATE_DIR ?? resolve(homedir(), ".wheelmaker"),
    ),
    databasePath: resolve(env.DATABASE_PATH ?? "data/braingym.sqlite"),
    secure:
      env.COOKIE_SECURE === "true" ||
      (env.COOKIE_SECURE !== "false" && env.NODE_ENV === "production"),
    staticRoot: resolve("dist/client"),
  };
}
