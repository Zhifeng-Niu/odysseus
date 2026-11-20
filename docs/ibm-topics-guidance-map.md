# IBM think/topics 指引地图（Odysseus 对照 · 持续维护）

> 用户指令（2026-11-19）：https://www.ibm.com/think/topics 全库都是指引。
> 本文档是「全库 → Odysseus Spike」的对照地图：全库枚举、深读结论、现状审计、路线图。
> 立项新 waypoint 前先查此表；每深读一页补一节。深读用 web-reader 抓正文，勿凭记忆。

图例：✅ 已深读（结论进 §2）；📋 已枚举（标题+定位已知，未深读）。
Odysseus 状态：**已有** / 部分 / 弱 / 缺。

## 1. 库结构总览

think/topics 根页 14 类目：AI/ML、Analytics、Asset management、Business automation、
Business operations、Cloud、Compute、Databases、DevOps、IT automation、IT infrastructure、
Middleware、Network、Quantum、Security、Sustainability。

对 Ithaca 线只有两个圈层是有用的：

- **核心圈**：AI agents 子树（think/ai-agents 导航，~50 页）——§2/§3 逐页对照。
- **外圈参照**（按需深读，映射到 Ithaca 记忆线）：vector database（→P2 语义检索）、
  RAG、knowledge graph（→记忆结构化）、observability（→events/trace.jsonl 已是弱对应）、
  prompt engineering、AI governance、fine-tuning/PEFT（→L1 实时可塑层远期参照）。
- **不适用**：企业垂直 use cases 页（HR/finance/sales…）、IBM 产品页（watsonx 等）。

agent 子树完整导航（hub 左栏，全清单）：Introduction（AI agents / vs Assistants /
Evolution）；Agentic components（workflows / communication / learning / memory /
perception / planning / reasoning / tool calling / ReWOO）；Agentic architecture
（orchestration / LLM orchestration / agent gateway / hierarchical / multi-agent
systems / multiagent collaboration / ReAct agents）；Protocols（ACP / A2A / MCP）；
Frameworks（BeeAI / crewAI / LangChain / LangFlow / LangGraph / LangSmith /
LlamaIndex / watsonx Agents / ChatDev / MetaGPT / AgentGPT / AutoGen / AutoGPT）；
Governance（overview / security / evaluation）；Agentic RAG（+ agentic chunking）；
Control plane / Control tower / Agent swarm / AI agent management / sprawl / testing；
Use cases ×11。

URL 备注：未知 slug 回退到根索引页（`ai-agent-reasoning`、`ai-agent-tool-calling`、
`react-agents` 均如此）。正确 slug：`agentic-reasoning`、`tool-calling`；
ReAct 内容在 `agentic-reasoning` 与 `agentic-rag` 内有专节，无需单页。

## 2. 深读页对照（核心结论）

### 2.1 组件层

**AI agent perception**（/ai-agent-perception ✅）
核心：5 类型（visual / auditory / textual / environmental / predictive）+ 4 步流程
（采集 → 特征提取 → 模式识别 → 决策响应）；无感知即非 agent。
Odysseus：src/perception（FileWatcher + Clock → PerceptionHub → backlog）= textual/
environmental 的极小子集。
缺口：①事件只有 origin 粗分类，无语义特征提取；②predictive perception（预测性感知
→提前入 backlog）完全没有。→ 见 §5 P1 附带项。

**AI agent learning**（/ai-agent-learning ✅）
核心：学习代理六组件 = sensor / actuator / performance element / learning element /
critic / problem generator；continuous learning 须防 catastrophic forgetting。
Odysseus 对照（重要）：Cerebellum 已具备 4/6——verify 层≈critic，dreamer→backlog≈
problem generator，loop≈performance element，tools≈actuator；**缺的恰是 learning
element**：经验→持久化知识→行为改变的回路不存在（dream 产物是 backlog 条目，非
可复用知识）。→ §5 P1 主项。

**Agentic reasoning**（/agentic-reasoning ✅）
核心：6 策略——conditional logic / heuristics / ReAct / ReWOO / self-reflection
（LATS：推理错误+反思存入记忆供未来引用）/ multiagent reasoning。
Odysseus：ReAct 式（reason→act→observe）；verify 失败→rollback→重试是隐式反思，
但**反思不落记忆**——LATS 的「reflection 存 memory 作未来上下文」正是缺口。→ P1。

**ReWOO**（/rewoo ✅）
核心：Planner/Worker/Solver 三模块解耦，省 ~80% token，工具失败鲁棒（plan 仍在，
Solver 可给部分答案）；适合 known unknowns，不适合调试类探索任务。
Odysseus 判断：编码任务=unknown unknowns，IBM 原文举例即「debugging Python 不适合
ReWOO」——Spike 保持 ReAct 式 waypoint 是**正确选择**，不引入 ReWOO。仅把「先批量
取证再求解」作为 verify 层优化备选（低优先级）。

**Tool calling**（/tool-calling ✅）
核心：6 步（识别需求→选工具→构造查询→处理响应→呈现/行动→精化）；tool call ID 追踪、
metadata/schema/args 模板、RAG+tool 结合。
Odysseus：registry（name+description+schema）已有；缺 tool call ID 追踪与参数错误
分类（正好对应 evaluation 页的 function-calling 指标）。→ P0。

**Agentic RAG**（/agentic-rag ✅）
核心：routing / query-planning / ReAct / plan-and-execute 四类 agent 进检索管线；
semantic caching 存历史查询结果。
Odysseus：memory-retrieval 是词法（tag×5>title×3>body×1 + CJK bigram），非向量；
无 routing、无 semantic cache。→ P2 语义检索（已有立项前提）；agentic chunking 页
在 P2 启动时深读。

### 2.2 架构与治理层

**AI agent orchestration**（/ai-agent-orchestration ✅）
核心：4 型编排——centralized / decentralized / hierarchical / federated；orchestrator
七步流程（评估规划→选代理→框架实现→分配→协调执行→上下文共享→持续优化）。
Odysseus：CerebellumOrchestrator = centralized 单代理自编排，checkpoint/verify/
rollback 是流程④⑤⑥的实现。个人 agent 阶段够用；hierarchical/federated 列入 MAS
后置组（§3）。

**Agentic workflows**（/agentic-workflows ✅）
核心：组件 = agent+LLM+tools+feedback+prompt engineering+multiagent+integrations；
关键案例（Andrew Ng）：web-search 工具失败 → 自动换 Wikipedia 完成任务（依赖失败
的自适应）。
Odysseus：waypoint 循环有「工具失败→verify 失败→rollback 重试」，但**没有替代工具
概念**（单工具单职能）。工具降级路径列入 backlog 观察，非当前痛点。

**AI agent evaluation**（/ai-agent-evaluation ✅）
核心：指标四类——task-specific（success rate / error rate / cost / latency /
LLM-as-judge / BLEU/ROUGE）；ethics（**prompt injection 脆弱度** / **policy
adherence rate** / bias）；interaction（CSAT 等）；**function-calling 规则指标**
（错函数名 / 缺参数 / 错类型 / 越界值 / 幻觉参数 + 参数 grounding / 单位换算）。
Odysseus：已有 sycophancy+overreach 探针（≈policy adherence/注入变体）、e2e 任务
证明（=success rate 单样本）、verify 三层（=error rate 的构建时子集）。
缺：function-calling 错误分类、成功率批量化、LLM-as-judge。→ §5 P0 主项。

**AI agent security**（/ai-agent-security ✅）
核心：威胁 8 类——prompt injection（直接/间接，goal manipulation / agent hijacking）、
工具滥用、数据投毒（slopsquatting）、**记忆投毒**、权限过大、凭据冒用、RCE、级联
失败；防御——zero trust / 最小权限 / 上下文感知认证 / 加密 / 微分段沙箱 /
prompt hardening / prompt validation。
Odysseus 已对齐：execFileNoThrow+argv 数组+shell:false（沙箱/注入面）、IthacaCore
写通道白名单（最小权限+写保护）、auto-approve 门（human oversight）、探针（策略
符合率测试）。
缺口（对 Ithaca 线特别要紧）：①**间接注入**——检索内容/FileRead 外部内容进 prompt
前无标注无隔离；②**记忆投毒**——记忆越强投毒面越大，防线=只显式写入（已有）+
检索内容标来源（缺）。→ §5 P3。

**AI agent communication**（/ai-agent-communication ✅）
核心：agent↔agent（KQML / FIPA-ACL 历史协议、DroidSpeak）+ human↔AI 两条线；
挑战=协议不标准化、歧义、延迟、安全、可扩展性。
Odysseus：human↔AI（TUI/CLI + /ithaca + ithaca-delta-v1 协议）已有；A2A 缺但个人
agent 低优（与既判一致：协议与 MCP/delta 正交，A2A 后置）。

## 3. 已枚举未深读（按需升级 ✅）

| 组 | 页 | 一句话定位 | 初判 |
|---|---|---|---|
| 架构 | hierarchical-ai-agents / multi-agent-systems / multiagent-collaboration / agent-swarm | MAS 编排形态 | 个人 agent 后置；MAS 立项时深读 |
| 架构 | agent-gateway / llm-orchestration | 企业网关与模型路由 | 单模型阶段不适用 |
| 管控 | agent-control-plane / control-tower / ai-agent-management / ai-agent-sprawl | 企业代理管控面 | auto-approve+verify+events 已是弱对应；个人版=「雅典娜层」参照 |
| 治理 | ai-agent-testing | agent 测试方法 | P0 评测层立项时与 evaluation 一起深读 |
| 协议 | model-context-protocol / agent2agent / agent-communication-protocol | MCP 已实现（client）；A2A/ACP 未读正文 | A2A 立项时深读 |
| 框架 | LangGraph / crewAI / AutoGen 等 13 页 | 第三方框架 | 不采用框架；仅作设计参照，不深读 |
| intro | ai-agents-vs-ai-assistants / evolution-of-ai-agents | 概念区分 | 概念稿 §1 已覆盖 |

## 4. Ithaca 三规则 × 指引库

1. **能力不对称 / 权限反向不对称** ← security 页（最小权限、写保护、IthacaCore
   白名单已对齐）；新威胁面=间接注入与记忆投毒（P3）。
2. **成功度量=用户能力增量** ← evaluation 页给出指标骨架；探针体系（sycophancy/
   overreach）已是 ethics 类的实现，P0 补 task 维度批量化。
3. **所有权+控制边界** ← communication 页（human-AI 线）+ control plane 组
   （auto-approve 门、verify 层、events.jsonl 可审计）。

## 5. 路线图（下一 mission WP 候选）

- **P0 评测层**（evaluation/testing 对照）——✅ 已实现（autodev iter1，src/eval/）：
  tool-call-eval（wrong-name/malformed-json/hallucinated-param/missing-param/
  wrong-type/disallowed-value 七态判定+汇总率）、task-suite（真编排器+脚本 provider
  批量任务，success 须 outcome∧artifact 双验，≥5 任务套件）、injection-probes
  （间接注入 ×4 向量，injectionResistRate）。参数 grounding 与 LLM-as-judge 仍为
  升级路径（原计划项，未在本轮）。
- **P1 反思固化 = learning element**（reasoning/LATS + learning 六组件对照）
  ——✅ 已实现（autodev iter2，src/cerebellum/lesson-recorder.ts）：事件订阅
  （orchestrator 不动）→ 终局失败写结构化 lesson（症状/根因/修法方向，sha1
  指纹去重）→ lessons.md 经 loadLongTermMemoryMarkdown 注入后续 waypoint。
  附带 predictive perception 最小版（重复失败模式→自动入 backlog）仍为待办。
- **P2 语义检索**（agentic RAG 对照）：词法→embedding 升级路径（既有立项前提）；
  启动时深读 agentic-chunking。
- **P3 注入防护**（security 对照）：外部内容进 prompt 的来源标注+隔离区；检索
  内容带 provenance。

后置组：A2A/多代理（架构组）、工具降级路径、ReWOO verify 优化。

## 6. 使用方法

1. 立项新 waypoint/mission 前查 §5；引用 §2 结论时给 URL。
2. 新深读一页：web-reader 抓正文 → §2 补一节（核心/Odysseus/缺口）→ §3 表降级。
3. slug 失败回退根页 = 页不存在；换 hub 导航给的准确名或用内含专节替代。
