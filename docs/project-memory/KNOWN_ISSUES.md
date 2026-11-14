# Known Issues

- Kilo command semantics verified partially; adapter checks availability dynamically.
- Auto-send to Kilo not available; clipboard fallback only.
- `addToContext` requires editor selection; not used for arbitrary context.
- Preview embedding may be blocked by X-Frame-Options/COOP; external URL may fail to load in iframe.
- Source mapping for React/Vue/Svelte not implemented; persistence is CSS-selector based and best-effort.
- Runtime injection for arbitrary apps requires adding `@design-studio/preview-runtime`; Demo uses injected runtime.