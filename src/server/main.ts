import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Store } from "./store.js";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT 无效");
const store = new Store(
  resolve(process.env.DATABASE_PATH ?? "data/braingym.sqlite"),
);
const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;
if (new URL(origin).origin !== origin)
  throw new Error("APP_ORIGIN 必须是无尾斜杠的 origin");
const root = resolve("dist/client");
const app = await buildApp({
  store,
  origin,
  secure:
    process.env.COOKIE_SECURE === "true" ||
    (process.env.COOKIE_SECURE !== "false" &&
      process.env.NODE_ENV === "production"),
  staticRoot: existsSync(root) ? root : undefined,
});
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
console.log(`BrainGym: ${origin}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    store.close();
    process.exit(0);
  });
