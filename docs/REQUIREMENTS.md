# Requirements

## Functional (MVP)

- Open Design Studio panel.
- Detect project and preview capabilities.
- Start/stop/refresh preview (dev server by user confirmation).
- Edit Mode: hover highlight, click select.
- Inspector sections: Element, Layout, Spacing, Typography, Appearance, Border, Effects, Position, Advanced, Source.
- Floating panel with quick actions.
- Style editing for supported properties with source persistence.
- Undo/Redo.
- Kilo context handoff with clipboard fallback + status.

## Non-functional

- Security: CSP, message validation, path traversal protection, no secrets in logs.
- Performance: debounced collection, lazy data, bounded message size.
- Accessibility: keyboard navigation in UI where feasible.
- Reliability: conflict detection before write, rollback.
