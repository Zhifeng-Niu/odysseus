# Odysseus — Spike Phase

A Cerebellum-driven, self-bootstrapping coding agent.

> This is the Spike Phase of Odysseus v2. It exists to answer one question: does Cerebellum-style checkpoint → verify → rollback produce measurable capability gains when an agent edits its own code? See [`docs/superpowers/specs/2026-07-18-odysseus-restart-design.md`](docs/superpowers/specs/2026-07-18-odysseus-restart-design.md).

## Quickstart

```bash
# 1. Install deps
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and add your GLM-5.2 API key from https://open.bigmodel.cn

# 3. Build
npm run build

# 4. Run
node dist/index.js add a bash tool to the tools registry
```

## Architecture

```
src/
├── agent/      Perceive → reason → act outer loop
├── llm/        GLM-5.2 OpenAI-compatible provider
├── tools/      File tools + git + registry
├── cerebellum/ Waypoint, checkpoint, verify, rollback, strategy, orchestrator
├── trace/      JSONL experiment log (spike data)
└── util/       execFileNoThrow (shell-free subprocess)
```

## Iteration 0 Capabilities

- GLM-5.2 (non-streaming + streaming)
- 4 tools: `file-read`, `file-write`, `file-edit`, `git`
- Minimal Cerebellum: `engineer` strategy only, `syntax` verify only
- JSONL trace

## Iteration 1+ (co-evolution)

From Iteration 1 onward, the agent uses Cerebellum to extend itself. Each iteration's waypoints are recorded as JSONL — this is the spike's core data asset, aggregated into the 3-dimensional scorecard (efficacy / breakthrough / stability).

## Commands

```bash
npm test          # Run vitest
npm run typecheck # tsc --noEmit
npm run build     # Compile to dist/
npm run dev       # Run via tsx (no build step)
```

## Safety Perimeter

Per design spec Section 6.1, the following require manual review:
- `src/cerebellum/orchestrator.ts`
- `package.json`, `tsconfig.json`, `.gitignore`

The agent may not write any `.env*` file. `git reset --hard` is restricted to SHAs created in the current session.

## License

See [LICENSE](LICENSE).
