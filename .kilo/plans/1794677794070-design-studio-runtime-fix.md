# Design Studio runtime integration fix plan

Plan-only analysis for branch `fix/design-studio-runtime-integration`. No source files are changed by this plan.

## Scope and confirmed findings

The repository is a VS Code extension with a React/Vite webview and an ESM preview runtime package. The confirmed defects are concentrated in runtime handshake, build/copy pipeline, status conflation, CSS selector matching, style ack handling, protocol validation, and duplicated message ownership.

## Confirmed problems

1. **Runtime handshake race.** `packages/preview-runtime/src/index.ts` emits `ds:runtime-ready` exactly once at script execution. `webview/components/PreviewContainer.tsx` registers its `message` listener in a passive effect, so a fast iframe can emit before the listener exists. There is no retry or nonce. Root cause: one-shot unsolicited readiness plus timing-dependent listener registration.

2. **Non-deterministic build pipeline.** `package.json` runs `copy:runtime` in both `build` and `build:webview`. `scripts/copy-runtime.js` silently skips a missing `protocol.js`, while `runtime.js` imports `./protocol.js`. Root cause: duplicate copy step and missing mandatory artifact validation.

3. **Status conflation.** `src/extension/commands/openDesignStudio.ts` sets `preview:state.status` to `"ready"` whenever a URL exists or Demo is selected. The webview treats this as integration success even though Runtime may be absent. Root cause: Extension Host preview configuration state is used as Runtime readiness state.

4. **CSS selector mismatch.** Runtime `getSelector()` produces `div.box` or descendant paths, while `StylePersistenceAdapter.findCssRules()` performs exact string membership (`selectors.includes(selector)`). A rule written as `.box` is not matched. The regex parser also cannot safely handle `@media`, comments, nested at-rules, or selector lists. Root cause: semantic CSS identity is reduced to string equality and a non-CSS parser.

5. **Incomplete style ack.** `PreviewContainer` forwards `ds:style-applied` without `success`, `reason`, or `requestId`. `App.tsx` updates `selected`/`lastChange` without checking success and sets `lastChange` immediately in `applyStyle`, before Runtime confirmation. Root cause: command and acknowledgment are not correlated.

6. **Duplicated message ownership.** `App.tsx` and `FloatingPanel.tsx` both listen to `persist:result`; Save logic exists in both Toolbar and FloatingPanel. `bridge.ts` has no validation or lifecycle isolation. Root cause: operation state has multiple writers.

7. **Insufficient protocol validation.** `isRuntimeMessage` and `isElementPayload` do not reject `NaN`/`Infinity`, negative sizes, oversized style maps, invalid style values, or missing handshake/session fields. Runtime accepts commands from any parent without source/origin/session checks. Root cause: type-level checks only, no semantic boundary validation.

8. **Missing tests.** There are validator and persistence unit tests, but no tests for handshake recovery, stale iframe isolation, style ack correlation, build artifacts, selector candidates, CSS ambiguity, or single persist-result ownership.

## Problems not confirmed by current code

- `.vscodeignore` does not exclude `dist/**`; it excludes source trees and dev files. Packaging inclusion of `dist` is not currently broken by ignore rules, but should be verified with an actual VSIX inspection rather than assumed.
- `src/shared/constants.test.ts` imports `../shared/constants`, which resolves correctly from `src/shared`; this is not a failing defect.
- Arbitrary third-party sites are intentionally not supported by automatic Runtime injection. This is a documented limitation, not a bug to "fix" by bypassing browser security.
- Ambiguity rejection in `StylePersistenceAdapter.apply` already exists for multiple matches; the failure is that compatible matches are often not found at all due to selector mismatch.

## Implementation sequence

### Phase 0 - Baseline
No file changes. Record `git status`, branch, HEAD, Node/npm versions, typecheck, lint, test, build, and artifact inventory. Establish first failure point before edits.

### Phase 1 - Runtime handshake
Files:
- `packages/preview-runtime/src/protocol.ts`
- `packages/preview-runtime/src/index.ts`
- `webview/components/PreviewContainer.tsx`
- `webview/types.ts` (if diagnostic types are added)
- `webview/App.tsx` (status plumbing)

Work:
- Add `ds:ping` and `ds:pong`/`ds:runtime-ready` messages with `nonce`, `sessionId`, and `version`.
- Runtime installs its `message` listener before responding; it answers ping with the same nonce.
- Parent creates a session nonce before iframe creation/reload, registers listener first, sends ping on `load`, retries with bounded backoff, and clears timers on unmount/navigation.
- Accept only messages whose `event.source === iframe.contentWindow` and whose nonce/session match the active session.
- Treat missing Runtime only after retry exhaustion.
- Separate iframe load, handshake, missing, blocked, and protocol-version states.
- Send current edit mode only after successful handshake.

Acceptance:
- Demo handshake passes on cold and fast loads.
- 20 consecutive reloads do not produce random missing state.
- A stale iframe cannot mark a new preview ready.
- Missing Runtime reaches `missing` after timeout.
- Protocol version mismatch is a distinct diagnostic state.

### Phase 2 - Deterministic build pipeline
Files:
- `package.json`
- `scripts/copy-runtime.js`
- new `scripts/verify-build.js` (or equivalent test)
- `packages/preview-runtime/package.json`
- `packages/preview-runtime/tsconfig.json`
- `vite.config.ts`

Work:
- Remove duplicate `copy:runtime` from `build:webview`; keep one copy point after Runtime build.
- Make `copy-runtime.js` fail with non-zero exit if `dist/index.js` or `dist/protocol.js` is missing or empty.
- Add post-Vite verification for `dist/webview/demo.html`, `runtime.js`, and `protocol.js`.
- Keep canonical source in `packages/preview-runtime/src`.
- Verify `.vscodeignore` and production VSIX contents, including `dist/extension.js` and `dist/webview/**`.

Acceptance:
- Clean `npm ci` + `npm run build` succeeds.
- Repeated builds produce the same required artifact set.
- Missing `protocol.js` fails the build with a clear message.
- Demo does not depend on dev server or repository-root source files.

### Phase 3 - Preview diagnostics and URL handling
Files:
- `src/extension/commands/openDesignStudio.ts`
- `webview/App.tsx`
- `webview/components/PreviewContainer.tsx`
- `webview/components/Toolbar.tsx`
- `docs/DEVELOPMENT_GUIDE.md`

Work:
- Separate Extension Host preview configuration status from iframe/Runtime status.
- Normalize and validate user URLs; allow only `http:`/`https:`.
- Keep Demo as an internal scenario outside user URL validation.
- Show distinct messages for no URL, loading, Runtime missing, Runtime ready, blocked iframe, and protocol error.
- Runtime missing state must show integration instructions and diagnostic details without secrets.
- Add a diagnostics action exposing current URL, iframe load state, Runtime state, protocol version, and last error.

Acceptance:
- Demo works without a user application.
- An app importing the Runtime works after URL entry.
- A page without Runtime is not reported as successful integration.
- A blocked iframe does not spin forever.

### Phase 4 - Protocol and message security
Files:
- `packages/preview-runtime/src/protocol.ts`
- `packages/preview-runtime/src/index.ts`
- `webview/components/PreviewContainer.tsx`
- `webview/App.tsx`
- `webview/bridge.ts`
- `src/shared/protocol.ts`

Work:
- Use one discriminated union and one `PROTOCOL_VERSION` everywhere.
- Validate all payload fields: bounded strings, finite non-negative rect values, bounded style maps with string values, property/value lengths/formats, and required nonce/session/request IDs.
- Accept Runtime messages in the parent only from `iframe.contentWindow`.
- Runtime accepts commands only from `window.parent`; check nonce/session and known-safe origin where possible.
- Do not derive origin from payload.
- Return structured failures with `success`, `reason`, and `requestId`.
- Runtime must not collect form values, storage, cookies, or secrets.

Acceptance:
- Invalid/stale messages are ignored without breaking UI.
- Messages from another window cannot change selection.
- Commands for an old session do not apply to a new page.
- Runtime and webview share one contract.

### Phase 5 - Inspector and temporary style application
Files:
- `webview/App.tsx`
- `webview/components/Inspector.tsx`
- `webview/components/PreviewContainer.tsx`
- `packages/preview-runtime/src/index.ts`
- `packages/preview-runtime/src/protocol.ts`

Work:
- `applyStyle` creates and sends `requestId`.
- Update `selected` and `lastChange` only on `ds:style-applied` with `success === true` and matching `requestId`.
- On failure, show `reason`, do not update selected, and keep Save disabled.
- On success, update `selected` from the full payload.
- Add pending state and ordering by `requestId`.
- Define explicit clear-property contract for empty values.
- Reset selected element on URL change, reload, and Runtime session loss.

Acceptance:
- Inspector shows computed styles after successful change.
- Runtime failure is visible and does not create false applied state.
- Save is available only for confirmed changes.
- Older responses cannot overwrite newer values.

### Phase 6 - CSS persistence and selector matching
Files:
- `packages/preview-runtime/src/index.ts`
- `packages/preview-runtime/src/protocol.ts`
- `webview/types.ts`
- `src/infrastructure/persistence/StylePersistenceAdapter.ts`
- `src/infrastructure/persistence/StylePersistenceAdapter.test.ts`

Work:
- Emit selector candidates (`id`, class-based, tag/ancestor path) with confidence instead of one arbitrary selector.
- Match candidates to source CSS selectors safely; do not treat `div.box` and `.box` as string-equal.
- Handle ordinary CSS rules explicitly and report unsupported constructs instead of editing.
- Return ambiguity when more than one rule matches; never pick the first.
- Improve CSS parsing enough for comments, selector lists, `@media`, pseudoclasses, and nested at-rules, or document supported subset and reject unsupported input.
- Keep `WorkspaceEdit`, save only after successful `applyEdit`, and surface errors.
- Add conflict/external-change checks only if supported by tests.

Acceptance:
- `.class` selected on `div.class` saves to the correct `.class` rule.
- Ambiguous matches do not modify files.
- Comments and neighboring rules remain intact.
- Persistence scenarios are covered by tests.

### Phase 7 - Message and status ownership
Files:
- `webview/App.tsx`
- `webview/components/FloatingPanel.tsx`
- `webview/components/Toolbar.tsx`
- `webview/bridge.ts`

Work:
- Make `App.tsx` the single owner of extension operation state.
- Route Toolbar and FloatingPanel Save through one callback/use-case.
- Centralize extension message types and runtime-validate them.
- Give `bridge.ts` explicit listener lifecycle and tests.
- Stop processing stale messages after panel/URL/session changes.
- Use uniform operation statuses: idle, pending, success, error.

Acceptance:
- `persist:result` updates status once.
- Duplicate Save paths call the same operation.
- Stale panel messages do not affect current state.

### Phase 8 - Tests
Unit:
- Protocol validators: valid/invalid payloads, wrong version, wrong nonce, wrong requestId, NaN/Infinity, negative sizes, style limits.
- Runtime selector candidates.
- Runtime style validation.
- CSS selector matching.
- Persistence ambiguity and conflict handling.
- Status transitions.

Component/integration:
- Listener registration before handshake.
- Lost first ping recovery.
- Stale iframe cannot change new state.
- Runtime missing rendering.
- Selection updates Inspector.
- Successful `apply-style` updates Inspector and `lastChange`.
- Failed `apply-style` does not enable Save.
- Single `persist:result` handling.

E2E/manual:
- If Playwright can be added without architecture changes, add minimal Demo iframe E2E.
- Otherwise provide a manual smoke-test checklist and do not call it automated.

Build/artifact:
- Assert required files exist after build.
- Assert `runtime.js` imports `./protocol.js` and the target exists.

### Phase 9 - Documentation
Files:
- `README.md`
- `docs/DEVELOPMENT_GUIDE.md`
- `docs/INTEGRATIONS.md`

Work:
- Distinguish built-in Demo, user app with Runtime import, and third-party site limitations.
- Document artifact verification, handshake inspection, CSP/X-Frame-Options checks, missing Runtime messages, and dev server restart.
- Do not promise arbitrary website support.

## Test strategy

- Keep Vitest as the runner.
- Add DOM-dependent component tests only after deciding on `jsdom`/`happy-dom` as a devDependency; otherwise test runtime modules and persistence in Node.
- Add a build artifact test that runs against `dist` after `npm run build`.
- Manual smoke test: Demo handshake, edit mode, hover, select, apply style, ack, Save with unambiguous CSS, reload reconnect, missing Runtime URL.

## Risks

- Handshake changes can break existing Runtime consumers if message types are not backward-compatible; use additive ping/pong while retaining `ds:runtime-ready`.
- CSS parsing improvements may introduce regressions; preserve existing behavior through focused tests.
- DOM test environment may require a new devDependency, which needs approval under project constraints.
- Source-origin checks in Runtime are limited because parent webview origin is not known ahead of time.
- Packaging must be verified by actual VSIX inspection; ignore rules are currently not the obvious cause.

## Completion criteria

- Full Demo scenario passes: handshake, edit mode, hover, select, apply style, ack, Save on unambiguous CSS, reload, reconnect.
- Missing Runtime is diagnosed, not masked as ready.
- Build is deterministic and fails on missing mandatory artifacts.
- Save is enabled only after confirmed style application.
- Ambiguous or unmatched CSS rules never modify files.
- Typecheck, lint, tests, and build pass.
- Protocol validation and session isolation tests pass.

## Suggested verification commands

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Then inspect `dist` and package contents.
