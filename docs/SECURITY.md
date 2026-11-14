# Security

- No arbitrary command execution without consent; no auto-run of unknown scripts.
- File paths validated within workspace; path traversal blocked.
- Webview CSP with nonce; all messages validated (schema + size).
- Runtime data untrusted; message size limits.
- No file writes outside workspace without permission; no overwrite of user changes without conflict check.
- Error logs contain no secrets/sensitive data.
- Origin checks on postMessage (preview runtime ↔ bridge).

## Message boundaries

- Parent accepts Runtime messages only from the current `iframe.contentWindow`.
- Runtime accepts commands only from `window.parent`.
- Handshake uses a parent-generated nonce; stale sessions are ignored.
- Protocol version must match before a message is accepted.
- Payloads are validated for bounded strings, finite non-negative geometry, bounded style maps, and safe CSS property/value lengths.
- Runtime does not collect form values, cookies, localStorage, or secrets.

## CSP and framing

- Extension assets are loaded through `webview.asWebviewUri` and `localResourceRoots`.
- Production HTML asset paths are rewritten to webview URIs.
- Demo runtime assets remain relative to `demo.html`.
- Arbitrary third-party sites are not bypassed for framing or CSP restrictions.
- Wildcard postMessage targets are used only where the recipient origin is opaque, such as VS Code webview resources; source/nonce validation still applies.