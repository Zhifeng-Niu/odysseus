# Odysseus — Spike Phase

A Cerebellum-driven, self-bootstrapping coding agent.

> This is the Spike Phase of Odysseus v2. It exists to answer one question: does Cerebellum-style checkpoint → verify → rollback produce measurable capability gains when an agent edits its own code? See [`docs/superpowers/specs/2026-07-18-odysseus-restart-design.md`](docs/superpowers/specs/2026-07-18-odysseus-restart-design.md).

## 一句话部署（Quickstart）

**人类**：一行命令装好（含 init 引导配置 GLM key 并 live 验证）：

```bash
curl -fsSL https://raw.githubusercontent.com/Zhifeng-Niu/odysseus/main/install.sh | bash
```

**给任何编码 agent 的一句话**（Claude Code / OpenClaw / 任意 CLI agent 都能执行）：

> 「请部署 Odysseus（https://github.com/Zhifeng-Niu/odysseus）：clone 仓库 → npm install && npm run build → 运行 odysseus init 把我的 GLM key（我稍后提供）写进 .env 并验证，最后用一句真实任务验收它能完成。」

**本地开发**：

```bash
# 1. Install deps
npm install

# 2. Configure environment（或构建后直接跑 odysseus init 引导配置）
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
