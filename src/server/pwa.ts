export function pwaManifest(basePath: string) {
  return {
    id: basePath,
    name: "BrainGym",
    short_name: "BrainGym",
    lang: "zh-CN",
    description: "空间 N-back 与专注练习",
    start_url: basePath,
    scope: basePath,
    display: "standalone",
    theme_color: "#0057d9",
    background_color: "#f3f5f8",
    icons: [
      {
        src: `${basePath}icons/icon-192.png`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${basePath}icons/icon-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${basePath}icons/maskable-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
