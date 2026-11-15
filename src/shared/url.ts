export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/** Design Studio binds to the project: only localhost dev servers are proxyable. */
export function isLocalhostUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return LOCALHOST_HOSTS.has(u.hostname) || u.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}