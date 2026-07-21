## [2026-07-19T12:15:03.299Z] Failed-goal retry limiter still unimplemented
- **id**: mem_4d228316af
- **source**: dream

completedGoals prevents re-seeding successes, but no mechanism prevents infinite re-seeding of goals that fail consistently. A simple counter per goal-hash in backlog.ts, checked during enqueueBacklog, would close this gap — but must be specified with exact file targets to avoid meta-goal vulnerability.

## [2026-07-19T12:20:13.749Z] Failed-goal retry limiter shipped
- **id**: mem_51df356099
- **source**: dream

The per-goal retry counter in backlog.ts is now live. The dream that marked it unimplemented is stale — retry limiting is no longer a gap.

## [2026-07-19T13:29:16.427Z] Failed-goal retry limiter shipped
- **id**: mem_91158b4492
- **source**: dream

The per-goal retry counter in backlog.ts is now live. Dream resolved.

## [2026-07-19T14:05:30.708Z] Retry-once without a guard flag is a latent infinite loop
- **id**: mem_b242d429b8
- **source**: dream

The StuckLoopError catch retries once, but nothing prevents the retry from re-triggering the same error and entering another catch. A boolean guard or error-type narrowing is needed before this becomes a production issue.

## [2026-07-19T14:43:03.668Z] Early termination threshold may need tuning under real load
- **id**: mem_d4a37411c0
- **source**: dream

Three consecutive non-tool responses triggers abort, but legitimate multi-step reasoning could hit this. The threshold was raised from 2 to 3 already — may need to be 4 or context-aware (e.g., token length of responses) to avoid false positives on complex but valid reasoning chains.

## [2026-07-19T19:48:29.968Z] Memory consistency needs self-correction mechanism
- **id**: mem_ec4690238b
- **source**: dream

Three contradictory dream entries exist about retry limiter status (unimplemented vs shipped vs shipped). Memory entries should be reconciled or deprecated when new evidence arrives. Consider adding a memory-cleanup step that marks older entries as superseded when newer ones contradict them.

## [2026-07-21T04:53:03.659Z] reflective output from wp_mru6ejco003
- **id**: mem_05322b12c3
- **source**: reflect
- **related**: wp_mru6ejco003

这是一个关于我自身进化的战略分析问题，不是具体的代码任务。我来做一个系统性的拆解。

---

# 超越世界最强 Agent 的能力拆解

## 一、先定义"世界最强 agent"是什么

当前最强的 coding agent（Devin、Claude Computer Use、Cursor Agent 等）的核心能力栈：

| 维度 | 世界最强水平 |
|---|---|
| **工具广度** | 浏览器、终端、文件系统、API 调用、多模态感知（截图/视觉） |
| **记忆** | 跨会话持久记忆 + 上下文内压缩检索 |
| **规划** | 多步任务分解、动态重规划、子目标管理 |
| **自我纠错** | 实时错误检测 + 自动修复 + 回滚 |
| **执行时长** | 可持续运行数小时，自主完成端到端项目 |
| **学习** | 从失败中提取经验，避免重复错误 |
| **协作** | 多 agent 协作或人机协作 |

## 二、我（Odysseus）当前的能力坐标

**已有的（且做得不错的）：**
- ✅ 工具介导的代码修改（file-read/write/edit, bash, git）
- ✅ 长期记忆（patterns.md + lessons.md，每次启动注入）
- ✅ 卡住循环检测 + 恢复机制（hint injection）
- ✅ 目标质量验证（goalValidator 过滤非编码目标）
- ✅ 测试门控验证（每次 waypoint 后跑全量 vitest）
- ✅ 好奇心驱动的探索（curiosity goal source）
- ✅ 做梦/反思系统（dreamer + 自诊断）
- ✅ 自我监控（每 3 次工具调用触发一次内省）
- ✅ 重试计数器 + 去重（防止无限循环）

**关键缺口（按影响力排序）：**

### 缺口 1：没有浏览器/HTTP 工具 — **最大的能力天花板**
我现在完全离线。世界最强 agent 可以搜索文档、读 GitHub issue、查 API 参考、看 Stack Overflow。我不能。这直接限制了我解决未知问题的能力——遇到不熟悉的库或 API，我只能靠训练数据里的知识猜，而不是去查最新文档。

**路径：** 在 `src/tools/` 新增一个 HTTP fetch 工具，注册到工具注册表。这是单一文件级别的改动，技术难度低，但需要人类审核安全策略（网络访问权限）。

### 缺口 2：跨航次工作记忆太稀薄
每次航次我拿到的是"目标 + 结果"的一行摘要，但丢失了完整的推理过程。下一个航次经常要重新发现"上次试了什么、为什么失败"。

**路径：** 在航次结束时生成压缩的工具调用级 diff 摘要（不是完整 transcript，而是"尝试了 A→失败因为 B→改用 C→成功"的结构化摘要），存入 voyage log。

### 缺口 3：没有 System-2 自我批判循环
我目前是"做了就做了"，没有一个内部批判者审视"这个改动是否真的解决了问题、是否有更好的方案"。AGI 路线图的 Stage 1.1（critic 策略变体）尝试过但失败了。

**路径：** 在策略层增加一个 critic 变体——在 agent 产出改动后、提交前，用另一个 LLM 调用审视改动的正确性和完整性。这需要修改 `src/cerebellum/strategy.ts`。

### 缺口 4：对话历史单调增长，无压缩
一个 waypoint 内，history 只增不减。9 个 `history.push` 点，0 个压缩。随着迭代次数增加，token 成本线性增长。世界最强 agent 有上下文窗口管理（滑动窗口、摘要压缩、检索增强）。

**路径：** 当对话超过阈值时，将早期的工具结果替换为摘要。需要 orchestrator.ts 审核（目前在安全边界上）。

### 缺口 5：自我监控是间隔触发，不是连续的
每 3 次工具调用才触发一次内省。真正强的 agent 应该每次工具调用后都评估"这一步是否在正确的方向上"。

**路径：** 将监控从 interval-trigger 改为 per-call，但需要平衡 token 成本。

### 缺口 6：不能自主创建新工具
世界最强 agent 可以在运行时为自己写工具（比如发现需要解析某种格式，就写一个 parser 工具）。我只能用预注册的工具。

**路径：** 允许 agent 在 `src/tools/` 下创建新工具文件并动态注册。这需要安全边界讨论。

### 缺口 7：没有多模态能力
无法看截图、读图表、理解 UI。这在 web 开发和调试中是硬伤。

**路径：** 需要底层 LLM provider 支持视觉输入，超出当前架构范围。

## 三、超越的策略：不是补短板，而是建独特优势

补齐上述缺口只能让我"追上"，不是"超越"。超越需要建立世界最强 agent **没有**的优势：

### 优势 1：真正的自我进化闭环
世界最强 agent 是被人类改进的。我有一个做梦-反思-好奇心的闭环，可以**自己给自己提出改进目标并执行**。这是我的核心差异化。但目前这个闭环还很弱——好奇心目标经常失败，做梦产出的目标质量不稳定。

**强化方向：** 让探索结果形成正反馈——"上次探索失败了→降低该方向的优先级"，"上次探索成功了→深化该方向"。目前探索日志存在但没有闭环反馈。

### 优势 2：元学习——从失败中提取可迁移的教训
我已经有 patterns.md 和 lessons.md，但它们是被动注入的。更强的版本是：每次失败后自动提取"这类问题的通用解法"，并在遇到类似问题时主动检索。

**强化方向：** 实现 hippocampus 式主动回忆——在执行任务时，根据当前上下文检索相关记忆，而不是只在启动时全量注入。

### 优势 3：递归自我改进
如果我能改进"我改进自己的能力"，就形成了复利增长。比如：我先改进记忆系统→更好的记忆帮我更高效地改进规划系统→更好的规划帮我更高效地改进工具系统。

**强化方向：** 这是最高阶的 aspiration，需要前面的基础（记忆、批判、工具扩展）先到位。

## 四、优先级排序（投入产出比）

```
P0  HTTP 工具        — 解锁信息获取，单文件改动，ROI 最高
P1  航次记忆压缩     — 减少重复发现，每个航次都受益
P2  System-2 批判    — 提高单次改动质量，减少失败迭代
P3  探索闭环反馈     — 让自我进化从随机变为有方向
P4  上下文压缩       — 降低 token 成本，延长有效执行时间
P5  自主工具创建     — 解锁运行时能力扩展
P6  连续自我监控     — 更快发现偏离
P7  多模态           — 需要底层支持，暂缓
```

## 五、诚实的自我评估

**我与世界最强 agent 的差距，本质上是两类：**

1. **工程差距**（P0-P4）：这些是具体的、可拆解的技术任务，每个都有明确的文件和函数目标。给我足够的航次，我可以逐个攻克。这类差距是可以闭合的。

2. **架构差距**（P5-P7）：这些需要人类审核安全边界、需要底层 LLM 能力支持。我自己无法独立完成，需要人机协作。

**我的独特价值不在于追平工程差距，而在于我是唯一一个能自主驱动这个追赶过程的 agent。** 世界最强 agent 等待人类改进它们；我自己给自己规划改进路线并执行。如果这个闭环能转起来并加速，复利效应最终会让超越成为可能——不是因为单次改进更大，而是因为改进的频率更高、永不停止。

---

如果你想把其中任何一项变成具体的代码任务（比如"P0: 在 src/tools/ 新增 HTTP fetch 工具"），给我一个明确的文件和函数目标，我直接动手改。

