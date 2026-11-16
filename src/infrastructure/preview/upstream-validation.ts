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
