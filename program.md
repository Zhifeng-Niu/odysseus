# autodev — Personal Agent 完全体·personal 化（nov20c）

## Project Context

Odysseus Spike：编码域的自主 agent 已完全体（nov20b：评测/学习/语义检索/防护/
预测感知全绿，live 任务基线 9/10）。**本 run 把「以编码为验证域的 Spike」推进为
「个人 agent」**：内核（保护核/记忆/lesson/探针/防注入）已域无关，差的是
①验证层可插拔 ②personal 身份与策略 ③生活工具面。真实 GLM 可用
（.env 已配 coding-plan 端点），基线见 docs/baseline-2026-11-20.md。

- Build: `npm run build`；Typecheck: `npm run typecheck`；Test: `npm test`
- 套件基线 ~4908 tests；已知 flaky 家族见 Constraints

## Objective

**M1 可插拔验证层·artifact 类型（3 分）**：VerifyLayer 增加 `'artifact'`——
runVerify 读 `${cwd}/.odysseus/acceptance.json`（声明式验收：`[{path, contains?,
existsOnly?}]`，由任务/harness 声明而非 agent 自评）。验收测试：spec 存在且全部
满足=pass；任一不满足=fail（detail 列出缺哪条）；无 spec=skipped；损坏 spec
（坏 JSON）=fail。编排器零改动（config.verifyLayers 本就可传任意层列表）。

**M2 personal 身份与策略（2 分）**：①`odysseus init` 种子
`.odysseus/self-model.md`（个人 agent 身份：不只是编码 agent，承接生活任务，
声明 artifact 验收习惯）；②strategy-prompt 增加个人域段落——goal 无代码产物
时引导 agent 用 artifact 验收声明而非硬套 progress 层。验收=单测覆盖种子内容
与策略段落文本（fixture 断言），orchestrator 不动。

**M3 生活工具面 v0（2 分）**：新增两个本地机械工具（走 registry 既有契约，
含 quarantine 产物 + mutates 声明）：`reminder add|list|done`（文件后端
`~/.odysseus/reminders.json`）与 `note write|read`（`~/.odysseus/notes/`）。
index.ts 注册（守卫更新带理由）。验收=工具单测（相对 cwd 注入、无网络）。

**M4 生活域基线扩样 + live（3 分）**：baseline-tasks 增 ≥5 个生活域任务
（写周报 md/记账 csv/提醒文件/会议纪要/读书笔记——全部 artifact 验收），
verifyLayers 用 `['progress','artifact']`；harness 能力测试（scripted 全绿）
+ live ≥15 任务跑一轮记录进 baseline 文档。

**完成判据**：①M1–M4 各有真实测试且全绿 ②全量 `npm test` 无新失败（已知
flaky 按单跑判定）③build + typecheck 干净 ④M4 live ≥15 记录在案。

## Scope

- IN SCOPE: `src/**`（OUT 除外）、`tests/**`、`docs/**`
- OUT OF SCOPE: `src/cerebellum/orchestrator.ts`（人工审查规则——自主循环禁改）、
  `package.json`、`tsconfig.json`、`.github/**`、既有测试删除/弱化

## Constraints

- 每文件 <300 行；形状守卫更新必须附理由注释
- 子进程只走 `execFileNoThrow` / spawn argv + `shell:false`；禁 `child_process.exec`
- ESM `.js` 导入；`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 全绿；
  禁 `as any`；不可变模式
- TDD：RED→GREEN 检查点提交；计分区间=上个 keep..HEAD
- 测试不依赖网络（live 只在 scripts）
- 已知 flaky：voyage-loop / voyage-stats-invariants（存量）/ agent-guards stray；
  含真实 tsc/vitest 的测试需显式 30s 超时
- memory 条目 body 禁用 `## ` 标题

## Quality Gate Weights

权重：L1=0.30, L2=0.25, L3=0.25, L4=0.20。
**L2 = 里程碑覆盖度**：M1=3、M2=2、M3=2、M4=3（满分 10）。验收测试全绿=满分，
半=半分，未做=0。基线：**7.50**。
阶梯：M1→8.25 / +M2→9.00 / +M3→9.75 / +M4→10.00。

## Ideas Backlog

1. M1 artifact 验证层（先做——生活任务的验收基座）
2. M2 personal 身份与策略
3. M3 生活工具面 v0
4. M4 生活域基线扩样 + live

## Baseline

（setup 后由 agent 填写）
