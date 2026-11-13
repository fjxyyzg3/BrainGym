import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parseEnv } from "node:util";

export type Environment = "development" | "production" | "test";

export function withoutControlCredentials(
  input: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([name]) =>
        !/^(BRAINGYM_REGISTRY_|WHEELMAKER_(BROWSER_|REGISTRY_|AUTH_))/i.test(
          name,
        ),
    ),
  );
}

export function assertNoLinks(path: string): void {
  let current = resolve(path);
  while (true) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error("环境路径不能经过符号链接或目录联接");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function isWithin(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return (
    value !== "" &&
    value !== ".." &&
    !value.startsWith(`..\\`) &&
    !value.startsWith("../") &&
    !isAbsolute(value)
  );
}

export function readEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  const managed = env.WHEELMAKER_APP_MANAGED === "1";
  const environment =
    env.BRAINGYM_ENV ??
    (managed || env.NODE_ENV === "production"
      ? "production"
      : env.NODE_ENV === "test"
        ? "test"
        : "development");
  if (!["development", "production", "test"].includes(environment))
    throw new Error("BRAINGYM_ENV 环境无效");
  if (managed && environment === "development")
    throw new Error("开发环境不能启用正式托管");
  if (environment === "development" && env.NODE_ENV === "production")
    throw new Error("开发环境与 NODE_ENV 冲突");
  const developmentRoot = resolve(cwd, ".runtime/development");
  if (environment !== "development" && !env.DATABASE_PATH)
    throw new Error("正式与测试环境必须显式设置 DATABASE_PATH");
  const databasePath = resolve(
    cwd,
    env.DATABASE_PATH ?? ".runtime/development/braingym.sqlite",
  );
  if (environment === "development" && !isWithin(developmentRoot, databasePath))
    throw new Error("开发数据库必须位于当前工作区 .runtime/development 内");
  if (
    environment === "test" &&
    databasePath
      .toLowerCase()
      .replaceAll("\\", "/")
      .endsWith("/data/braingym.sqlite")
  )
    throw new Error("测试 DATABASE_PATH 不能指向默认正式数据库");
  assertNoLinks(databasePath);
  return { environment: environment as Environment, databasePath };
}

export function developmentEnvironment(
  inherited: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  preview = false,
): NodeJS.ProcessEnv {
  const localPath = resolve(cwd, ".env.development.local");
  assertNoLinks(localPath);
  const local = existsSync(localPath)
    ? parseEnv(readFileSync(localPath, "utf8"))
    : {};
  const input = {
    ...withoutControlCredentials(inherited),
    ...withoutControlCredentials(local),
  };
  if (input.BRAINGYM_ENV && input.BRAINGYM_ENV !== "development")
    throw new Error("开发命令与 BRAINGYM_ENV 环境冲突");
  const port = (value: string | undefined, fallback: number) => {
    const result = Number(value ?? fallback);
    if (
      !Number.isInteger(result) ||
      result < 1 ||
      result > 65535 ||
      result === 3001
    )
      throw new Error("开发端口无效或占用正式端口");
    return result;
  };
  const api = port(input.DEV_API_PORT, 3002);
  const web = port(input.DEV_WEB_PORT, 5173);
  if (api === web) throw new Error("开发 API 与 Vite 端口不能相同");
  const output: NodeJS.ProcessEnv = {
    ...input,
    BRAINGYM_ENV: "development",
    NODE_ENV: "development",
    WHEELMAKER_APP_MANAGED: "0",
    HOST: "127.0.0.1",
    PORT: String(api),
    DEV_API_PORT: String(api),
    DEV_WEB_PORT: String(web),
    APP_ORIGIN: `http://127.0.0.1:${preview ? api : web}`,
    APP_BASE_PATH: "/",
    COOKIE_SECURE: "false",
  };
  output.DATABASE_PATH = readEnvironment(output, cwd).databasePath;
  return output;
}
