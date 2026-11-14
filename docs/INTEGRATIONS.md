# Integrations

## Kilo Code

See ADR-002. Adapter `KiloCodeAdapter` implements `AIIntegrationAdapter`. Commands used: `focusChatInput`, `addToContext`, `openInTab`. MVP uses clipboard fallback with explicit status. MCP path deferred.

## DesignElementContext

Typed, versioned context passed to Kilo. Fields limited; excludes secrets, form inputs, user data. Size capped.

## Prompt template

Structured request built from element context + instruction; copied to clipboard on MVP.

## Future

MCP server for structured context push (EPIC 8+).
