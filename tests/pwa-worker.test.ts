import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { runInNewContext } from "node:vm";

test("worker falls back to real HTTP when cache reads are unavailable", async (t) => {
  const server = createServer((_req, reply) => {
    reply.writeHead(200, { "content-type": "text/javascript" });
    reply.end("export const available = true;");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((done) => server.close(() => done()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let fetchHandler: (event: {
    request: Request;
    respondWith(response: Promise<Response>): void;
  }) => void = () => {
    throw new Error("No fetch listener");
  };
  const source = readFileSync("src/pwa/worker.js", "utf8").replace(
    "const release = null;",
    `const release = ${JSON.stringify({ version: "test", resources: [{ path: "assets/app.js", hash: "unused outside install" }] })};`,
  );
  // Only the failing storage boundary is replaced; the worker handles a real
  // Fetch API request and must return a real response from the loopback server.
  runInNewContext(source, {
    URL,
    fetch,
    self: {
      registration: { scope: `${origin}/` },
      location: { origin },
      addEventListener(name: string, handler: typeof fetchHandler) {
        if (name === "fetch") fetchHandler = handler;
      },
    },
    caches: {
      async open() {
        throw new Error("cache read unavailable");
      },
    },
  });
  let response: Promise<Response> | undefined;
  fetchHandler({
    request: new Request(`${origin}/assets/app.js`),
    respondWith(value) {
      response = value;
    },
  });
  assert.ok(response);
  const result = await response;
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "export const available = true;");
});
