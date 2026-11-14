# ADR-005: Source Mapping Strategy

**Status:** Accepted (EPIC 0)
**Date:** 2026-11-14

## Context

Mapping a selected DOM element back to source location is required for persistence. Accuracy varies by framework/styling approach.

## Decision

- Every mapping result carries `confidence` (high/medium/low/unknown). Never present guess as confirmed path.
- If source not resolved, show explicitly "not determined" and offer Kilo alternative.
- MVP adapters: React (JSX + CSS Modules/Tailwind) and plain HTML/CSS.
- Technologies: Source Maps, AST (Babel/TS Compiler API), PostCSS, framework instrumentation, runtime ids.
- Partial support for Tailwind/CSS Modules via class-level edits if time permits.

## Adapter matrix

| Stack | Approach | Confidence |
|---|---|---|
| React JSX | Babel/TS Compiler API AST + source maps | high |
| Plain HTML/CSS | direct file/selector | high |
| CSS Modules | PostCSS + class mapping | medium |
| Tailwind classes | class-level edit | medium |
| Vue/Svelte/SCSS | deferred | n/a |

## Consequences

- Persistence adapter checks `canEdit` before applying changes.
- Unknown mappings block direct save and route to Kilo context.

## Alternatives considered

- Runtime-only ids without source maps: insufficient for persistence; rejected.
