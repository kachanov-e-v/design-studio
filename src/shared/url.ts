/**
 * Hostnames and IPs Design Studio may talk to: the local machine only.
 * Hostnames that merely resolve to loopback (`localtest.me`) stay outside this
 * list so public-name DNS records cannot be swapped to probe the network.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // http/https URLs normalize IPv4 forms (decimal/octal/hex) to dotted quad.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return false;
    if (octets[0] === 127) return true;
    return octets[0] === 0 && octets[1] === 0 && octets[2] === 0 && octets[3] === 0;
  }
  if (host === "::1") return true;
  // IPv4-mapped IPv6 loopback: ::ffff:127.x.x.x
  const mapped = /^::ffff:\d{1,3}(\.\d{1,3}){3}$/.exec(host);
  if (mapped) return isLoopbackHostname(host.slice("::ffff:".length));
  return false;
}

/**
 * Design Studio binds to the project: only localhost dev servers are usable.
 * Userinfo credentials (`http://user@host/`) are rejected — the proxy strips nothing
 * there and the host part alone decides the policy.
 */
export function isLocalhostUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    return isLoopbackHostname(u.hostname);
  } catch {
    return false;
  }
}
