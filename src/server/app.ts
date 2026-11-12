import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import type { Store } from "./store.js";
import { parseResult } from "./store.js";
import { AppError } from "./errors.js";
export async function buildApp(options: {
  store: Store;
  origin: string;
  now?: () => number;
  secure?: boolean;
  staticRoot?: string;
}) {
  const { store } = options,
    now = options.now ?? Date.now;
  const app = Fastify({
    bodyLimit: 8192,
    logger: false,
    forceCloseConnections: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { statusCode?: number; code?: string };
    const status =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 500
        ? err.statusCode
        : 500;
    if (status === 500)
      console.error("Request failed", request.method, request.routeOptions.url); // Never log body, cookies or credentials.
    reply
      .code(status)
      .send({
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
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      req.headers.origin !== options.origin
    )
      throw new AppError(403, "ORIGIN_REJECTED", "请求来源不受信任");
  });
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: options.secure ?? false,
    maxAge: 604800,
  };
  app.get("/api/health", async () => ({ ok: true }));
  app.post(
    "/api/login",
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
  app.post("/api/logout", async (req, reply) => {
    store.logout(req.cookies.bg_session);
    reply.clearCookie("bg_session", {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: options.secure ?? false,
    });
    return { ok: true };
  });
  app.get("/api/me", async (req) => ({
    user: store.userForSession(req.cookies.bg_session, now()),
  }));
  app.post("/api/results", async (req) => {
    const user = store.userForSession(req.cookies.bg_session, now());
    const data = parseResult(req.body);
    return store.save(user, data, now());
  });
  app.get("/api/history", async (req) => {
    const user = store.userForSession(req.cookies.bg_session, now());
    const raw = (req.query as { page?: string }).page ?? "1";
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 1000000)
      throw new AppError(400, "INVALID_PAGE", "页码无效");
    return { ...store.history(user.id, Number(raw)), user };
  });
  app.get("/api/bests", async (req) => {
    const user = store.userForSession(req.cookies.bg_session, now());
    return { items: store.bests(user.id), user };
  });
  if (options.staticRoot) {
    await app.register(staticFiles, { root: options.staticRoot });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.method === "GET" &&
        !req.url.startsWith("/api/") &&
        req.headers.accept?.includes("text/html")
      )
        return reply.sendFile("index.html");
      return reply.code(404).send({ error: "页面不存在" });
    });
  }
  return app;
}
