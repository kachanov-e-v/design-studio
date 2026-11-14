# ADR-003: Preview Strategy

**Status:** Accepted (EPIC 0)
**Date:** 2026-11-14

## Context

VS Code Webview is isolated from page DOM. Previewing a user's dev server inside the extension requires iframe + runtime injection. Cross-origin/X-Frame-Options/CSP constraints.

## Decision

- Primary: local dev server of the project + iframe inside Design Studio Webview.
- Runtime injected into app via (a) npm package `@design-studio/preview-runtime` wired into project, or (b) dev server middleware injecting script via query param.
- Message Bridge via `postMessage` with origin verification and versioned messages.
- Fallback: open Preview in external browser and connect runtime via bridge (WebSocket) if iframe impossible.
- Detect project capabilities (`detectProject`) before offering interactive inspector; if unsupported, state limitation explicitly.

## Constraints

- CSP of webview must allow iframe src (localhost dev server).
- X-Frame-Options / COOP/COEP of dev server may block embedding; document and surface to user.
- Cross-origin postMessage requires strict origin checks.

## Consequences

- Preview Provider manages dev server lifecycle only with user confirmation (no auto-start of unknown scripts).
- Two preview modes: embedded iframe (default) and external browser fallback.

## Alternatives considered

- VS Code Simple Browser: limited scripting; rejected for MVP inspector.
- Pure external browser: loses in-extension UX; kept as fallback only.
