# Architecture

## Layers

```
extension/        activate, commands, providers, webview registration
presentation/     webview React UI (toolbar, preview container, inspector, overlays, floating panel)
application/      use-cases + services + ports (interfaces)
domain/           entities, value-objects, domain services, events, errors (no infra deps)
infrastructure/   vscode, preview (host server + project serving), runtime, source-mapping, persistence, journal (.design-studio), MCP server, ai-integrations (agent handoff), messaging, storage
packages/         shared-contracts, preview-runtime
```

Rules: UI contains no persistence/AI business logic; core independent of UI; MCP server and agent handoff isolated from VS Code UI (MCP core is UI-free and testable); domain has no VS Code/React/Node/agent deps.

## Key interfaces

```ts
interface PreviewAdapter { detectProject(): Promise<PreviewCapabilities>; start(): Promise<PreviewSession>; stop(): Promise<void>; refresh(): Promise<void>; getStatus(): PreviewStatus; }
interface FrameworkAdapter { id: string; detect(): Promise<boolean>; initialize(): Promise<void>; dispose(): Promise<void>; }
interface SourceMappingAdapter { id: string; resolveElement(element: ElementReference): Promise<SourceMappingResult>; }
interface AIIntegrationAdapter { id: string; isAvailable(): Promise<boolean>; sendContext(ctx: ElementSelectionContext, instruction: string): Promise<SendContextResult>; }
interface StylePersistenceAdapter { id: string; canEdit(source: SourceMappingResult): Promise<boolean>; apply(change: StyleChange): Promise<PersistenceResult>; }
```

## Project binding

- The extension scans workspace `*.html` (node_modules/dist/build excluded) and
  pins a `PreviewSession` to one entry file or a `localhost` dev server URL.
- Arbitrary external URLs are rejected (`isLocalhostUrl` guard).
- `PreviewHostServer` serves the pinned project under `/project/<rel>` with
  traversal jail (`resolveProjectPath`) and injects the runtime into HTML.

## Design change journal + MCP

- `DesignChangeStore` owns `<workspace>/.design-studio/`:
  `changes.jsonl` (append-only), `DESIGN_STATE.md` (regenerated), `handoff.json`.
- Style saves persist via WorkspaceEdit and are stored as
  `applied-to-source`; block/text edits are stored as `pending` for the agent.
- `DesignStudioMcpCore` (agent-agnostic) + `dist/mcp-server.js` (stdio entry)
  expose 6 tools; agents apply pending items and acknowledge.
- `AgentHandoffService` writes the handoff file, focuses agent chats
  (Kilo Code, Mistral Vibe command probing) and copies a prompt to clipboard.

## Data flow

Preview runtime → bridge → extension → webview UI → inspector → persistence/journal → MCP server → AI agent.

## Runtime handshake

- PreviewContainer owns iframe lifecycle and a per-URL session nonce.
- Parent sends `ds:ping`; runtime responds with `ds:pong`.
- Retries use bounded backoff; timeout transitions to `missing`.
- Stale iframe messages are ignored by `event.source` and session nonce.

## Build and packaging

- Runtime source is canonical in `packages/preview-runtime/src`.
- Build produces `dist/webview/runtime.js` and `dist/webview/protocol.js`.
- `scripts/verify-build.js` validates required artifacts after Vite build.
