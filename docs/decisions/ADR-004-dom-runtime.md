# ADR-004: DOM Runtime Strategy

**Status:** Accepted (EPIC 0)
**Date:** 2026-11-14

## Context

Inspector needs element hover/selection/highlight, computed styles, bounding box, DOM path. Must not alter app behavior.

## Decision

- Isolated runtime package `@design-studio/preview-runtime` injected into previewed app.
- Responsibilities: element registration, hover, selection, highlight overlay, DOM path, computed styles, bounding box, event forwarding, temporary style application, command reception.
- Protect Design Studio elements via `data-design-studio` attribute / class filter; exclude them from inspection.
- Support SVG; pseudo-elements best-effort; Shadow DOM only if adapter trivially supports (out of MVP otherwise).
- All messages versioned (`v1`); runtime data treated as untrusted; size limits enforced by bridge.
- Dynamic elements handled via MutationObserver with debounce.

## Consequences

- Runtime must be framework-agnostic (vanilla TS) to work across adapters.
- Highlight overlay is separate layer, not modifying target element styles permanently.

## Alternatives considered

- Framework-specific runtime hooks: deferred to adapters; base runtime stays generic.
