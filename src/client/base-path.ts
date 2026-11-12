import { normalizeBasePath } from "../shared/paths";

export const basePath = normalizeBasePath(
  document.querySelector<HTMLMetaElement>('meta[name="braingym-base-path"]')
    ?.content ?? "/",
);
