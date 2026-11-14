# Project Overview

## Vision

Visual design/editing surface inside VS Code for web applications: preview, inspect, edit styles, and hand off structured context to Kilo Code.

## Target users

Frontend developers using React/HTML+CSS projects in VS Code with Kilo Code installed.

## MVP scope (in)

Opening Design Studio, Preview (dev server/URL), Edit Mode, hover/selection, Inspector (Element/Layout/Spacing/Typography/Appearance/Border/Effects/Position/Advanced/Source), floating panel, Kilo context handoff with clipboard fallback, visual style editing with source persistence, Undo/Redo, HMR refresh.

Adapters: React + plain HTML/CSS (MVP). Tailwind/CSS Modules partial.

## Out of MVP

Vue/Svelte/SCSS adapters, Layers tree, Shadow DOM (if non-trivial), auto-send to Kilo, Plugin Manager, MCP server, VSIX publishing.

## Key constraints

- No public Kilo API → command-driven + fallback.
- Preview via iframe + runtime injection; external browser fallback.
- Source mapping carries confidence; unknown → explicit + Kilo alternative.
