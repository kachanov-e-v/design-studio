/**
 * NAV-02: decide whether an allowed browse-mode link click is hijacked into
 * `location.assign`.
 *
 * - Documents served under the structured `/proxy/` prefix ALWAYS hijack:
 *   a native SPA navigation (pushState) would drop the /proxy/ prefix and
 *   escape the preview host.
 * - On bare-path documents (sticky dev routes), links to the upstream origin
 *   hijack so they stay on the preview host; same-origin links are passed
 *   through natively — the app router (Next.js <Link>, etc.) keeps working
 *   and the proxy + service worker hold the frame.
 */
export function shouldHijackToAssign(
  locationPathname: string,
  hrefOrigin: string,
  previewOrigin: string | null
): boolean {
  if (locationPathname.startsWith("/proxy/")) return true;
  // Unknown (opaque) document origin: fall back to the explicit hijack.
  if (previewOrigin === null) return true;
  return hrefOrigin !== previewOrigin;
}
