# Odysseus Spike — Codebase Guide

## Project Status

Spike Phase of Odysseus v2. Iteration 0 is hand-written; from Iteration 1 the agent uses Cerebellum to extend itself.

## Architecture

Single TypeScript ESM package, ~1500 LOC across 19 source files at Iteration 0 (the original design spec estimated ~530; actual came in larger once all primitives, retry logic, and the orchestrator were wired together):
- `src/agent/` — outer loop, context, prompt builder
- `src/llm/` — GLM-5.2 provider (OpenAI-compatible), retry
- `src/tools/` — registry, file tools, git tool
- `src/cerebellum/` — waypoint, checkpoint, verify, rollback, strategy, orchestrator
- `src/trace/` — JSONL writer
- `src/util/` — `execFileNoThrow` (shell-free subprocess)

## Key Constraints

- Every file < 300 lines (violation triggers self-refactor waypoint)
- All subprocess calls go through `execFileNoThrow` — NEVER `child_process.exec` (injection risk; the safety hook will reject it)
- All LLM access through `LLMProvider` interface
- Configuration via env vars only
- Edits to `src/cerebellum/orchestrator.ts` require manual review

## Build & Test

```bash
npm run build     # tsc
npm test          # vitest
npm run typecheck # tsc --noEmit
```

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- ESM imports use `.js` extension
- No `as any` in production
- Immutability: spread, never mutate
- Errors: structured `{ ok: false, error }` or thrown with named class
