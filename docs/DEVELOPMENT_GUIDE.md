# Development Guide

## Prerequisites

- Node 26+, npm 11+, VS Code 1.105+.

## Setup

```bash
npm install
npm run build
```

## Run

- Open project in VS Code.
- Press F5 to launch Extension Development Host.
- In EDH: Command Palette → "Design Studio: Open Design Studio".

## Scripts

- `npm run build` — build extension, runtime, webview.
- `npm run typecheck` — TypeScript check.
- `npm run lint` — ESLint.
- `npm test` — Vitest unit tests.

## Troubleshooting

- Webview blank: check CSP and that `dist/webview` exists; rebuild.
- Runtime not loaded: ensure demo.html uses `./runtime.js` and file exists in dist.
- Kilo not available: install Kilo Code extension; adapter checks commands dynamically.
- Save to source: requires a CSS file containing the selected selector; otherwise reports no match.

## Conventions

- TypeScript strict; no `any` in domain.
- Adapter boundary: Kilo adapter uses only `vscode.commands`.
- Domain has no infra deps.