import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pwaBuild } from "./scripts/pwa-build";
import { developmentEnvironment } from "./src/server/environment";

export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [react(), pwaBuild()],
  build: { outDir: "dist/client" },
  ...(command === "serve"
    ? (() => {
        const env = developmentEnvironment();
        return {
          server: {
            host: "127.0.0.1",
            port: Number(env.DEV_WEB_PORT),
            strictPort: true,
            proxy: { "/api": `http://127.0.0.1:${env.DEV_API_PORT}` },
          },
        };
      })()
    : {}),
}));
