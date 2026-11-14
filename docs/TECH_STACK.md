# Tech Stack

## Extension host

- TypeScript (strict), VS Code API ^1.105.1.
- Bundler: esbuild for extension host.
- Tests: @vscode/test-cli + Mocha for integration; Vitest for unit.

## Webview UI

- React 18, CSS Modules.
- Bundler: Vite.

## Preview runtime

- Vanilla TypeScript, no framework deps.

## Testing

- Vitest + Testing Library for UI.
- Playwright for e2e Preview flows.

## Tooling

- ESLint + Prettier; strict TS.
- Node 26 LTS compatible (current env v26.13.0).
