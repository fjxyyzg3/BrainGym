import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildApp } from "../../src/server/app.js";
import { Store } from "../../src/server/store.js";

/** Switch real Fastify instances and Vite releases at an HTTP boundary. */
export async function releaseServer(basePath: string) {
  const directory = mkdtempSync(join(tmpdir(), "braingym-releases-"));
  const store = new Store(join(directory, "test.sqlite"));
  const account = store.createUser("PWA version verification");
  let current = 0;
  const state = {
    resourceFault: "none" as "none" | "integrity" | "missing" | "shell",
    failSaves: false,
    blockWorker: false,
    blockedWorkers: 0,
    faultHits: 0,
  };
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (state.blockWorker && req.url === `${basePath}sw.js`) {
        state.blockedWorkers++;
        res.writeHead(503, {
          "content-type": "text/javascript",
          "cache-control": "no-store",
        });
        res.end();
        return;
      }
      if (state.failSaves && req.url === `${basePath}api/results`) {
        res.writeHead(503, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(
          JSON.stringify({
            code: "SERVER_UNAVAILABLE",
            error: "服务暂不可用，请稍后重试",
          }),
        );
        return;
      }
      const reply = await apps[current].inject({
        method: req.method as "GET" | "POST",
        url: req.url!,
        headers: req.headers,
        ...(chunks.length ? { payload: Buffer.concat(chunks) } : {}),
      });
      let body = reply.rawPayload;
      let status = reply.statusCode;
      if (
        state.resourceFault !== "none" &&
        current === 1 &&
        ((state.resourceFault !== "shell" &&
          /\/assets\/[^?]+\.js$/.test(req.url!)) ||
          (state.resourceFault === "shell" &&
            req.url === `${basePath}index.html`))
      ) {
        if (state.resourceFault === "shell") {
          body = Buffer.from(
            reply.body.replace(
              /(name="braingym-release" content=")[^"]+/,
              "$1wrong-release",
            ),
          );
        } else {
          body = Buffer.from(
            "// intentionally damaged transfer for integrity verification",
          );
          if (state.resourceFault === "missing") status = 503;
        }
        state.faultHits++;
      }
      res.writeHead(status, {
        ...reply.headers,
        "content-length": body.byteLength,
      });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture listener");
  const origin = `http://127.0.0.1:${address.port}`;
  for (const staticRoot of [
    resolve("dist/client"),
    resolve("data/pwa-release-b"),
  ]) {
    const app = await buildApp({ store, origin, basePath, staticRoot });
    await app.ready();
    apps.push(app);
  }
  return {
    url: origin + basePath,
    account,
    state,
    upgrade() {
      current = 1;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      await Promise.all(apps.map((app) => app.close()));
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
