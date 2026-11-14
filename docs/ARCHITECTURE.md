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

## Package layout (planned)

- `packages/shared-contracts` — versioned message types, DTOs.
- `packages/preview-runtime` — injected runtime (vanilla TS).
- `src/extension` — host code.
- `src/webview` — React UI.
