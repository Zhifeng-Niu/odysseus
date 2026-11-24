# autodev — RSI 闭环·自举型递归自我改进（nov24）

## Project Context

Odysseus Spike personal 化完成（nov20c：artifact 验收层/personal 策略/生活
工具/15 任务 live 14/15）。用户定位明确：**自举型 RSI agent**——安全结构已备
（orchestrator 人工审查=控制面隔离、IthacaCore=价值写保护、checkpoint/rollback=
自改安全网），评测层=适应度函数；**缺的是闭环**：Odysseus 自己从未跑过
「改自己→测自己→留优汰劣」的完整一圈。

- Build: `npm run build`；Typecheck: `npm run typecheck`；Test: `npm test`
- 套件基线 ~4948 tests；已知 flaky 见 Constraints
- 真实 GLM key 在 .env（coding-plan 端点）；自改航点跑在**当前 checkout**
  （checkpoint/rollback 保护真仓库）

## Objective

**M1 fitness 函数确定性化（2 分）**：`src/eval/fitness.ts`——
`measureFitness(cwd)` 返回复合适应度：{scriptedSuite 成功率（runTaskSuite 驱动
15 任务，确定性度量编排器/工具机器自身）, unitPass 布尔, score 0-10 加权}。
验收=单测（scripted 全成功→高分；注入一个必然失败 case→分数下降）。全程无
live 调用（scripted provider）。

**M2 self-improve runner + 控制面守卫（3 分）**：`src/scripts/self-improve.ts`：
`--goal "..."` 单发模式——在当前 checkout 跑一个自改航点（checkpoint 自动），
航点后：fitness before/after 对比 + **控制面守卫**（diff 若触及
src/cerebellum/orchestrator.ts → 强制回滚 + curve 记录 control-plane rejected，
纯函数 `guardControlPlane(files)` 可测）。守卫单测 + runner 集成测试
（scripted provider 或 dry 模式）。

**M3 递归曲线记录（2 分）**：`rsi-curve.jsonl`（根目录，tracked）——每轮追加
`{ts, proposal, commit, fitnessBefore, fitnessAfter, delta, verdict}`；纯函数
`appendCurveEntry` + 读取聚合 `readCurve`（首尾 delta、单调性）。验收=单测
（追加/聚合/损坏行容错）。

**M4 live co-evolution 首圈（3 分）**：真实 GLM 跑通第一圈完整递归——从
backlog 取一条 perception 提案（或已知改进项）→ self-improve 航点自改 →
fitness 对比 → curve 落一条真实记录 → 审计（全量套件）合格。验收=curve 有
≥1 条真实记录 + 审计绿 + docs 记录首圈。

**完成判据**：①M1–M3 测试全绿 ②全量 `npm test` 无新失败（已知 flaky 按单跑
判定）③build + typecheck 干净 ④M4 live 首圈在案且审计合格。

## Scope

- IN SCOPE: `src/eval/**`、`src/scripts/**`、`src/cerebellum/**`（OUT 除外）、
  `src/index.ts`（接线守卫更新带理由）、`tests/**`、`docs/**`、`rsi-curve.jsonl`
- OUT OF SCOPE: **`src/cerebellum/orchestrator.ts`（本 run 的主题就是这条规则
  的活体证明——RSI 控制面隔离，禁改）**、`package.json`、`tsconfig.json`、
  `.github/**`、既有测试删除/弱化

## Constraints

- 每文件 <300 行；形状守卫更新附理由
- 子进程只走 `execFileNoThrow`；ESM `.js` 导入；禁 `as any`；不可变模式
- TDD：RED→GREEN 检查点提交；计分区间=上个 keep..HEAD
- 测试不依赖网络；**live 自改只在 scripts 单发模式跑**
- 已知 flaky：voyage-loop / voyage-stats-invariants（存量）/ agent-guards
  stray；真实子进程测试显式 30s 超时
- memory 条目 body 禁用 `## `
- 自改航点跑在当前 checkout：rollback 保护真仓库；控制面守卫是最后一道闸

## Quality Gate Weights

权重：L1=0.30, L2=0.25, L3=0.25, L4=0.20。
**L2 = 里程碑覆盖度**：M1=2、M2=3、M3=2、M4=3（满分 10）。基线 **7.50**。
阶梯（按权重精算）：M1→8.00 / +M2→8.75 / +M3→9.25 / +M4→10.00。

## Ideas Backlog

1. M1 fitness 函数（先做——没有度量就没有 RSI）
2. M2 self-improve runner + 控制面守卫
3. M3 递归曲线
4. M4 live 首圈（从 backlog 提案起步）

## Baseline

（setup 后由 agent 填写）
