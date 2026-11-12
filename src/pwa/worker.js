/* The build replaces this declaration with the complete, versioned allowlist. */
const release = null;
const basePath = new URL(self.registration.scope).pathname;
const prefix = `braingym:pwa:${encodeURIComponent(basePath)}:`;
const cacheName = prefix + release.version;
const resourceURLs = new Set(
  release.resources.map(
    ({ path }) => new URL(path, self.registration.scope).href,
  ),
);
const shellURL = new URL("index.html", self.registration.scope).href;

async function verifiedResource(resource) {
  const url = new URL(resource.path, self.registration.scope).href;
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok || response.url !== url)
    throw new Error("PWA resource unavailable");
  const type = response.headers.get("content-type") || "";
  const extension = resource.path.split(".").pop();
  const expectedType = {
    html: "text/html",
    js: "javascript",
    css: "text/css",
    svg: "image/svg+xml",
    png: "image/png",
  }[extension];
  if (!expectedType || !type.includes(expectedType))
    throw new Error("PWA resource type mismatch");
  let bytes = await response.clone().arrayBuffer();
  if (resource.path === "index.html") {
    const html = new TextDecoder().decode(bytes);
    if (
      !html.includes(`<base href="${basePath}"`) ||
      !html.includes(`name="braingym-base-path" content="${basePath}"`) ||
      !html.includes(`name="braingym-release" content="${release.version}"`)
    ) {
      throw new Error("PWA shell version or path mismatch");
    }
    const canonical = html
      .replace(/(<base\s+href=")[^"]*(")/, "$1/$2")
      .replace(
        /(<meta\s+name="braingym-base-path"\s+content=")[^"]*(")/,
        "$1/$2",
      );
    bytes = new TextEncoder().encode(canonical).buffer;
  }
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== resource.hash)
    throw new Error("PWA resource integrity mismatch");
  return [url, response];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Fetch and validate the whole release before writing any of its cache.
      const resources = await Promise.all(
        release.resources.map(verifiedResource),
      );
      try {
        const cache = await caches.open(cacheName);
        await Promise.all(
          resources.map(([url, response]) => cache.put(url, response)),
        );
      } catch (error) {
        await caches.delete(cacheName).catch(() => false);
        throw error;
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys().catch(() => []);
      await Promise.all(
        names
          .filter((name) => name.startsWith(prefix) && name !== cacheName)
          .map((name) => caches.delete(name).catch(() => false)),
      );
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.search ||
    request.headers.has("range")
  )
    return;
  const isShell =
    request.mode === "navigate" &&
    (url.pathname === basePath || url.href === shellURL);
  if (!isShell && !resourceURLs.has(url.href)) return;
  // No runtime writes: unknown paths, APIs and private responses never enter caches.
  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(cacheName);
        const cached = await cache.match(isShell ? shellURL : request.url);
        if (cached) return cached;
      } catch {
        // Storage may become unavailable after installation; keep online access.
      }
      return fetch(request);
    })(),
  );
});
