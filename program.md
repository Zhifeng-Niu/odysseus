# autodev — 舒服的产品·显示分级与感知守卫（nov21）

## Project Context

Odysseus Spike personal 化已完成（nov20c：artifact 验收层/personal 策略/生活
工具/15 任务 live 14/15）。用户实测 voyage console 反馈：**一句话刷满屏**——
聊天轮次显示 ROLLBACK、home 目录下感知 check-in 自动触发并把失败探测刷了
满墙。透明性保留，响度必须分级。

关键接缝（已勘察）：`[ROLLBACK]` 标签在 `src/tui/waypoint-card.tsx:61` 的
STATUS_BADGE；状态由纯函数 `summarize(events)` 推导（可抽测）；`summarize`
把有 `waypoint-rolled-back` 事件的航点一律标 ROLLBACK——纯聊天航点（零工具
调用 + 有 assistant 回复）被误标。感知侧：`perception/clock.ts` 无条件产生
check-in 事件，`perception/hub.ts` 入队无守卫。

- Build: `npm run build`；Typecheck: `npm run typecheck`；Test: `npm test`
- ink-testing-library 在 devDeps（TUI 渲染测试可用）
- 已知 flaky 见 Constraints

## Objective

**M1 航点显示分级·CHAT 标签（3 分）**：`summarize` 抽到
`src/tui/waypoint-summary.ts`（纯函数，单测）；规则扩展——rolled-back +
**零工具调用** + 有 assistant 回复 → 状态 `'chat'`、标签 `CHAT`（不再误标
ROLLBACK）；有工具调用的失败航点保持 ROLLBACK（诚实）。ink-testing-library
渲染测试：用真实会话 fixture（「你好你是谁」事件序列形态）断言。

**M2 感知守卫（2 分）**：`PerceptionHubOptions` 增可注入
`gate?: (event) => Promise<boolean>`（false → 该事件不入队）；index.ts
voyage console 接线：clock 事件仅当保护核非空（renderForPrompt 非空）放行。
hub 单测用 fake gate；hub 保持纯净（不 import ithaca）。

**M3 常规步骤折叠·错误浮出（3 分）**：WaypointCard 的事件列表分级渲染——
**连续成功的工具调用**折叠为单行摘要（`· N tool calls ok（file-read ×2,
git ×1）`）；错误（✗）、verify 失败、审批、assistant 回复**全文浮出**。
折叠逻辑抽纯函数 `collapseToolCalls(events)` 单测 + 渲染断言。

**M4 真实会话 fixture 全量验收（2 分）**：把用户实跑的两次航点（「你好你是
谁」聊天 + home-dir check-in 探测墙）录成事件 fixtures，新渲染下断言：
①聊天航点零 ROLLBACK 字样、有 CHAT ②check-in 的每次错误探测全文保留（可
归因）③成功工具调用折叠 ④events.jsonl 记录契约不变（轨迹无丢失）。

**完成判据**：①M1–M4 测试全绿 ②全量 `npm test` 无新失败（已知 flaky 按单
跑判定）③build + typecheck 干净。

## Scope

- IN SCOPE: `src/tui/**`、`src/perception/**`、`src/index.ts`（接线，守卫
  更新带理由）、`tests/**`、`docs/**`
- OUT OF SCOPE: `src/cerebellum/orchestrator.ts`（人工审查规则——自主循环
  禁改）、`package.json`、`tsconfig.json`、`.github/**`、既有测试删除/弱化、
  `events.jsonl` 记录契约（M4 验收恰恰要求它不变）

## Constraints

- 每文件 <300 行（`app.tsx` 已 300 满载、`chat-panel.tsx` 334——新逻辑一律
  放独立模块，改动处只加引用）；形状守卫更新附理由
- TUI 渲染测试用 ink-testing-library 或纯函数直测（display-level 逻辑必须
  抽纯函数，组件只做渲染）
- `summarize`/`collapseToolCalls` 等纯函数放 `waypoint-summary.ts`；不 import
  ink（保证 Node 直测）
- 子进程只走 `execFileNoThrow`；ESM `.js` 导入；禁 `as any`；不可变模式
- 已知 flaky：voyage-loop / voyage-stats-invariants（存量）/ agent-guards
  stray；含真实子进程的测试显式 30s 超时

## Quality Gate Weights

权重：L1=0.30, L2=0.25, L3=0.25, L4=0.20。
**L2 = 里程碑覆盖度**：M1=3、M2=2、M3=3、M4=2（满分 10）。基线 **7.50**。
阶梯：M1→8.25 / +M2→8.75 / +M3→9.50 / +M4→10.00。

## Ideas Backlog

1. M1 CHAT 标签 + summarize 抽取（先做——直接回应用户抱怨）
2. M2 感知守卫（hub gate 可注入 + 保护核非空接线）
3. M3 常规折叠·错误浮出（分级显示主体）
4. M4 真实会话 fixtures 全量验收（收官）

## Baseline

（setup 后由 agent 填写）
