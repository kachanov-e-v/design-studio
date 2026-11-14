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

- `npm run build` — build extension, runtime, webview, and verify artifacts.
- `npm run typecheck` — TypeScript check.
- `npm run lint` — ESLint.
- `npm test` — Vitest unit tests.

## Build pipeline

- Canonical runtime source is `packages/preview-runtime/src`.
- `npm run build` runs extension build, runtime build, one copy step, webview build, and `scripts/verify-build.js`.
- `scripts/copy-runtime.js` fails if `dist/index.js` or `dist/protocol.js` is missing or empty.
- `scripts/verify-build.js` checks `dist/webview/index.html`, `demo.html`, `runtime.js`, and `protocol.js`.

Required production artifacts:

- `dist/extension.js`
- `dist/webview/index.html`
- `dist/webview/demo.html`
- `dist/webview/runtime.js`
- `dist/webview/protocol.js`

## Handshake and diagnostics

- Parent sends `ds:ping` with a session nonce after iframe load and retries with backoff.
- Runtime responds with `ds:pong` using the same nonce.
- Stale iframe messages are ignored by session nonce.
- PreviewContainer distinguishes iframe load, connecting, ready, missing, blocked, and protocol mismatch states.
- Save is enabled only after a confirmed `ds:style-applied` with `success: true`.

## Troubleshooting

- Webview blank: check CSP and that `dist/webview` exists; rebuild.
- Runtime not loaded: ensure demo.html uses `./runtime.js` and file exists in dist.
- Runtime not detected: the iframe loaded, but handshake (`ds:ping`/`ds:pong`) did not complete. Check that the app imports `@design-studio/preview-runtime`, restart the dev server, and inspect iframe console for runtime errors.
- Protocol mismatch: webview and runtime use different `PROTOCOL_VERSION`; rebuild all packages.
- Kilo not available: install Kilo Code extension; adapter checks commands dynamically.
- Save to source: requires an unambiguous CSS rule matching one of the runtime selector candidates; otherwise reports no match or ambiguity.

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

## Runtime protocol

Messages between Webview and Preview Runtime are typed in `packages/preview-runtime/src/protocol.ts` and `src/shared/protocol.ts`. Protocol version is 1. All runtime messages include `version`; handshake messages include `nonce`/`sessionId`; style acknowledgments include `success`, `reason`, `requestId`, and updated payload.