# Integrations

## Kilo Code

See ADR-002. Adapter `KiloCodeAdapter` implements `AIIntegrationAdapter`. Commands used: `focusChatInput`, `addToContext`, `openInTab`. MVP uses clipboard fallback with explicit status. MCP path deferred.

## DesignElementContext

Typed, versioned context passed to Kilo. Fields limited; excludes secrets, form inputs, user data. Size capped.

## Prompt template

Structured request built from element context + instruction; copied to clipboard on MVP.

## Preview Runtime

The Preview Runtime is an ESM package in `packages/preview-runtime`. It must be imported once in the previewed application entry point:

```ts
import "@design-studio/preview-runtime";
```

Runtime behavior:

- Registers document event listeners for hover and selection in edit mode.
- Responds to `ds:ping` with `ds:pong` using the parent-provided nonce.
- Applies temporary styles to the selected element and returns structured `ds:style-applied` acknowledgments.
- Emits selector candidates for CSS persistence.
- Never collects form values, cookies, localStorage, or secrets.

## Runtime handshake

1. PreviewContainer creates a session nonce when the preview URL changes.
2. After iframe load, it sends `ds:ping`.
3. Runtime responds with `ds:pong` and the same nonce.
4. Parent retries with backoff until success or timeout.
5. Messages from stale iframes are ignored by nonce/session.

## Preview limitations

- Arbitrary third-party sites are not automatically supported.
- iframe may be blocked by `X-Frame-Options`, `frame-ancestors`, CSP, or network restrictions.
- Runtime cannot be injected into cross-origin sites without integrating it into the application.
- Runtime missing is reported as a distinct state, not success.
