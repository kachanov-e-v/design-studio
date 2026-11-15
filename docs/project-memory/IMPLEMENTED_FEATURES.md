# Implemented Features

- EPIC 1 scaffold.
- EPIC 2 UI.
- EPIC 3 Preview Engine.
- EPIC 4 DOM Runtime (session handshake, mode confirmation, hover/select, style apply, selector candidates).
- EPIC 5 Inspector (kebab-case computed styles).
- EPIC 6 Style Editing (temporary + safe CSS persistence with ambiguity checks).
- EPIC 7 Kilo Integration (adapter + fallback).
- Cross-platform runtime copy/build with extension and webview artifact verification.
- Protocol validation, session binding, protocol mismatch handling, runtime-missing UX, and status separation.
- Dev-server autodetection (package.json scripts + HTTP fingerprint verification) with suggestions in the project dropdown.
- CSS persistence via dev sourcemaps (`File_local__hash` heuristic fallback) for CSS Modules on `next dev`/Vite.
- Tailwind inline edits: page-level Tailwind detection, `classes`/`tailwind` element payload fields, pure CSS→utility translator (`src/shared/tailwind.ts`), `set-classes` runtime op, journaling of pending kind `style` class changes for the AI agent.