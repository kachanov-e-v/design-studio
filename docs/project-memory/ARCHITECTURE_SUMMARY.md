# Architecture Summary

Layers: extension / presentation / application / domain / infrastructure / packages. Core independent of UI. Kilo integration isolated in adapter. Domain has no infra deps. Universal Plugin Manager deferred until ≥2 real scenarios. Key interfaces: PreviewAdapter, FrameworkAdapter, SourceMappingAdapter, AIIntegrationAdapter, StylePersistenceAdapter.
