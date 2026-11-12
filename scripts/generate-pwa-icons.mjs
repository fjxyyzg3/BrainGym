import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Rasterize the existing vector mark. No external image service or new dependency.
const root = new URL("../", import.meta.url);
const svg = await readFile(new URL("public/favicon.svg", root), "utf8");
const directory = new URL("public/icons/", root);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  const page = await browser.newPage();
  for (const [name, size, maskable] of [
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["maskable-512.png", 512, true],
    ["apple-touch-icon.png", 180, false],
  ]) {
    const png = await page.evaluate(
      async ({ svg, size, maskable }) => {
        const image = new Image();
        image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d");
        if (maskable) {
          context.fillStyle = "#0057d9";
          context.fillRect(0, 0, size, size);
        }
        const inset = maskable ? size / 8 : 0;
        context.drawImage(
          image,
          inset,
          inset,
          size - inset * 2,
          size - inset * 2,
        );
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { svg, size, maskable },
    );
    await writeFile(new URL(name, directory), Buffer.from(png, "base64"));
    console.log(`${name}: ${size}x${size}`);
  }
} finally {
  await browser.close();
}
