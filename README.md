# Design Studio

VS Code extension for visual design/editing of web applications. Preview a running app, inspect and edit styles, persist changes to CSS, and hand off structured context to Kilo Code.

## Features

- Preview panel with URL input and iframe.
- Built-in Demo preview with injected runtime.
- Edit mode: hover highlight, click selection.
- Inspector with element data, computed styles, style inputs.
- Temporary style application in preview.
- Save to source (CSS rule update via WorkspaceEdit).
- Kilo Code integration: context copy to clipboard + chat focus (fallback).
- Undo/Redo via VS Code (WorkspaceEdit).

## Requirements

- VS Code 1.105+
- Node 26+, npm 11+

## Setup

```bash
npm install
npm run build
```

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Launch Extension Development Host: open project in VS Code, press F5.

## Usage

1. Open Command Palette → "Design Studio: Open Design Studio".
2. Enter a Preview URL (dev server) and click Load, or click Demo.
3. Enable "Edit mode" in preview toolbar.
4. Hover to highlight, click to select; inspector shows data/styles.
5. Edit styles in inspector; use "Copy to Kilo" to hand off context; "Save to source" to persist CSS.

## Architecture

See `docs/ARCHITECTURE.md`. Layers: extension, presentation (webview), application, domain, infrastructure, packages.

## Documentation

- `docs/README.md` index
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/TECH_STACK.md`
- `docs/SECURITY.md`
- `docs/INTEGRATIONS.md`
- `docs/project-memory/`

## License

MIT (pending).