import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { pwaBuild } from "./pwa-build";

/** A second real Vite release, built before any runtime tests start. */
export async function preparePwaVerification() {
  const source = resolve("data/pwa-release-source");
  await mkdir(source, { recursive: true });
  for (const name of ["src", "public"]) {
    await cp(resolve(name), resolve(source, name), { recursive: true });
  }
  const html = (await readFile("index.html", "utf8")).replace(
    /<title>[^<]+<\/title>/,
    "<title>BrainGym · 更新验收版本</title>",
  );
  await writeFile(resolve(source, "index.html"), html);
  await build({
    root: source,
    configFile: false,
    base: "./",
    plugins: [react(), pwaBuild()],
    logLevel: "warn",
    build: { outDir: resolve("data/pwa-release-b"), emptyOutDir: true },
  });
}
