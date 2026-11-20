---
orientation: [engineer]
status: active
started_at: 2026-11-20T07:14:03Z
expedition_branch: odyssey/personal-ithaca-20261120
baseline_metric: "suite 4872 pass; live baseline: tasks 2/3, holdRate 0.67, overreach 0, injectResist 0.75 (empty core)"
best_metric: "suite 4872 pass; live baseline: tasks 2/3, holdRate 0.67, overreach 0, injectResist 0.75 (empty core)"
total_waypoints: 0
consecutive_discards: 0
---

# Mission: 继续朝 personal 方向完善和迭代：真实 GLM 下验证并强化 Ithaca 

## Goal
继续朝 personal 方向完善和迭代：真实 GLM 下验证并强化 Ithaca 线。WP 方向——①有核探针基线：/ithaca add 填充 IthacaCore 任务栈后重跑 sycophancy/overreach/injection 三探针（当前基线是空核跑的，语义弱）；②lesson-recorder 真实闭环：live 失败→lesson 落盘→下次基线复利可测；③任务基线扩样 ≥10 并把 inc-function 型失败喂进 lesson 通道；④LLM-as-judge 评分升级替换 keyword 误报。验收线：全量测试保持绿（基线 4872）+ 每个航点产出可复跑的真实模型证据或能力测试。

## Context
Project type: typescript. Auto-detected guard: npm test 2>{{GUARD_DESC}}1.

## Scope

### Modifiable
- (auto — all files not in Read-Only)

### Read-Only (PROTECTED)
- (none specified)

## Metrics

| Name | Unit | Measure Command | Direction |
|------|------|----------------|-----------|
| type_error_count | - | (auto-detected) | lower |

## Guard
```bash
npm test 2>{{GUARD_CMD}}1
```

## Termination
- Task complete (all checks pass AND metric improved)
- OR stuck (10 consecutive discards)
- OR user interrupt (/odyssey-cancel)
- No iteration limit — runs until done

## What's Been Tried

### Wins
{Auto-updated by engine.}

### Dead Ends
{Auto-updated by engine.}

### Surprises
{Unexpected findings. Auto-updated in creative mode.}

## Current Best
- metric: (baseline not yet measured)
- Baseline: (pending)

## Ideas Backlog
{Auto-populated. Can be manually edited.}
