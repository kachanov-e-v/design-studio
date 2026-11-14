# Known Issues

- Kilo integration reports clipboard delivery only; it cannot confirm that the Kilo model received or executed the prompt.
- Preview embedding may be blocked by X-Frame-Options/COOP/CSP; external URL may fail to load in iframe.
- Source mapping for React/Vue/Svelte is not implemented; persistence is CSS-selector based and best-effort.
- Persistence supports unambiguous selector-candidate matches only; ambiguous or unsupported CSS constructs are not edited.
- Runtime injection for arbitrary apps requires adding `@design-studio/preview-runtime`; Demo uses injected runtime.
- No DOM/React component tests yet; runtime modules and persistence are tested in Node.
- CSS persistence uses a lightweight parser with selector-list and at-rule handling, not a full CSS AST parser.
- Wildcard postMessage targets are required for opaque VS Code webview origins.
- vscode-resource (file%2B.vscode-cdn.net) subresource frames failed handshake in iframe-based webviews; demo and preview now run from the PreviewHostServer on 127.0.0.1, vscode-resource demo URI is only a fallback.
- Proxy is best-effort: root-absolute URLs in initial HTML/CSS are rewritten and a service worker re-routes JS-issued same-origin fetches; JS-generated root-absolute URLs emitted before the service worker activates and cross-origin absolute URLs in HTML are not rewritten.
- Websocket HMR tunnel supports http targets only (https/ws targets are dropped).
- Proxy mux hides the user dev server port; the webview URL bar shows the http://127.0.0.1:<port>/proxy/<target> form.