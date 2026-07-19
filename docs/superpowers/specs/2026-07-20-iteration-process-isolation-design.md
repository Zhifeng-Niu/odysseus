# Iteration 大节点 + 分进程架构 设计文档

**日期**: 2026-07-20
**作者**: 牛志峰 + Claude
**状态**: Draft (等待用户 review)

## 1. 背景与动机

### 1.1 当前问题

Odysseus Spike 当前存在两个核心问题，这两个问题在 2026-07-19 的 trace 复盘中暴露：

**问题 A: Dream 主导，缺少真正的"演化周期"**

当前 voyage loop 结构：
```
for (i=0; i<maxWaypoints; i++) {
  waypoint = await runWaypoint(dequeue());
  await runDreamingPhase();  // 每个 waypoint 都 dream
}
```

每个 waypoint 都触发一次 dream，导致：
- Dream 频次过高，噪音大于信号（连续产生 5-10 个"add unit tests for X"提案）
- Voyage 内部没有"完成一段工作→反思→继续"的层级感
- 看不出"iteration"是什么，每个 waypoint 都像一次独立迭代

**问题 B: TUI 与 Orchestrator 强耦合在同进程**

当前所有代码跑在单个 Node 进程：
```
┌─ TUI Process ────────────────────┐
│  React/Ink                       │
│  CerebellumOrchestrator          │
│  LLMProvider (undici fetch)      │
│  ToolRegistry + Bash/Git tools   │
└──────────────────────────────────┘
```

这导致：
- LLM fetch 被 abort 时，错误冒泡经过 orchestrator 影响 TUI（17:02 / 17:05 / 17:18 三次 "This operation was aborted" 都是这种链路）
- Orchestrator 抛未捕获异常会拖垮 TUI
- 长时间 voyage（10+ waypoints × 20+ iter）期间 TUI 渲染会被 event loop 阻塞
- 无法独立重启 agent 而不丢失 UI 状态

### 1.2 目标

1. **Iteration 大节点**：把 voyage 内部的一次"工作段+反思"显式化为 Iteration 概念，让演化的层级清晰
2. **进程隔离**：把 orchestrator + LLM + tools 抽到独立进程，TUI 永不因 agent 错误而崩溃
3. **向后兼容**：保留 in-process 模式给测试和 CLI 使用；TUI 默认走 forked 模式

## 2. 核心设计

### 2.1 Iteration 大节点（Phase A）

#### 2.1.1 语义重定义

```
Voyage (顶层)
├── Iteration 1                              ← 新显式边界
│   ├── wakeful    waypoint #1
│   ├── wakeful    waypoint #2
│   ├── wakeful    waypoint #3
│   └── dreaming   single dream pass
├── Iteration 2
│   ├── wakeful    waypoint #4
│   ├── wakeful    waypoint #5
│   └── dreaming
└── voyage-idle (backlog 空)
```

一个 Iteration = 累积 N 个 waypoint 后做一次 dream，N 默认 3，可通过 `ODYSSEUS_DREAM_INTERVAL` env var 配置。

**为什么是 N=3 而不是 1**：当前每个 waypoint 都 dream 一次产生太多噪音（trace 显示平均每 dream 产生 1.5 个低价值"add unit tests"提案）。累积 3 个 waypoint 后反思，能让 dream 看到真正的趋势（"这 3 个 waypoint 都卡在同一个点上"）。

**为什么不是时间窗口（如 5 分钟）**：时间窗口对快速完成的简单 waypoint 不公平（3 个简单 waypoint 可能只要 30 秒）。

**剩余 waypoint 不足 N 时**：最后一次 iteration 可能少于 N 个 waypoint —— 当 backlog 在 iteration 中途空了，立即触发 dream 然后结束 iteration（保留反思的完整性）。

#### 2.1.2 新增事件

```typescript
// src/orchestrator/events.ts (扩展)
| {
    type: 'iteration-started';
    iterationId: string;          // it_<12 hex>
    voyageId: string;
    index: number;                // 0-based
    ts: number;
  }
| {
    type: 'iteration-completed';
    iterationId: string;
    voyageId: string;
    waypointsCompleted: number;   // 实际完成的 waypoint 数
    dreamRan: boolean;
    durationMs: number;
    outcome: 'completed' | 'interrupted';
    ts: number;
  }
```

#### 2.1.3 状态机不变

`BrainState` 状态机 (`idle → wakeful → dreaming → reflecting → consolidating → wakeful/idle`) 不需要改 —— 它已经表达了正确的语义。Iteration 只是把 voyage 内部循环的边界显式化。

### 2.2 AgentBackend 接口抽象（Phase B）

```typescript
// src/orchestrator/agent-backend.ts (新建)
export interface AgentBackend extends EventEmitter {
  runVoyage(input?: {
    seedGoal?: string;
    maxWaypoints?: number;
  }): Promise<RunVoyageResult>;

  approve(waypointId: string): void;
  reject(waypointId: string, reason: string): void;
  injectMessage(content: string): void;
  interrupt(reason?: string): void;

  getBrainState(): BrainState;

  on(event: 'event', listener: (e: OrchestratorEvent) => void): this;
  on(event: 'exit', listener: (info: { code: number; reason: string }) => void): this;
}
```

`CerebellumOrchestrator` 实现这个接口（已有方法都匹配，只需 `implements AgentBackend`）。

TUI 所有地方把 `orch: CerebellumOrchestrator` 改为 `orch: AgentBackend`。

### 2.3 ForkedProcessBackend（Phase C）

#### 2.3.1 进程拓扑

```
┌─ TUI Process (main) ──────────────┐
│  React/Ink rendering              │
│  User input + Chat mode           │
│  Idle detector                    │
│  AgentBackend = ForkedProcess...  │
│                                    │
│  on('event', e => render(e))      │
│  on('exit',  info => showError)   │
└────────┬───────────────────────────┘
         │ Node IPC channel (fork)
         │ JSON.stringify-able messages
┌────────▼───────────────────────────┐
│ Agent Process (child)               │
│  CerebellumOrchestrator             │
│  LLMProvider (undici fetch)         │
│  ToolRegistry + Bash/Git tools      │
│  Voyage / Iteration                 │
│                                     │
│  process.on('message', cmd => ...)  │
│  process.send({ kind: 'event', ... })│
└─────────────────────────────────────┘
```

#### 2.3.2 IPC 消息协议

**TUI → Agent (command)**:
```typescript
type TuiToAgentMessage =
  | { kind: 'run-voyage'; requestId: string; seedGoal?: string; maxWaypoints?: number }
  | { kind: 'approve'; waypointId: string }
  | { kind: 'reject'; waypointId: string; reason: string }
  | { kind: 'inject-message'; content: string }
  | { kind: 'interrupt'; reason?: string }
  | { kind: 'ping' };  // 健康检查
```

**Agent → TUI (event/reply)**:
```typescript
type AgentToTuiMessage =
  | { kind: 'event'; event: OrchestratorEvent }
  | { kind: 'run-voyage-result'; requestId: string; result: RunVoyageResult | { error: string } }
  | { kind: 'pong' }
  | { kind: 'fatal'; error: string; stack?: string };  // 未捕获异常
```

所有消息必须 `JSON.stringify`-able。`OrchestratorEvent` 已经是 plain object（无函数/Date/类实例），满足约束。

#### 2.3.3 配置

新增 env var:
- `ODYSSEUS_AGENT_MODE=in-process|forked`（默认 `forked` 用于 TUI；`in-process` 用于测试和 CLI）
- `ODYSSEUS_DREAM_INTERVAL=3`（一个 iteration 累积多少 waypoint 后 dream）

#### 2.3.4 子进程崩溃恢复

子进程 `'exit'` 事件 → ForkedProcessBackend emit `'exit'` → TUI 显示错误面板：
```
┌─ Agent process exited ───────────────┐
│ Code: 1                                │
│ Reason: uncaught exception in dreamer  │
│                                        │
│ Backlog and memory are safe on disk.   │
│ [R] Restart agent   [Q] Quit           │
└────────────────────────────────────────┘
```

按 `R` → ForkedProcessBackend 重新 fork 子进程 → 子进程从磁盘读 backlog/memory/trace → 继续工作。

## 3. 实施阶段

### Phase A: Iteration 大节点（task #74）

修改文件：
- `src/orchestrator/events.ts` — 新增 iteration-started/iteration-completed 事件
- `src/cerebellum/orchestrator.ts` ⚠️ sacred file — runVoyage 重构：内部抽出 runIteration 私有方法；dream 触发条件改为"累积 N waypoint"
- `tests/unit/voyage-loop.test.ts` — 加 iteration 事件断言；dream 频次断言改为"N waypoint 后 1 次"

### Phase B: AgentBackend 接口（task #75）

修改文件：
- `src/orchestrator/agent-backend.ts` (新建) — 接口定义
- `src/cerebellum/orchestrator.ts` — `implements AgentBackend`
- `src/tui/app.tsx` — `orch: AgentBackend`
- `src/tui/hooks.ts` — 同上
- `src/index.ts` — 工厂函数选择 in-process vs forked

### Phase C: ForkedProcessBackend（task #76 + #77）

新建文件：
- `src/orchestrator/agent-main.ts` — 子进程入口
- `src/orchestrator/forked-process-backend.ts` — 主进程 client
- `src/orchestrator/ipc-protocol.ts` — 消息类型定义
- `tests/unit/forked-process-backend.test.ts` — 端到端集成测试

修改文件：
- `src/index.ts` — 根据 env var 选 backend
- `src/tui/app.tsx` — 处理 `'exit'` 事件，显示错误面板

## 4. 关键设计决策

### 4.1 为什么 dream 触发条件用"累积 N waypoint"而不是"backlog 长度"

Backlog 长度不反映"做了多少工作"。5 个 user goal 进 backlog → 做掉 1 个 → backlog 还剩 4 → 看起来"还有很多要做"，但其实只完成了一个 waypoint，没什么可反思的。

累积 waypoint 数直接对应"实际做了多少工作"。

### 4.2 为什么 IPC 用 `child_process.fork()` 而不是 `worker_threads`

1. **崩溃隔离**：worker 抛未捕获异常仍可能影响主进程（特别是涉及 shared memory 时）；forked process 完全独立
2. **Node-only 项目无需跨语言**：fork 的 IPC channel 足够
3. **stdio 隔离**：子进程 stdout/stderr 可独立路由（用于 debug 日志），不会污染 TUI 的 ink 输出
4. **重启更干净**：worker 重启涉及 thread state；process 重启就是新 fork，状态从磁盘恢复

### 4.3 为什么保留 InProcessBackend

测试环境需要：
- vitest 单元测试要直接调 orchestrator 方法验证状态
- CLI 模式（`odysseus <request>`）一次调用没必要起子进程
- ForkedProcessBackend 的 IPC 测试更复杂，InProcessBackend 是基础参照

### 4.4 为什么不把 LLMProvider 也跨进程

LLMProvider 本来就在 agent 进程里。当前问题是 TUI 跟 LLM 共享 event loop（chat mode 直接调 `provider.complete()`）。

新设计后：
- Chat mode（TUI 直接对话）→ 仍然在 TUI 进程调 provider（chat 不经过 orchestrator）
- Goal/Voyage → 通过 IPC 给 agent 进程，agent 进程里的 provider 调用

这意味着 TUI 和 agent 各自持有一个 LLMProvider 实例。两套实例的 token 消耗分别计。

## 5. 测试策略

### 5.1 Phase A 测试

- `voyage-loop.test.ts` 新增：
  - "voyage with 5 user goals triggers 1 iteration with 3+2 waypoints and 2 dreams"
  - "ODYSSEUS_DREAM_INTERVAL=1 preserves current behavior (1 waypoint per dream)"
  - "iteration-started / iteration-completed events fire in correct order"
- 现有测试：调整 dream 频次断言

### 5.2 Phase B 测试

- 现有所有测试不需要改（InProcessBackend 行为 == 之前的 CerebellumOrchestrator）
- 新增 `agent-backend-contract.test.ts`：验证 CerebellumOrchestrator 满足接口

### 5.3 Phase C 测试

- `forked-process-backend.test.ts`：
  - "fork + run-voyage + receive events end-to-end"
  - "child crash emits 'exit' event with code and reason"
  - "restart agent after crash re-reads backlog from disk"
  - "interrupt during waypoint propagates and child survives"

## 6. 风险

### 6.1 Sacred file 修改

`src/cerebellum/orchestrator.ts` 是 sacred file（CLAUDE.md），修改需要人工 review。Phase A 和 B 都触及此文件。

**缓解**：所有 orchestrator 改动单独提交，commit message 注明 "SACRED: requires manual review"。改完后暂停，等用户 review 再做 Phase C。

### 6.2 IPC 序列化边界

`OrchestratorEvent` 必须可序列化。当前定义看起来都是 plain object，但需要审计 `args: unknown`（tool-call-started）和 `result: unknown`（tool-call-completed）字段 —— 工具返回值可能是对象、字符串、错误对象等。

**缓解**：在 IPC 桥接层做 JSON 安全序列化（JSON.stringify + revive），失败时降级为 `{ error: 'non-serializable' }`。

### 6.3 测试时间

Forked process 测试每个 case 需要 fork + teardown，比单元测试慢 ~5x。vitest 默认 5s timeout 可能够，但需要测一次确认。

**缓解**：forked 测试单独 suite，跟单元测试隔离；CI 可并行。

### 6.4 用户行为变更

之前每次 waypoint 都 dream → 现在 3 个 waypoint 才 dream → 用户感觉"agent 反应变慢了"。

**缓解**：`ODYSSEUS_DREAM_INTERVAL=1` 可以恢复旧行为。文档说明权衡。

## 7. 开放问题（待用户 review 时确定）

1. **Dream 触发阈值默认值**：spec 建议默认 3，可配置。你是否接受默认 3？还是 2 / 5？
2. **Chat mode 的 provider 归属**：当前 chat 直接在 TUI 调 provider。新设计后是否保持？还是 chat 也走 agent 进程（更纯粹但 IPC 开销）？
3. **子进程重启后是否自动恢复 voyage**：spec 建议手动按 R。是否需要 idle 时自动重启？

## 8. 不在范围内

以下问题这次不做，留作后续：
- 多 agent 并发（多个子进程同时跑 voyage）
- 跨机器 agent 分布式
- LLM token budget 共享（TUI chat 和 agent voyage 各自计费）
- Iteration 大节点的持久化（trace.jsonl 暂不增加 iteration_id 字段）
