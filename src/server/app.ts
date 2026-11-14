import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.js";
import { parseResult } from "./store.js";
import { AppError } from "./errors.js";
import { normalizeBasePath } from "../shared/paths.js";
import { loginClientIp } from "./client-ip.js";
import { pwaManifest } from "./pwa.js";
import { GAME, isGameId } from "../shared/contracts.js";

function queryGame(query: unknown) {
  const value = (query as { game?: unknown }).game;
  if (value === undefined) return GAME;
  if (!isGameId(value)) throw new AppError(400, "INVALID_GAME", "游戏模式无效");
  return value;
}
export async function buildApp(options: {
  store: Store;
  origin: string;
  now?: () => number;
  secure?: boolean;
  staticRoot?: string;
  basePath?: string;
  managed?: boolean;
}) {
  const { store } = options,
    now = options.now ?? Date.now;
  const basePath = normalizeBasePath(options.basePath);
  const apiPath = `${basePath}api/`;
  const isApi = (url: string) => {
    const path = url.split("?")[0];
    return path === apiPath.slice(0, -1) || path.startsWith(apiPath);
  };
  const app = Fastify({
    bodyLimit: 8192,
    logger: false,
    forceCloseConnections: "idle",
  });
  await app.register(cookie);
  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { statusCode?: number; code?: string };
    const status =
      error instanceof AppError && err.statusCode === 503
        ? 503
        : err.statusCode && err.statusCode >= 400 && err.statusCode < 500
          ? err.statusCode
          : 500;
    if (status === 500)
      console.error("Request failed", request.method, request.routeOptions.url); // Never log body, cookies or credentials.
    reply.code(status).send({
      code: status === 500 ? "SERVER_ERROR" : (err.code ?? "BAD_REQUEST"),
      error: status === 500 ? "服务暂不可用，请稍后重试" : err.message,
    });
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (isApi(req.url)) reply.header("Cache-Control", "no-store");
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      req.headers.origin !== options.origin
    )
      throw new AppError(403, "ORIGIN_REJECTED", "请求来源不受信任");
  });
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => loginClientIp(request, options.managed ?? false),
  });
  const cookieOptions = {
    path: basePath,
    httpOnly: true,
    sameSite: "strict" as const,
    secure: options.secure ?? false,
    maxAge: 604800,
  };
  app.get(`${apiPath}health`, async (_request, reply) => {
    try {
      store.assertAvailable();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  app.post(
    `${apiPath}login`,
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const token = (req.body as { token?: unknown } | null)?.token;
      if (typeof token !== "string" || token.length < 1 || token.length > 256)
        throw new AppError(400, "INVALID_TOKEN", "请输入有效 Token");
      const session = store.login(token, now());
      reply.setCookie("bg_session", session.session, cookieOptions);
      return { user: session.user };
    },
  );
  app.post(`${apiPath}logout`, async (req, reply) => {
    store.logout(req.cookies.bg_session);
    reply.clearCookie("bg_session", {
      path: basePath,
      httpOnly: true,
      sameSite: "strict",
      secure: options.secure ?? false,
    });
    return { ok: true };
  });
  app.get(`${apiPath}me`, async (req) => ({
    user: store.userForSession(req.cookies.bg_session, now()),
  }));
  app.post(`${apiPath}results`, async (req) => {
    const user = store.userForSession(req.cookies.bg_session, now());
    const data = parseResult(req.body);
    return store.save(user, data, now());
  });
  app.get(`${apiPath}corsi/progress`, async (req) => {
    const user = store.userForSession(req.cookies.bg_session, now());
    return store.corsiProgress(user, now());
  });
  app.post(`${apiPath}corsi/progress/reset`, async (req) => {
    const user = store.userForSession(req.cookies.bg_session, now());
    return store.resetCorsiProgress(user, req.body, now());
  });
  app.get(`${apiPath}history`, async (req) => {
    const user = store.userForSession(req.cookies.bg_session, now());
    const raw = (req.query as { page?: string }).page ?? "1";
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 1000000)
      throw new AppError(400, "INVALID_PAGE", "页码无效");
    return {
      ...store.history(user.id, Number(raw), queryGame(req.query)),
      user,
    };
  });
  app.get(`${apiPath}bests`, async (req) => {
    const user = store.userForSession(req.cookies.bg_session, now());
    return { items: store.bests(user.id, queryGame(req.query)), user };
  });
  if (options.staticRoot) {
    const workerPath = join(options.staticRoot, "sw.js");
    const worker = existsSync(workerPath)
      ? readFileSync(workerPath, "utf8")
      : null;
    app.get(`${basePath}manifest.webmanifest`, async (_req, reply) =>
      reply
        .type("application/manifest+json")
        .header("Cache-Control", "no-cache")
        .send(pwaManifest(basePath)),
    );
    app.get(`${basePath}sw.js`, async (_req, reply) => {
      reply.header("Cache-Control", "no-cache");
      if (worker === null) return reply.code(404).send({ error: "资源不存在" });
      return reply.type("text/javascript").send(worker);
    });
    const html = readFileSync(join(options.staticRoot, "index.html"), "utf8")
      .replace(/(<base\s+href=")[^"]*(")/, `$1${basePath}$2`)
      .replace(
        /(<meta\s+name="braingym-base-path"\s+content=")[^"]*(")/,
        `$1${basePath}$2`,
      );
    app.get(basePath, async (_req, reply) =>
      reply.type("text/html").header("Cache-Control", "no-store").send(html),
    );
    app.get(`${basePath}index.html`, async (_req, reply) =>
      reply.type("text/html").header("Cache-Control", "no-store").send(html),
    );
    if (basePath !== "/")
      app.get(basePath.slice(0, -1), async (req, reply) =>
        reply
          .code(308)
          .header(
            "Location",
            `${basePath}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`,
          )
          .send(),
      );
    await app.register(staticFiles, {
      root: options.staticRoot,
      prefix: basePath,
      index: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.method === "GET" &&
        req.url.startsWith(basePath) &&
        !isApi(req.url) &&
        req.headers.accept?.includes("text/html")
      )
        return reply
          .type("text/html")
          .header("Cache-Control", "no-store")
          .send(html);
      return reply.code(404).send({ error: "页面不存在" });
    });
  }
  return app;
}
