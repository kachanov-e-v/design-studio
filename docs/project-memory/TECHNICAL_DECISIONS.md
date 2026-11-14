# Technical Decisions

- ADR-001 VS Code Extension API usage.
- ADR-002 Kilo integration (commands + clipboard fallback).
- ADR-003 Preview: dev server + iframe + runtime injection, external browser fallback.
- ADR-004 DOM runtime isolated, versioned messages, untrusted data.
- ADR-005 Source mapping with confidence; MVP React + HTML/CSS.
- ADR-006 Persistence minimal edits, WorkspaceEdit, conflict checks, rollback.
- Stack: esbuild (host), Vite (webview), React, CSS Modules, Vitest, Playwright.
- Runtime protocol v1: typed messages, source validation, ready handshake, kebab-case CSS properties.
- Runtime handshake uses parent-generated nonce and retry/backoff instead of one-shot ready.
- Build pipeline has a single runtime copy step plus artifact verification.
- Save is enabled only after confirmed `ds:style-applied` success.
- Persistence uses selector candidates and lightweight CSS block parsing rather than exact tag-qualified selector equality.
