export function normalizeBasePath(value = "/"): string {
  const path = value.endsWith("/") ? value : `${value}/`;
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(path))
    throw new Error("APP_BASE_PATH 必须是无查询和路径跳转的绝对路径");
  return path;
}
