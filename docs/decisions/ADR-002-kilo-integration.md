# ADR-002: Kilo Code Integration Strategy

**Status:** Accepted (EPIC 0)
**Date:** 2026-11-14

## Context

Kilo Code v7.8.28 exposes no public programmatic API (no `api`/`exports`). Integration is command-driven only. Available commands verified in installed extension `package.json`:

- `kilo-code.new.focusChatInput` — focuses chat input (keybinding ctrl+shift+a).
- `kilo-code.new.addToContext` — adds editor selection to context; `when: editorTextFocus && editorHasSelection`.
- `kilo-code.new.openInTab` — opens chat in tab.
- `kilo-code.new.terminalAddToContext` — terminal content to context.

No command to programmatically set chat text or send a message was found.

## Decision

- Implement `KiloCodeAdapter` implementing `AIIntegrationAdapter`; no imports of Kilo internals.
- Invoke commands via `vscode.commands.executeCommand`.
- Capability detection at runtime (`isAvailable` checks command existence).
- MVP flow: build structured `DesignElementContext` → format prompt → copy to clipboard → `focusChatInput` (and optionally `openInTab`) → show status "Скопировано в буфер, вставьте в чат".
- Automatic send is NOT in MVP; `addToContext` requires active editor selection, so arbitrary element context cannot be injected via it.
- MCP server path is future (EPIC 8+); not MVP due to process management complexity.

## Capability matrix (current Kilo 7.8.28)

| Capability | Available | Notes |
|---|---|---|
| Focus chat input | Yes | command |
| Add editor selection to context | Yes | requires selection |
| Open chat in tab | Yes | command |
| Set input text programmatically | No | unconfirmed |
| Send message programmatically | No | unconfirmed |
| Public API | No | command-driven only |

## Consequences

- Honest fallback is mandatory; UX must state clipboard copy.
- Adapter must re-check availability dynamically (Kilo versions change).
- Tests mock `vscode.commands.executeCommand`.

## Alternatives considered

- MCP server to push context: deferred (adds process mgmt).
- Reverse-engineering minified bundle: rejected.
