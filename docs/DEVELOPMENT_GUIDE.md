# Development Guide

## Prerequisites

- Node 26+, npm 11+, VS Code 1.105+.

## Setup (EPIC 1+)

Will be filled during EPIC 1: install deps, build, launch Extension Development Host.

## Conventions

- TypeScript strict; no `any` in domain.
- No comments unless requested.
- Adapter boundary: Kilo adapter uses only `vscode.commands`.
- Domain has no infra deps.

## Empirical verification

Kilo command behavior must be verified in EDH, not assumed (minified bundle).
