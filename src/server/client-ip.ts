import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";
import { AppError } from "./errors.js";

export function normalizeIp(value: string): string | undefined {
  if (value.includes("%")) return undefined;
  const kind = isIP(value);
  if (!kind) return undefined;
  if (kind === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  if (canonical.startsWith("::ffff:")) {
    const [high, low] = canonical
      .slice(7)
      .split(":")
      .map((part) => parseInt(part, 16));
    return [high! >> 8, high! & 255, low! >> 8, low! & 255].join(".");
  }
  return canonical;
}

export function loginClientIp(
  request: FastifyRequest,
  managed: boolean,
): string {
  if (!managed) return request.ip;
  const fail = (reason: string): never => {
    console.error("Client IP unavailable:", reason);
    throw new AppError(
      503,
      "CLIENT_IP_UNAVAILABLE",
      "服务代理配置异常，暂时无法登录，请稍后重试",
    );
  };
  if (normalizeIp(request.raw.socket.remoteAddress ?? "") !== "127.0.0.1")
    return fail("untrusted peer");
  const occurrences = request.raw.rawHeaders.filter(
    (value, index) =>
      index % 2 === 0 && value.toLowerCase() === "x-forwarded-for",
  ).length;
  const header = request.headers["x-forwarded-for"];
  if (occurrences !== 1 || typeof header !== "string" || header.includes(","))
    return fail("missing or ambiguous forwarded address");
  const address = normalizeIp(header.trim());
  if (!address || address === "::1" || address.startsWith("127."))
    return fail("invalid forwarded address");
  return address;
}
