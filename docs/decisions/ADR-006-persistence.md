# ADR-006: Persistence Strategy

**Status:** Accepted (EPIC 0)
**Date:** 2026-11-14

## Context

Saving visual edits to source must not corrupt files or overwrite user changes.

## Decision

- Never rewrite whole file unless unavoidable.
- Prefer minimal text edits, AST transforms, specific CSS declaration/class changes via VS Code `WorkspaceEdit`.
- Before write: verify file freshness, detect conflicts, validate edit safety, allow rollback.
- Group changes for Undo/Redo; detect external file changes via `FileSystemWatcher`.
- If source unknown or edit unsafe: offer alternative via Kilo Code (context handoff), do not silently fail.
- HMR integration: after save, preview refreshes via dev server HMR.

## Consequences

- StylePersistenceAdapter implements `canEdit` and `apply`.
- Conflict → prompt user; no silent overwrite.
- All edits are within workspace; path traversal blocked.

## Alternatives considered

- Full-file regeneration: rejected (destroys formatting/comments).
- Direct fs write bypassing VS Code: rejected (breaks Undo).
