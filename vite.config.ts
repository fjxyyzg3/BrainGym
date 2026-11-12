import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pwaBuild } from "./scripts/pwa-build";

export default defineConfig({
  base: "./",
  plugins: [react(), pwaBuild()],
  build: { outDir: "dist/client" },
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
});
