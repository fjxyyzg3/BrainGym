import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "./store.js";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { ManagedControl, type Health } from "./managed.js";
import { ForwardingPublisher } from "./forwarding.js";

let store: Store | undefined;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let control: ManagedControl | undefined;
let startup: Promise<void> | undefined;
let stopping: Promise<void> | undefined;
let closePublisher: (() => void) | undefined;

async function stop(code: number): Promise<void> {
  if (stopping) return stopping;
  control?.dispose();
  stopping = (async () => {
    const deadline = setTimeout(() => {
      console.error("Shutdown timed out; closing remaining connections.");
      app?.server.closeAllConnections();
      store?.close();
      process.exit(1);
    }, 10000);
    deadline.unref();
    try {
      await startup?.catch(() => undefined);
      closePublisher?.();
      await app?.close();
      store?.close();
    } catch (error) {
      console.error(
        "Shutdown failed:",
        error instanceof Error ? error.message : "resource cleanup failed",
      );
      code = 1;
    } finally {
      clearTimeout(deadline);
    }
    process.exit(code);
  })();
  return stopping;
}
function health(): Health {
  if (!app?.server.listening)
    return {
      state: "unhealthy",
      components: [
        {
          id: "http",
          state: "unhealthy",
          message: "HTTP listener is unavailable; inspect the service port.",
        },
      ],
    };
  try {
    store!.assertAvailable();
    return { state: "healthy" };
  } catch {
    return {
      state: "unhealthy",
      components: [
        {
          id: "storage",
          state: "unhealthy",
          message:
            "SQLite unavailable; check database locks, permissions and storage.",
        },
      ],
    };
  }
}
try {
  const config = readConfig();
  const start = () =>
    (startup ??= (async () => {
      if (
        config.managed &&
        !existsSync(resolve(config.staticRoot, "index.html"))
      )
        throw new Error(
          "Missing frontend build; run npm run build before starting the managed app.",
        );
      store = new Store(config.databasePath, {
        busyTimeoutMs: config.managed ? 250 : 5000,
      });
      app = await buildApp({
        store,
        origin: config.origin,
        secure: config.secure,
        basePath: config.basePath,
        managed: config.managed,
        staticRoot: existsSync(config.staticRoot)
          ? config.staticRoot
          : undefined,
      });
      await app.listen({ host: config.host, port: config.port });
      if (config.managed) {
        const publisher = new ForwardingPublisher({
          stateDir: config.stateDir,
          id: config.serviceId,
          target: config.target,
          publicUrl: config.publicUrl,
        });
        closePublisher = () => publisher.close();
      }
      console.error(`BrainGym listening on ${config.target}${config.basePath}`);
    })());
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void stop(0);
    });
  if (config.managed) {
    const version = String(
      JSON.parse(readFileSync(resolve("package.json"), "utf8")).version,
    );
    control = new ManagedControl({ version, initialize: start, health, stop });
    control.start();
  } else {
    await start();
  }
} catch (error) {
  console.error(
    "BrainGym startup failed:",
    error instanceof Error ? error.message : "unknown startup error",
  );
  await stop(1);
}
