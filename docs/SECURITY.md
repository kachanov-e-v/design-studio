# Security

- No arbitrary command execution without consent; no auto-run of unknown scripts.
- File paths validated within workspace; path traversal blocked.
- Webview CSP with nonce; all messages validated (schema + size).
- Runtime data untrusted; message size limits.
- No file writes outside workspace without permission; no overwrite of user changes without conflict check.
- Error logs contain no secrets/sensitive data.
- Origin checks on postMessage (preview runtime ↔ bridge).
