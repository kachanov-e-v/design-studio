# Known Issues

- Kilo integration reports clipboard delivery only; it cannot confirm that the Kilo model received or executed the prompt.
- Preview embedding may be blocked by X-Frame-Options/COOP/CSP; external URL may fail to load in iframe.
- Source mapping for React/Vue/Svelte is not implemented; persistence is CSS-selector based and best-effort.
- Persistence supports unambiguous selector-candidate matches only; ambiguous or unsupported CSS constructs are not edited.
- Runtime injection for arbitrary apps requires adding `@design-studio/preview-runtime`; Demo uses injected runtime.
- No DOM/React component tests yet; runtime modules and persistence are tested in Node.
- CSS persistence uses a lightweight parser with selector-list and at-rule handling, not a full CSS AST parser.
- Wildcard postMessage targets are required for opaque VS Code webview origins.