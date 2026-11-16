/**
 * RT-01: `location.ancestorOrigins[0]` is the IMMEDIATE parent; the LAST item
 * is the topmost browsing context. The runtime announcement is posted to
 * `window.parent` (the immediate parent), so it must target that frame's
 * origin — in a nested VS Code webview the topmost origin is NOT an origin
 * the immediate parent is allowed to receive a message with, and the
 * announcement would be silently dropped.
 */
export function pickAnnouncementOrigin(
  origins: DOMStringList | ArrayLike<string | null> | null | undefined
): string | null {
  if (!origins || origins.length === 0) return null;
  const first = origins[0];
  return first ? String(first) : null;
}
