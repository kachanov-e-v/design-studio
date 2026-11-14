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
## Preview Runtime integration

Install the local runtime package into your app (workspace dependency):

```bash
npm install /path/to/design-studio/packages/preview-runtime
```

Or use a file dependency in your app `package.json`:

```json
"dependencies": {
  "@design-studio/preview-runtime": "file:../design-studio/packages/preview-runtime"
}
```

Then import it once in your app entry:

```ts
import "@design-studio/preview-runtime";
```

Build the runtime bundle first:

```bash
npm --prefix packages/preview-runtime run build
```

### Limitations

- The runtime must run in the same document as the previewed app. It cannot be injected into arbitrary cross-origin sites or sites that forbid framing (X-Frame-Options / CSP frame-ancestors).
- External URLs, CSP restrictions, and same-origin policy are enforced by the browser; Design Studio cannot bypass them.
- If the runtime is not detected, Design Studio shows "Runtime not detected" and interactive features remain disabled.
