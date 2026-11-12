export function requirePublicOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.origin === value &&
      !url.username &&
      !url.password
    )
      return value;
  } catch {}
  throw new Error(
    "APP_ORIGIN must be configured as an HTTPS origin without credentials, path, query or fragment",
  );
}
