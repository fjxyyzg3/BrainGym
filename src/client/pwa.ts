import { basePath } from "./base-path";

export function registerPwa() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker
    .register(`${basePath}sw.js`, {
      scope: basePath,
      updateViaCache: "none",
    })
    .then((registration) => {
      const check = () => {
        void registration.update().catch(() => {});
      };
      window.addEventListener("online", check);
      window.addEventListener("focus", check);
    })
    .catch(() => {
      // Installation/cache failure must never prevent the online app from working.
    });
}
