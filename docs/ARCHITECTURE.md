# Architecture

## Layers

```
extension/        activate, commands, providers, webview registration
presentation/     webview React UI (toolbar, preview container, inspector, overlays, floating panel)
application/      use-cases + services + ports (interfaces)
domain/           entities, value-objects, domain services, events, errors (no infra deps)
infrastructure/   vscode, preview, runtime, source-mapping, persistence, framework-adapters, ai-integrations/kilo-code, messaging, storage
packages/         shared-contracts, preview-runtime
```

Rules: UI contains no persistence/AI business logic; core independent of UI; Kilo integration isolated in adapter; domain has no VS Code/React/Node/Kilo deps.

## Key interfaces

```ts
interface PreviewAdapter { detectProject(): Promise<PreviewCapabilities>; start(): Promise<PreviewSession>; stop(): Promise<void>; refresh(): Promise<void>; getStatus(): PreviewStatus; }
interface FrameworkAdapter { id: string; detect(): Promise<boolean>; initialize(): Promise<void>; dispose(): Promise<void>; }
interface SourceMappingAdapter { id: string; resolveElement(element: ElementReference): Promise<SourceMappingResult>; }
interface AIIntegrationAdapter { id: string; isAvailable(): Promise<boolean>; sendContext(ctx: DesignElementContext, instruction: string): Promise<SendContextResult>; }
interface StylePersistenceAdapter { id: string; canEdit(source: SourceMappingResult): Promise<boolean>; apply(change: StyleChange): Promise<PersistenceResult>; }
```

Universal Plugin Manager is NOT created until at least two real extension scenarios exist.

## Data flow

Preview runtime → bridge → extension → webview UI → inspector → persistence/AI adapter.

## Runtime handshake

- PreviewContainer owns iframe lifecycle and a per-URL session nonce.
- Parent sends `ds:ping`; runtime responds with `ds:pong`.
- Retries use bounded backoff; timeout transitions to `missing`.
- Stale iframe messages are ignored by `event.source` and session nonce.

## Build and packaging

- Runtime source is canonical in `packages/preview-runtime/src`.
- Build produces `dist/webview/runtime.js` and `dist/webview/protocol.js`.
- `scripts/verify-build.js` validates required artifacts after Vite build.
