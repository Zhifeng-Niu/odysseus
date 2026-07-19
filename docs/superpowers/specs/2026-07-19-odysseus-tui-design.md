# Odysseus TUI v1 Design Spec

**Status:** v1 — 本地自用、能跑通优先（公开发布相关工作推迟到 v2）
**Date:** 2026-07-19
**Author:** 牛志峰 + Claude
**Scope:** Single-package TS ESM project at `/Users/stbz/code/Odysseus`（保持现有 spike 目录结构）

---

## 1. Goal

为当前 Odysseus spike 添加**可交互的终端 UI（TUI）**，本地自用——让自己能舒服地观察和控制 agent：

1. 实时观察 voyage（任务执行）的状态、航点进度、工具调用
2. 在航点边界进行 approve / reject 决策（仅在验证通过后）
3. 中途注入消息或软中断
4. 在非 TTY 环境下（CI、管道）自动降级为纯文本 CLI

视觉上承载**诺兰 2026 年电影《奥德赛》**的史诗美学：庄严、电影感、克制、有重量。

**v1 不是公开发布**——所有"为外部用户做的工作"（npm publish、文档站、示例代码、教程、license 决策、CLI 多命令、配置文件加载、多 provider 实现）都推迟到 v2。当前 spike 自用得起来，v1 的目标只是**让它有 TUI**。

---

## 2. Non-Goals

### v1 明确不做

- ❌ Web UI（本地自用 TUI 够）
- ❌ 跨进程 / 远程协作（同进程 MVP）
- ❌ 工具调用级人工干预（只在航点边界问）
- ❌ 多 voyage 并行标签
- ❌ 完整的电影感动效（v1 只做基础配色 + 必要动画）

### v1 推迟到 v2（"完整可用框架"才需要）

- ❌ **npm publish 准备**（package.json exports 子路径、files 字段、bin 入口、CHANGELOG）
- ❌ **外部文档**（TypeDoc API reference、Getting Started、教程）
- ❌ **示例代码**（examples/）
- ❌ **多 provider 实现**（OpenAI / Anthropic / Gemini）—— GLM 自用够
- ❌ **配置文件加载**（odysseus.config.ts）—— env vars 够
- ❌ **CLI 多命令**（`odysseus init/repl/status`）—— 保留现有 argv 入口 `odysseus <prompt>`
- ❌ **目录重构**（src/* → src/core/*）—— 保持当前结构

---

## 3. Architecture

### 进程拓扑

**同进程**：TUI (Ink + React) 和 Orchestrator 共享同一个 Node.js 进程，通过 EventEmitter 通信。

```
┌─────────────────────────── Node.js Process ────────────────────────────┐
│                                                                         │
│   ┌─────────────────┐         events           ┌─────────────────────┐  │
│   │   Orchestrator  │ ─────────────────────────▶│       TUI (Ink)     │  │
│   │  (Cerebellum)   │                           │   React + Ink       │  │
│   │                 │ ◀─────────────────────────│                     │  │
│   └─────────────────┘         commands          └─────────────────────┘  │
│         │                                                              │
│         │ await                                                        │
│         ▼                                                              │
│   ┌─────────────────┐                                                  │
│   │  PendingApproval│  Map<waypointId, {resolve, reject}>              │
│   │      Map        │                                                  │
│   └─────────────────┘                                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 单向数据流（actor 模型）

- **Orchestrator → UI**：通过事件，单向。UI 永远是被动观察者。
- **UI → Orchestrator**：通过命令方法，单向。UI 永远不直接修改状态。
- **关键约束**：UI 不能读取 Orchestrator 的内部状态字段，只能基于事件重建本地状态。这消除整类竞态条件。

### 进入策略

```typescript
// src/index.ts
async function main() {
  const isTTY = process.stdout.isTTY && process.stdin.isTTY;
  const autoApprove = !isTTY || process.env.ODYSSEUS_AUTO_APPROVE === '1';
  const orchestrator = new Orchestrator({ autoApprove });

  if (isTTY) {
    const { waitUntilExit } = render(<App orchestrator={orchestrator} />);
    await waitUntilExit();
  } else {
    await runCLIMode(orchestrator);  // 保留当前行为
  }
}
```

降级矩阵：

| 环境 | 模式 | 批准策略 |
|------|------|----------|
| TTY（终端） | 完整 TUI | 等待用户键入 `a` / `r` |
| 非 TTY（CI、管道） | 文本 CLI | 全部自动批准 |
| `ODYSSEUS_AUTO_APPROVE=1` | TUI | 全部自动批准（仍显示，但不阻塞） |
| 测试 | Mock 模式 | 注入预设的批准序列 |

---

## 4. Event Contract

`src/orchestrator/events.ts`（新文件）定义事件与命令的可辨识联合。

### OrchestratorEvent（Orchestrator → UI）

```typescript
export type OrchestratorEvent =
  | { type: 'voyage-started'; voyageId: string; prompt: string; ts: number }
  | { type: 'voyage-completed'; voyageId: string; ts: number }
  | { type: 'waypoint-started'; waypointId: string; title: string; ts: number }
  | { type: 'waypoint-iteration'; waypointId: string; iteration: number; ts: number }
  | { type: 'waypoint-awaiting-approval'; waypointId: string; iteration: number; ts: number }
  | { type: 'waypoint-committed'; waypointId: string; sha: string; ts: number }
  | { type: 'waypoint-rolled-back'; waypointId: string; reason: string; ts: number }
  | { type: 'waypoint-failed'; waypointId: string; error: string; ts: number }
  | { type: 'assistant-message'; waypointId: string; content: string; ts: number }
  | { type: 'tool-call-started'; waypointId: string; callId: string; tool: string; args: unknown; ts: number }
  | { type: 'tool-call-completed'; waypointId: string; callId: string; result: unknown; ok: boolean; ts: number }
  | { type: 'verify-started'; waypointId: string; iteration: number; ts: number }
  | { type: 'verify-completed'; waypointId: string; iteration: number; ok: boolean; errors?: string[]; ts: number }
  | { type: 'voyage-interrupted'; voyageId: string; reason: string; ts: number };
```

### 错误类型（src/orchestrator/errors.ts）

```typescript
export class InterruptedError extends Error {
  constructor(public reason: string) {
    super(`Voyage interrupted: ${reason}`);
    this.name = 'InterruptedError';
  }
}

export class RejectedError extends Error {
  constructor(public waypointId: string, public reason: string) {
    super(`Waypoint ${waypointId} rejected: ${reason}`);
    this.name = 'RejectedError';
  }
}
```

> 当 UI 调用 `interrupt()` 时，`runWaypoint` 抛出 `InterruptedError`；调用 `reject()` 时抛出 `RejectedError`。这允许上层（`runVoyage`）通过 error 类型区分中断路径。

### OrchestratorCommand（UI → Orchestrator）

```typescript
export type OrchestratorCommand =
  | { type: 'approve-waypoint'; waypointId: string }
  | { type: 'reject-waypoint'; waypointId: string; reason: string }
  | { type: 'inject-message'; content: string }
  | { type: 'interrupt' };
```

---

## 5. State Machine

```
                          ┌────────────────┐
                          │     IDLE       │
                          └──────┬─────────┘
                                 │ voyage-started
                                 ▼
                          ┌────────────────┐
                          │  VOYAGE_RUNNING│
                          └──────┬─────────┘
                                 │ 到达航点边界 + verify pass
                                 ▼
                          ┌────────────────┐
        ┌───── reject ───▶│ AWAIT_APPROVAL │◀─── iteration ──────┐
        │                  └──────┬─────────┘                     │
        │                         │ approve                       │
        ▼                         ▼                               │
┌───────────────┐          ┌────────────────┐                    │
│  INTERRUPTED  │          │  WAYPOINT_DONE │ ─── commit ────────►│
└───────┬───────┘          └──────┬─────────┘                    │
        │                          │ verify fail                  │
        ▼                          ▼                              │
┌───────────────┐          ┌────────────────┐                    │
│  VOYAGE_DONE  │◀─commit──│  ROLLING_BACK  │                    │
└───────────────┘          └────────────────┘                    │
                                                                │
   (next waypoint) ◀─────────────────────────────────────────────┘
```

**关键约束**：

1. 状态转换由 Orchestrator 事件**单向驱动**。UI 永远是观察者。
2. `AWAIT_APPROVAL` 是唯一阻塞状态——此时 UI 接受 `a` / `r` 键输入。
3. `INTERRUPTED` 是软中断——完成当前工具调用后停止，不强制 kill 子进程。
4. 任何状态下用户都可以按 `Ctrl+C` 触发 interrupt，由 Orchestrator 决定何时真正停下。

---

## 6. Visual Theme — Nolan's Odyssey (2026)

### 6.1 色彩（Catppuccin Mocha 衍生）

```typescript
// src/tui/theme.ts
export const colors = {
  // 背景层（从深到浅）
  background:    '#0F0F1A',  // 深海午夜
  surface:       '#1A1A2E',  // 伊萨卡港湾阴影
  surfaceRaised: '#252540',  // 浮起的卡片

  // 文本
  textPrimary:   '#E5E0D3',  // 莎草纸暖白
  textSecondary: '#8B8DA0',  // 风暴灰
  textMuted:     '#5A5C70',  // 远海雾

  // 语义
  waypointAnchor: '#C9A227',  // 金色时刻的琥珀
  success:        '#6C9BCF',  // 爱琴海青蓝
  warning:        '#D4A574',  // 特洛伊青铜
  danger:         '#B85450',  // 暗血色（克制）
  activity:       '#F0E6D2',  // 灯塔光（最强亮度）
} as const;
```

### 6.2 排版

- **航点标题**：serif（Iowan Old Style 优先，回退 Source Serif / Georgia）—— 像电影海报
- **正文 / 工具调用**：等宽（JetBrains Mono 优先，回退 SF Mono / Menlo）
- **数字 / SHA / 路径**：等宽
- **节奏**：4 空格缩进为 1 节拍单位

### 6.3 动画（v1 仅必要项）

| 事件 | 动画 | 时长 |
|------|------|------|
| 航点开始 | 锚点 ⚓ 淡入 + 金色脉冲 | 200ms |
| 工具调用中 | 右侧细线呼吸（opacity 0.4 ↔ 0.7） | 2s 周期 |
| 等待批准 | 整条航点轻微闪烁 | 1s 周期 |
| 提交成功 | 短暂的青蓝色高亮 | 300ms |
| 回滚 | 航点向左**滑出**（非消失） | 200ms |

### 6.4 拒绝清单

- ❌ 彩虹 / 霓虹色（违反庄严）
- ❌ 旋转 spinner（太现代）
- ❌ 大量 emoji（除 ⚓ ◆ ✓ ✗ ◐ ⏵ 之外不用）
- ❌ 卡通图标、像素艺术
- ❌ 渐变背景

### 6.5 v2 推迟的视觉效果

- 迭代历史的"时间交错叠影"（诺兰标志）—— 上一轮失败以半透明叠影保留
- 完整的电影感动效（呼吸、震颤、滑出）
- 金色时刻的微妙渐变

---

## 7. TUI Component Structure

### 7.1 布局（垂直）

```
┌──────────────────────────────────────────────────────────┐
│  ODYSSEUS                          voyage #042 · 03:42   │ ← Header (固定)
│  ──────────────────────────────────────────────────────  │
├──────────────────────────────────────────────────────────┤
│  ⚓ WP1  refactor: events.ts                              │
│  │  ✓ iteration 1 · 3 tool calls                         │
│  │  ✓ verify: 0 errors                                   │
│  │  ◆ committed · 4a2f1c                                 │
│  │                                                       │
│  ⚓ WP2  feat: OrchestratorEventEmitter                  │ ← Voyage Timeline
│  │  ◐ iteration 2 · await approval                       │   (主滚动区)
│  │  ╰─ ⏵ Edit orchestrator.ts (sacred, manual review)    │
│  │                                                       │
│  ┌─ assistant ─────────────────────────────────────┐    │
│  │ I'll need to refactor the orchestrator to emit   │    │ ← Conversation
│  │ events at each state transition...               │    │   (穿插)
│  └──────────────────────────────────────────────────┘    │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [a]pprove  [r]eject  [i]nject  [Ctrl+C] interrupt       │ ← Footer
└──────────────────────────────────────────────────────────┘
```

### 7.2 文件树（每个文件 < 300 LOC）

```
src/
├── tui/                          # 新增
│   ├── index.tsx                 # 入口：渲染 <App/>，挂载 EventEmitter 监听
│   ├── app.tsx                   # 顶层布局 + 状态机 reducer
│   ├── header.tsx                # voyage 编号、计时、当前 WP 摘要
│   ├── voyage-timeline.tsx       # 垂直时间轴（航点列表）
│   ├── waypoint-item.tsx         # 单个航点条目（状态图标 + 详情折叠）
│   ├── tool-call-line.tsx        # 单个工具调用行（图标 + 命令 + 状态）
│   ├── conversation-message.tsx  # assistant 消息（穿插在 timeline）
│   ├── input-area.tsx            # 多行输入 + 命令历史
│   ├── footer.tsx                # 上下文键绑定提示
│   ├── theme.ts                  # 配色 + 字体常量
│   └── hooks/
│       ├── use-orchestrator.ts   # 订阅 EventEmitter，转换为 React state
│       └── use-keybindings.ts    # 状态感知的键绑定
├── orchestrator/                 # 新增
│   └── events.ts                 # OrchestratorEvent + OrchestratorCommand 契约
└── cerebellum/
    └── orchestrator.ts           # 修改：extends EventEmitter
```

### 7.3 组件职责

#### `<App>`

- 顶层 reducer：把 `OrchestratorEvent` 流归约为 `UIState`
- 决定当前 mode（voyage running / awaiting approval / interrupted / done）
- 渲染 Header / Timeline / Conversation / Input / Footer

#### `<VoyageTimeline>`

- 渲染航点列表（垂直）
- 折叠超过 N=5 的航点（前 N-1 折叠为摘要，最近 1 个展开）
- 实现虚拟滚动（v1 可以只做截断，v2 做完整虚拟化）

#### `<WaypointItem>`

- 状态图标：`◆` committed / `◐` running / `⚓` awaiting / `✗` failed / `↩` rolled-back
- 标题 + SHA（如有）
- 折叠的迭代历史（点击 / 按 `o` 展开）

#### `<ToolCallLine>`

- 图标：`⏵` running / `✓` done / `✗` failed
- 命令 + 简短参数（路径截断）
- 点击 / 按 `o` 看完整参数和结果

#### `<InputArea>`

- 多行输入（Ink 的 `<TextInput>` 多行版本）
- 命令历史（↑ ↓ 切换）
- 仅在 `AWAIT_APPROVAL` 或 `INTERRUPTED` 状态下激活
- 按 `Enter` 提交，按 `Esc` 取消

#### `<Footer>`

- 根据当前 mode 显示不同的键绑定提示
- 不接受输入，纯展示

---

## 8. Orchestrator Refactor

`src/cerebellum/orchestrator.ts` 是**神圣文件**，编辑需要人工审查。这是必要的重构。

### 8.1 变更摘要

1. `class Orchestrator extends EventEmitter` —— 继承 EventEmitter
2. 构造函数接受 `{ autoApprove?: boolean }`
3. `runWaypoint(input: WaypointInput): Promise<WaypointResult>` 签名**不变**
4. 在每个状态转换点 emit 事件
5. 在航点边界（verify pass 后、commit 前）：如果 `!autoApprove`，emit `waypoint-awaiting-approval` 并 `await waitForApproval()`
6. 新增 `approve(waypointId)` / `reject(waypointId, reason)` 方法供 UI 调用
7. 新增 `injectMessage(content)` / `interrupt()` 方法

### 8.2 等待批准的实现

```typescript
private pendingApprovals = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();

private waitForApproval(waypointId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    this.pendingApprovals.set(waypointId, { resolve, reject });
  });
}

approve(waypointId: string): void {
  const p = this.pendingApprovals.get(waypointId);
  if (!p) return;
  p.resolve();
  this.pendingApprovals.delete(waypointId);
}

reject(waypointId: string, reason: string): void {
  const p = this.pendingApprovals.get(waypointId);
  if (!p) return;
  p.reject(new Error(`User rejected: ${reason}`));
  this.pendingApprovals.delete(waypointId);
}
```

### 8.3 关键陷阱

**Pending Promise 泄漏**：如果 voyage 在 `AWAIT_APPROVAL` 状态下被中断（用户按 Ctrl+C），必须 reject 所有 pending Promise，否则 `runWaypoint` 永远不返回。

```typescript
private rejectAllPending(reason: string): void {
  for (const [, p] of this.pendingApprovals) {
    p.reject(new Error(reason));
  }
  this.pendingApprovals.clear();
}
```

### 8.4 测试策略

- **现有测试保留**：`autoApprove: true` 模式下（测试中显式传入），行为必须与当前完全一致。用现有测试套件验证。测试默认不应依赖 `process.stdout.isTTY`——显式传 `{ autoApprove: true }`。
- **新增事件序列测试**：模拟 `approve` / `reject` 调用，断言 emit 的事件顺序符合契约。
- **新增中断测试**：在 `AWAIT_APPROVAL` 状态调用 `interrupt()`，断言 `runWaypoint` 抛出 `InterruptedError`。
- **覆盖率目标**：≥ 80%。

---

## 9. MVP Scope

### 9.1 v1（本次交付）

- [ ] `src/orchestrator/events.ts` 事件契约
- [ ] Orchestrator EventEmitter 重构（autoApprove 默认 `!process.stdout.isTTY`）
- [ ] 现有测试套件通过（autoApprove 模式回归）
- [ ] `src/tui/` 完整组件树
- [ ] TTY 检测 + 进入策略
- [ ] 基础 Catppuccin 配色（无动画）
- [ ] 键绑定：`a` approve / `r` reject / `i` inject / `Ctrl+C` interrupt
- [ ] 端到端冒烟测试：启动 → 第一个航点 → 等待批准 → approve → 提交

### 9.2 v2 推迟（"完整可用框架"才做）

**TUI 增强**：
- 迭代历史的"时间交错叠影"动画
- 完整的电影感动效
- 多 voyage 标签
- 滚动回看（搜索、过滤）
- 命令面板（Cmd+K 风格）
- 主题切换（亮色 / 暗色 / 高对比度）

**公开发布相关工作**（v1 自用不需要）：
- npm publish 准备（package.json exports、bin、files、CHANGELOG）
- 外部文档（TypeDoc API reference、Getting Started、教程）
- 示例代码（examples/）
- 多 provider 实现（OpenAI / Anthropic / Gemini）
- 配置文件加载（odysseus.config.ts）
- CLI 多命令（`odysseus init/repl/status`）
- 目录重构（src/* → src/core/*）

### 9.3 不做（明确排除）

- Web UI
- 远程协作
- 工具调用级人工干预

### 9.4 实施周期估算

| 阶段 | 工作量 | 内容 |
|------|--------|------|
| 第 1 阶段 | 2-3 天 | 事件契约 + Orchestrator EventEmitter 重构（神圣文件 review） |
| 第 2 阶段 | 3-4 天 | TUI 组件树实现（按 §7）+ Catppuccin 配色 |
| 第 3 阶段 | 1-2 天 | 键绑定 + TTY 检测 + 端到端冒烟测试 |
| **合计** | **1-2 周** | 自用能跑通 |

---

## 10. Dependencies

新增 npm 依赖：

```json
{
  "dependencies": {
    "ink": "^5.0.0",
    "react": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0"
  }
}
```

> Ink 5.x 自带 TypeScript 类型，无需 `@types/ink`。

约束：
- 仅在 `src/tui/` 下引入 React
- 其他模块保持纯 TS，无 React 污染
- ESM imports 使用 `.js` 扩展名（项目约束）

---

## 11. Risks & Mitigations

| 风险 | 缓解 |
|------|------|
| Orchestrator 重构破坏现有测试 | `autoApprove: true` 模式必须保持行为不变，用现有套件作为回归 |
| Ink + React 增加 bundle 大小 | 仅在 TUI 路径引入；CLI 模式（非 TTY）不加载 |
| Pending Promise 泄漏 | `rejectAllPending()` 在 voyage 中断 / Orchestrator 析构时调用 |
| Ink 长列表渲染性能 | 截断 + 折叠（v1），完整虚拟化（v2） |
| 神圣文件修改被拒绝 | 本规范需人工 review 后才进入实施 |

---

## 12. Open Questions

（在 spec review 时确认）

1. **事件持久化**：是否需要把 `OrchestratorEvent` 流写到 `trace.jsonl`？目前已有 `src/trace/`，可作为可观测性补充。
2. **历史 voyage 切换**：v1 是否支持查看之前 voyage 的事件回放？（建议推迟到 v2）
3. **中断后恢复**：用户 interrupt 后能否 resume？（建议 v1 只支持 abort，不支持 resume）

---

## 13. Acceptance Criteria

- [ ] `npm test` 通过（含新增事件测试）
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] 启动 `npm run dev` 在终端显示 TUI
- [ ] 在 `AWAIT_APPROVAL` 状态下按 `a`，航点提交
- [ ] 按 `r`，航点回滚
- [ ] 按 `Ctrl+C` 软中断
- [ ] 非 TTY 模式（`npm run dev | cat`）自动降级为 CLI 输出
- [ ] 现有 cerebellum 测试套件全部通过

---

**End of Spec**
