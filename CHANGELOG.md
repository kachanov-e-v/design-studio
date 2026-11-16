# Changelog

All notable changes to the Design Studio extension are documented here.

## [0.1.0] — 2026-11-16

First preparatory release candidate; hardening pass following the full
source audit (see `docs/IMPLEMENTATION_PLAN.md`, phases 0–4).

### Fixed
- Static project mode: relative URLs (styles, images, page navigation) resolve
  correctly under the `/project/` jail; author `<base>` is respected (P0-1).
- Single runtime injection with a double-init guard; no duplicated listeners,
  outlines or `history` patches (P0-2).
- Browse-mode link policy works: upstream origin is passed via
  `data-upstream-origin`; external links, `target=_blank/_top/_parent` and
  dangerous schemes (`javascript:`, `data:`, `blob:`) are blocked with a UI
  notification (P0-3). Correction: in dev-server (proxy) mode the P0-3 origin
  check was inverted — every `<base>`-resolved link targeted the preview host
  origin and was blocked. The policy now allows BOTH the preview host origin
  and the upstream origin (NAV-01). Follow-up: on bare-path (sticky) routes
  same-origin link clicks are passed to native navigation again — SPA client
  side routing (Next.js `<Link>`) works without full page reloads; the explicit
  `location.assign` hijack remains only for structured `/proxy/…` documents
  and upstream-origin links (NAV-02).
- "Reveal" (Перейти) and component copy work without React fiber debug
  metadata (`_debugSource` is gone in React 19 dev builds): the source of a
  selected component is resolved by searching the workspace for the component
  declaration by export name before reporting "component file not found"
  (RT-02).
- Edit-mode highlights and selection work on the first page right after the
  panel opens (demo, new project): the webview re-posts `ds:set-mode` until
  the runtime confirms with `ds:mode-changed`, so a set-mode lost during
  instant connect no longer leaves the preview in browse mode (WV-03).
- "Copy instruction" prompt rebuilt as structured Markdown with logical
  sections (task, fenced untrusted page data, element, component, styles,
  source hints, editor edits, user request, numbered procedure). The prompt
  now states up front whether editor edits exist or the task comes only from
  the user request, omits empty sections (including empty computed styles),
  and lists source files for the whole React owner chain, not just the first
  component. Security invariants unchanged: `PAGE DATA — START/END` fencing
  and `dataValue()` newline flattening for every page-derived string.
- "Save styles": persistence requests are serialized with request-id
  correlation; a failed edit no longer discards the pending queue (P0-4).
- Security: origin-checked `postMessage` between webview and runtime (P1-1);
  preview host + cookie jar stop when the last panel closes (P1-2); the
  `/project/` jail denies secrets through in-root symlinks and an extended
  denylist (P1-3); foreign `Origin` requests are rejected and `sec-fetch-site`
  is normalized (P1-4); all page-derived prompt fields are escaped (P1-5).

### Improved
- Protocol/type deduplication, recursive `@media` rule collection, Tailwind
  conflict model (P2), webview UX (throttled sliders, popup follows scroll,
  ErrorBoundary, inspector blur-commit), static file serving (byte ranges,
  MIME table, `fs.promises`), cookie jar path scoping + LRU cap, dev-server
  detection (dual-stack, `vite preview`, `-p4000`/`PORT=`), proxy reliability
  (upstream abort on client disconnect, `::1` fallbacks, WS cookie merge,
  expired-jar purge), toolbar labels and RU/EN i18n parity (P2-1…P2-22).

### Engineering
- CI: Node 20/22 matrix, permissions/concurrency, high-severity audit gate,
  VSIX packaging artifact; ESLint 9 flat config (typescript-eslint 8 +
  react-hooks), esbuild 0.25, dependabot; npm workspaces manifest alignment;
  marketplace manifest fields (`icon`, `galleryBanner`, `bugs`, `homepage`,
  `capabilities`, `extensionKind`, NLS command strings).
