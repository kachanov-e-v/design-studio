import * as crypto from "node:crypto";

/**
 * IMP-B: preserve the upstream Content-Security-Policy instead of stripping it.
 * The injected runtime is an external same-origin script (/__ds-runtime.js)
 * plus one inline service-worker registration snippet; the policy is adapted
 * to allow exactly those, keeping the app's own restrictions intact.
 */

/** Directives whose value is a source list (may carry 'self'/nonce sources). */
const SOURCE_DIRECTIVES = new Set([
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "connect-src",
  "font-src",
  "media-src",
  "object-src",
  "frame-src",
  "child-src",
  "worker-src",
  "manifest-src",
  "prefetch-src",
  "base-uri",
  "form-action",
]);

const SCRIPT_DIRECTIVES = new Set(["script-src", "script-src-elem"]);

export function generateNonce(): string {
  return crypto.randomBytes(18).toString("base64url");
}

/**
 * A `sandbox` directive cannot be adapted without changing the page's security
 * posture (allow-scripts would be required) — such policies fall back to the
 * legacy strip-with-warning path.
 */
export function cspRequiresFallback(policy: string): boolean {
  return /(?:^|;)\s*sandbox(?:\s|;|$)/i.test(policy);
}

/**
 * Adding a nonce to a policy that relies on 'unsafe-inline' (no nonce/hash of
 * its own) would silently disable 'unsafe-inline' and break the app's inline
 * scripts (Next.js hydration). In that case the external runtime is allowed
 * via 'self' and the inline SW snippet via the existing 'unsafe-inline'.
 */
function shouldAddNonce(values: string[]): boolean {
  const lower = values.map((v) => v.toLowerCase());
  const hasNonceOrHash = lower.some((v) => v.startsWith("'nonce-") || /^'sha(256|384|512)-/.test(v));
  const hasStrictDynamic = lower.includes("'strict-dynamic'");
  const hasUnsafeInline = lower.includes("'unsafe-inline'");
  return !hasUnsafeInline || hasNonceOrHash || hasStrictDynamic;
}

function withPreviewSources(values: string[], nonce: string, isScript: boolean): string[] {
  let next = [...values];
  if (next.length === 1 && next[0].toLowerCase() === "'none'") next = [];
  if (!next.some((v) => v.toLowerCase() === "'self'")) next.push("'self'");
  if (isScript && shouldAddNonce(values)) next.push(`'nonce-${nonce}'`);
  return next;
}

/**
 * Adapt one CSP header value for the preview host:
 * - add 'self' to every source list (all app requests are proxied through the
 *   preview origin, and the injected <base> points at it);
 * - add the session nonce to script-src/script-src-elem (materializing
 *   script-src from default-src when absent) unless that would disable the
 *   app's 'unsafe-inline';
 * - drop frame-ancestors (the preview is intentionally framed by the VS Code
 *   webview; x-frame-options is already stripped) and upgrade-insecure-requests
 *   (would upgrade loopback http subresources to https and break the proxy).
 * Policies with `sandbox` are returned unchanged — callers must check
 * cspRequiresFallback first and strip with a warning instead.
 */
export function adaptCsp(policy: string, nonce: string): string {
  const trimmed = policy.trim();
  if (!trimmed) return "";
  const parsed = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((directive) => {
      const tokens = directive.split(/\s+/);
      return { name: tokens[0].toLowerCase(), values: tokens.slice(1) };
    });
  if (parsed.some((d) => d.name === "sandbox")) return policy;

  const out: string[] = [];
  let hasScriptDirective = false;
  let defaultValues: string[] | null = null;
  for (const d of parsed) {
    if (d.name === "frame-ancestors" || d.name === "upgrade-insecure-requests") continue;
    if (d.name === "default-src") defaultValues = d.values;
    if (SCRIPT_DIRECTIVES.has(d.name)) hasScriptDirective = true;
    if (!SOURCE_DIRECTIVES.has(d.name)) {
      out.push([d.name, ...d.values].join(" "));
      continue;
    }
    out.push(`${d.name} ${withPreviewSources(d.values, nonce, SCRIPT_DIRECTIVES.has(d.name)).join(" ")}`);
  }
  if (!hasScriptDirective && defaultValues) {
    out.push(`script-src ${withPreviewSources(defaultValues, nonce, true).join(" ")}`);
  }
  return out.join("; ");
}

export const META_CSP_RE =
  /<meta(?=[\s>])[^>]*http-equiv\s*=\s*["']?content-security-policy(?:-report-only)?["']?[^>]*>/gi;

const CONTENT_ATTR_RE = /content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

function decodeAttrEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    const num = lower[1] === "x" ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(num) && num > 0 && num <= 0x10ffff ? String.fromCodePoint(num) : match;
  });
}

function escapeAttrValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function metaContentPolicy(tag: string): string | null {
  const match = CONTENT_ATTR_RE.exec(tag);
  if (!match) return null;
  return decodeAttrEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

/** True when any meta-delivered CSP on the page requires the strip fallback. */
export function htmlMetaCspRequiresFallback(html: string): boolean {
  for (const match of html.matchAll(META_CSP_RE)) {
    const policy = metaContentPolicy(match[0]);
    if (policy !== null && cspRequiresFallback(policy)) return true;
  }
  return false;
}

/**
 * Rewrite meta-delivered CSP in place (adaptation rules identical to headers).
 * Meta policies with `sandbox` are removed and reported via `fallback` — the
 * caller surfaces the strip warning. Without a nonce the legacy behavior
 * (remove every meta CSP) is kept.
 */
export function rewriteMetaCsp(html: string, nonce?: string): { html: string; fallback: boolean } {
  let fallback = false;
  const out = html.replace(META_CSP_RE, (tag) => {
    const policy = metaContentPolicy(tag);
    if (policy === null) return tag;
    if (!nonce) return "";
    if (cspRequiresFallback(policy)) {
      fallback = true;
      return "";
    }
    const adapted = adaptCsp(policy, nonce);
    return tag.replace(CONTENT_ATTR_RE, `content="${escapeAttrValue(adapted)}"`);
  });
  return { html: out, fallback };
}