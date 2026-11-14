# Testing Strategy

- Unit: Vitest for domain/application logic and adapters (mock VS Code APIs).
- UI: Testing Library for webview components.
- Integration: @vscode/test-cli for extension activation/commands.
- E2E Preview: Playwright for runtime bridge flows.
- Security tests: message validation, path traversal cases.
- Persistence tests: conflict detection, rollback, undo/redo.

Coverage focus: persistence safety, mapping confidence, adapter availability.
