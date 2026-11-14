# ADR-001: VS Code Extension API Usage

**Status:** Accepted (EPIC 0)
**Date:** 2026-11-14

## Context

Design Studio is a VS Code extension. It needs a webview UI, communication with preview runtime, file edits, and command integration. No Kilo internals are imported.

## Decision

- Use VS Code Webview API with `postMessage` for extension↔UI communication.
- Use CSP with nonce-based script/style allow-lists; disable inline eval.
- Use `WorkspaceEdit` for minimal source edits; `FileSystemWatcher` for external change detection.
- Register commands under `design-studio.*` namespace; activation events: `onCommand:design-studio.open`, `onView:designStudio.panel`, `workspaceContains` (package.json with known dev scripts).
- View containers: Activity Bar container "Design Studio" with primary webview view; secondary panel for inspector optional.
- All extension↔webview messages are validated (schema + size limit) and treated as untrusted.
- Webview runs with `enableScripts: true`, `retainContextWhenHidden: true` only where needed; local resource roots restricted to extension dist + workspace.

## Consequences

- Cross-origin preview iframe inside webview requires runtime injection and origin checks.
- File edits go through VS Code APIs, ensuring Undo/Redo integration.
- No direct DOM access to user app; preview runtime is separate package.

## Alternatives considered

- Direct DOM injection into user editor: rejected (isolation, security).
- Electron-style node integration in webview: rejected (security).
