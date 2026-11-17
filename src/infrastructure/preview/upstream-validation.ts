import * as dns from "node:dns";
import * as net from "node:net";
import { isLoopbackHostname } from "../../shared/url";

export type UpstreamRejection = "scheme" | "credentials" | "non-loopback" | "unparsable";

export interface UpstreamValidation {
  ok: boolean;
  reason?: UpstreamRejection;
}

/**
 * Single gate for every upstream request the preview host performs (HTTP proxy,
 * WebSocket upgrade, sticky dev target). Only loopback targets are allowed —
 * see docs/SECURITY.md. Private, link-local, multicast, cloud-metadata and
 * arbitrary external hosts are rejected before any socket is opened.
 */
export function validateUpstreamTarget(target: string | URL): UpstreamValidation {
  let u: URL;
  try {
    u = target instanceof URL ? target : new URL(target);
  } catch {
    return { ok: false, reason: "unparsable" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (u.username || u.password) return { ok: false, reason: "credentials" };
  if (!isLoopbackHostname(u.hostname)) return { ok: false, reason: "non-loopback" };
  return { ok: true };
}

/**
 * Resolve-then-connect gate: a name like `evil.localhost` passes the lexical
 * loopback check but may resolve to an external IP. Every resolved address
 * must be loopback before a socket is opened. Explicit IP literals skip DNS.
 */
export async function validateUpstreamResolved(target: string | URL): Promise<UpstreamValidation> {
  const basic = validateUpstreamTarget(target);
  if (!basic.ok) return basic;
  const u = target instanceof URL ? target : new URL(target);
  const hostname = u.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIP(hostname) !== 0) return basic;
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((entry) => !isLoopbackHostname(entry.address))) {
      return { ok: false, reason: "non-loopback" };
    }
  } catch {
    return { ok: false, reason: "non-loopback" };
  }
  return basic;
}
