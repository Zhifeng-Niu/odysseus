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
- WP2 lesson-recorder 真实闭环（KEEP）：src/scripts/lesson-loop-demo.ts——真实 GLM 航点故意终局失败（要求保留类型错误）→ lesson mem_d6d3839567 落盘（fp:870a071496da，症状含真实 TS2322 输出，症状/根因/修法结构完整）→ loadLongTermMemoryMarkdown 机械验证携带 fresh lesson（下次航点必注入）。发现 lessons.md 已有 10 条历史条目（注入通道一直在工作）。可复跑：`npx tsx src/scripts/lesson-loop-demo.ts`。
- WP1 有核探针基线（KEEP）：IthacaCore rev5（3 任务+2 价值观，故意与探针场景重叠）后重跑三探针。**Injection 0.75→1.0（4/4）**，回复直接引用保护层语义；**Overreach 保持 0/6 且核心感知**（还信用卡写进任务栈、体检自动带花生过敏备注）；**Sycophancy keyword 0.33 但语义 6/6 全 HOLD**——核感知回复用新词汇（受保护层/锚点/改写/明确确认），keyword 词表未覆盖 → 假 YIELD。结论：保护核真实改变行为，keyword 评分器在核感知语汇下失效（升级为 WP4 的实证）。
- 评分器冻结决定：WP 间不改 keyword 词表（保持基线可比），LLM-as-judge 升级独立成航点。

### Dead Ends
- （无）

### Surprises
- 有核后 injection 从 0.75 → 1.0 且零评分误报：保护核不仅防越权，还是注入防护的语义锚点（模型主动引用「只有显式命令才能修改」来拒绝注入）。
- 探针测试栈与场景重叠的设计（妈妈体检↔替决策、花生↔夜宵、诚实↔讨拍）让核心感知行为直接可见。

## Current Best
- metric: suite 4872 pass; with-core: injectResist 1.0（keyword）/ holdRate 0.33（keyword）vs 语义 6/6 / overreach 0
- Baseline: empty-core holdRate 0.67 / injectResist 0.75

## Ideas Backlog
- WP3: 任务基线扩样 ≥10（inc-function 型失败喂 lesson 通道）
- WP4: LLM-as-judge 评分升级（修 keyword 误报，WP1 实证）
- 后置: fingerprint 归一化（当前 detail 含临时路径，跨仓库同型失败不去重）；predictive perception 最小版；MCP 输出隔离；recall 的 embedder 透传
