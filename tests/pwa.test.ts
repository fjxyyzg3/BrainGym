import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server/app.js";
import { Store } from "../src/server/store.js";

for (const basePath of ["/", "/braingym/"]) {
  test(`PWA HTTP resources respect runtime base ${basePath}`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "braingym-pwa-"));
    const store = new Store(join(root, "test.sqlite"));
    writeFileSync(
      join(root, "index.html"),
      '<base href="/"><meta name="braingym-base-path" content="/">',
    );
    writeFileSync(
      join(root, "sw.js"),
      'self.addEventListener("fetch", () => {});',
    );
    const app = await buildApp({
      store,
      origin: "https://apps.example.com",
      basePath,
      staticRoot: root,
    });
    t.after(async () => {
      await app.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    });
    const response = await app.inject(`${basePath}manifest.webmanifest`);
    assert.match(
      String(response.headers["content-type"]),
      /application\/manifest\+json/,
    );
    assert.equal(response.statusCode, 200);
    const manifest = response.json();
    assert.equal(manifest.id, basePath);
    assert.equal(manifest.start_url, basePath);
    assert.equal(manifest.scope, basePath);
    assert.equal(manifest.name, "BrainGym");
    assert.equal(manifest.display, "standalone");
    assert.ok(
      manifest.icons.every((icon: { src: string }) =>
        icon.src.startsWith(`${basePath}icons/`),
      ),
    );
    const worker = await app.inject(`${basePath}sw.js`);
    assert.equal(worker.statusCode, 200);
    assert.match(String(worker.headers["content-type"]), /javascript/);
    assert.match(String(worker.headers["cache-control"]), /no-cache/);
    assert.match(
      String(worker.headers["content-security-policy"]),
      /script-src 'self'/,
    );
    const api = await app.inject(`${basePath}api/me`);
    assert.equal(api.statusCode, 401);
    assert.equal(api.headers["cache-control"], "no-store");
    assert.match(
      (await app.inject(basePath)).body,
      new RegExp(`<base href="${basePath}">`),
    );
  });
}

test("missing worker never becomes SPA HTML", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "braingym-no-worker-"));
  const store = new Store(join(root, "test.sqlite"));
  writeFileSync(join(root, "index.html"), "<html>shell</html>");
  const app = await buildApp({
    store,
    origin: "https://apps.example.com",
    staticRoot: root,
  });
  t.after(async () => {
    await app.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const response = await app.inject({
    url: "/sw.js",
    headers: { accept: "text/html" },
  });
  assert.equal(response.statusCode, 404);
  assert.doesNotMatch(String(response.headers["content-type"]), /text\/html/);
});
