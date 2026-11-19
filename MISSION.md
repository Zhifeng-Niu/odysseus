---
orientation: [engineer]
status: active
started_at: 2026-11-19T10:09:59Z
expedition_branch: odyssey/stable-agent-20261119
baseline_metric: "suite 4817 pass, build+tsc clean"
best_metric: "e2e-task-completion 3/3 green, suite 4825 pass"
total_waypoints: 1
consecutive_discards: 0
delivery_tier: standard
patience_budget: 30
discard_threshold: 10
min_metric_delta_pct: 0.5
---

# Mission: crash-free task-completing agent (IBM-guide-aligned)

## Goal

Make the Odysseus Spike a **crash-free agent that completes tasks end-to-end**.
Acceptance line: a waypoint loop (checkpoint -> act -> verify -> commit/rollback)
runs stable under a scripted LLM; a real code task produces an artifact that
passes verify; error paths degrade gracefully instead of crashing. After the
stability baseline, layer completeness per the consensus template (perception /
memory retrieval / protocols / evals) is fair game.

## What's Been Tried

### Wins
- Ithaca MVP merged to main: protected core, /ithaca (CLI+TUI), prompt slot,
  sycophancy+overreach probes, Perception hub, memory retrieval, MCP client.
- Full suite 4817 pass; build + tsc clean (baseline state at mission start).

### Dead Ends
- (none)

### Surprises
- Full-suite failures come from a concurrent-timing flaky family (voyage-loop,
  git-dependent tests) - single-run passes; judged against baseline worktree.

## Waypoint Plan

- WP1: DONE. Root cause found: bare `tsc --noEmit` in dirs without tsconfig.json
  failed EVERY waypoint (help-text exit). Fix: single-file fallback over git-changed
  .ts files + e2e proofs (checkpoint commit / crash graceful / rollback clean).
- WP2: Hardening - unhandledRejection/uncaughtException guards at the entry,
  graceful degradation for provider/tool errors mid-voyage.
- WP3+: Layer completeness per consensus template as stability allows.

## Guard

```
npm test stays green (4817+ pass, flaky family judged by single-run);
npm run build and tsc --noEmit stay clean;
no edits to src/cerebellum/orchestrator.ts without human review note.
```

## Current Best

- metric: baseline (suite green, build clean, no e2e task-completion proof yet)
