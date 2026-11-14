# Testing Strategy

- Unit: Vitest for domain/application logic, adapters, protocol validators, selector candidates, CSS matching, and persistence ambiguity handling.
- UI: component/integration tests require a DOM environment (`jsdom` or `happy-dom`) if added; otherwise keep runtime modules testable in Node.
- Integration: `@vscode/test-cli` for extension activation/commands where available.
- E2E Preview: Playwright for runtime bridge flows, or a documented manual smoke test when Playwright is not configured.
- Security tests: message validation, origin/session isolation, path traversal cases.
- Persistence tests: ambiguity, missing rules, comments, selector lists, media blocks, conflict handling.
- Build tests: required production artifacts and runtime import resolution.

Coverage focus: persistence safety, mapping confidence, adapter availability, handshake recovery, and status transitions.

## Current automated tests

- `packages/preview-runtime/src/protocol.test.ts`
- `src/shared/url.test.ts`
- `src/shared/constants.test.ts`
- `src/infrastructure/persistence/StylePersistenceAdapter.test.ts`
- `src/build.test.ts`

## Manual smoke test

1. Open Design Studio.
2. Click Demo and wait for `Runtime connected`.
3. Enable Edit mode.
4. Hover `.box` and see highlight.
5. Click `.box`; Inspector shows tag, selector, and styles.
6. Change color; iframe updates and `style-applied success=true` is returned.
7. Save to source with an unambiguous CSS rule.
8. Reload preview and confirm reconnect.
9. Open a URL without Runtime and confirm `Runtime not detected` plus instructions.