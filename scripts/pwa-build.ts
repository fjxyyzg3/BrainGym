import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Only emitted JS/CSS and these public assets belong to the offline shell. */
export const pwaAssets = [
  "favicon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
];

export function pwaBuild(): Plugin {
  let outputDirectory: string;
  let projectRoot: string;
  return {
    name: "braingym-pwa",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      projectRoot = config.root;
      outputDirectory = resolve(config.root, config.build.outDir);
    },
    async writeBundle(_options, bundle) {
      const names = [
        ...Object.keys(bundle).filter((name) =>
          /^assets\/[^?]+\.(js|css)$/.test(name),
        ),
        ...pwaAssets,
      ].sort();
      const template = await readFile(
        resolve(outputDirectory, "index.html"),
        "utf8",
      );
      const worker = await readFile(
        resolve(projectRoot, "src/pwa/worker.js"),
        "utf8",
      );
      const resources = await Promise.all(
        names.map(async (path) => ({
          path,
          hash: digest(await readFile(resolve(outputDirectory, path))),
        })),
      );
      const version = digest(template + JSON.stringify(resources) + worker);
      const html = template.replace(
        "</head>",
        `<meta name="braingym-release" content="${version}" /></head>`,
      );
      const release = {
        version,
        resources: [{ path: "index.html", hash: digest(html) }, ...resources],
      };
      await writeFile(resolve(outputDirectory, "index.html"), html);
      await writeFile(
        resolve(outputDirectory, "sw.js"),
        worker.replace(
          "const release = null;",
          `const release = ${JSON.stringify(release)};`,
        ),
      );
    },
  };
}
