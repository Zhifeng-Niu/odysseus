---
title: 符号主义 AI · Symbolic AI (GOFAI)
type: concept
phase: 7
tags: [symbolic-ai, gofai, expert-systems, logic, lisp]
created: 2026-07-21
language: zh-CN
---

# 符号主义 AI · Symbolic AI (GOFAI)

> **学习目标 / Learning Objectives**
> - 理解符号 AI 的核心假设: "智能 = 物理符号系统" / Understand core assumption: "intelligence = physical symbol system"
> - 掌握专家系统的架构与失败原因 / Master expert system architecture and why they failed
> - 看到 LLM 与符号 AI 的根本差异 / See fundamental differences between LLMs and symbolic AI

## 起源 / Origins

### 达特茅斯会议 Dartmouth Conference (1956)

**1956 夏, 达特茅斯学院**: John McCarthy, Marvin Minsky, Claude Shannon, Nathaniel Rochester 邀请 10 位研究者开 2 个月研讨会.

**会议提案 Proposal** (1955 写成):
> "Every aspect of learning or any other feature of intelligence can in principle be so precisely described that a machine can be made to simulate it."

**术语 "Artificial Intelligence"** 在这次会议正式确立.

**核心假设 Core Assumption**: 智能可以**精确描述为符号操作**.

### 物理符号系统假设 Physical Symbol System Hypothesis (Newell & Simon 1976)

**Newell & Simon 1976 ACM Turing Award 演讲**:

> "A physical symbol system has the necessary and sufficient means for general intelligent action."

**物理符号系统 PSS**: 一个系统可以**符号 symbols**、**表达式 expressions**(符号结构)、**操作 processes**(创建、修改、复制、销毁)的处理系统.

**论断 Claim**: PSS 是智能的**充要条件**.即:
1. 任何 PSS 都能展现智能(充分)
2. 任何智能系统都是 PSS(必要)

**影响 Impact**: 这是符号 AI 的**信条**.确立了 30 年研究方向.

**当代批判 Modern critique**: 论断的"必要性"部分(人类智能必然是 PSS)被神经科学挑战——大脑不只是操作符号,还有连续动力学、情感、具身经验.

## 主要成就 / Major Achievements

### 通用问题求解器 General Problem Solver (GPS, 1957)

**Newell & Simon 1957**: 程序通过**手段-目的分析 means-ends analysis** 求解问题.

**思路**: 把当前状态与目标比较,找差异,选能减小差异的操作.

**贡献 Contribution**: 启发了启发式搜索,影响了 Soar、ACT-R 等认知架构.

### LISP 语言 (1958)

**McCarthy 1958 发明 LISP** (LISt Processor).

**核心特性 Features**:
- 代码 = 数据(同象性 homoiconicity)
- 函数是一等公民(函数式编程)
- 自动垃圾回收(第一个有 GC 的语言)
- 动态类型

**影响**: LISP 是 AI 的"母语" 30 年.后来分化为 Common LISP、Scheme、Clojure.Emacs、AutoCAD、Reddit 早期版都用 LISP.

### 专家系统 Expert Systems (1970s-1980s)

**架构 Architecture**:
```
[用户 User]
   ↓
[自然语言接口 NL interface]
   ↓
[推理引擎 Inference Engine] ←→ [知识库 Knowledge Base]
   ↓                            (规则 rules + 事实 facts)
[解释器 Explanation System]
```

**关键 Inference**: 前向链 forward chaining(从事实推结论)、反向链 backward chaining(从假设找证据).

**经典系统 Classic Systems**:

| 系统 System | 领域 Domain | 年代 Year | 影响力 Impact |
|----|----|----|----|
| **SHRDLU** | 积木世界 blocks | 1970 | 自然语言对话,受限世界 |
| **MYCIN** | 细菌感染诊断 | 1976 | 医学诊断,准确率超人类 |
| **DENDRAL** | 化学结构 | 1969 | 第一个实用专家系统 |
| **XCON** | DEC VAX 配置 | 1980 | 商业成功,年省 $40M |
| **PROSPECTOR** | 矿物勘探 | 1976** | 发现了一座价值 $100M 钼矿 |

### Prolog 语言 (1972)

**Alain Colmerauer 1972 发明 Prolog** (PROgramming in LOGic).

**特点**: 用一阶逻辑写程序,内置回溯、统一(unification).

**用途**: 日本第五代计算机计划用 Prolog 作为核心语言.

### 知识表示 Knowledge Representation

符号 AI 发明多种知识表示:
- **语义网络 Semantic Network** (Quillian 1968)
- **框架 Frames** (Minsky 1974)
- **脚本 Scripts** (Schank 1977)
- **本体 Ontology** (Gruber 1993)
- **描述逻辑 Description Logic** → 后来变成 OWL/Semantic Web

## 符号 AI 的失败 / Why Symbolic AI Failed

### 1987 LISP 机市场崩溃

Symbolics、LMI 等 LISP 专用硬件公司相继破产,被通用 PC 击溃.

### 专家系统的扩展性问题 Scalability

**问题 Problems**:
1. **规则爆炸 rule explosion**: 系统越复杂,规则越多,冲突越多
2. **脆弱 brittleness**: 遇到训练外情况立刻失败
3. **知识获取瓶颈 knowledge acquisition**: 把专家知识翻译成规则耗时且不完整
4. **无学习能力 no learning**: 系统不能从数据中改进

**例 Example**: XCON (DEC 配置系统) 到 1988 有 **10,000+ 条规则**.维护成本巨大.

### Lighthill Report (1973)

**Sir James Lighthill** 受英国 SRC 委托评估 AI 研究.报告结论:

> "AI has not delivered on its promises... in no part of the field have the discoveries made so far produced the major impact that was then promised."

**影响**: 英国 AI 经费大幅削减,第一次 AI 寒冬开始.

### 日本第五代计算机 (1982-1992)

**目标 Goal**: 10 年,$850M,造出能与人对话、翻译、推理的 Prolog 并行机.

**结果 Result**: **彻底失败**.1992 项目终止,没有任何突破性产物.

**深层原因 Deep cause**: 符号 AI 的范式本身有局限,不是工程问题.

## 当代遗产 / Modern Legacy

符号 AI **没有死**.它的思想在很多地方延续:

### 1. 知识图谱 Knowledge Graphs

Google Knowledge Graph (2012)、Wikidata、DBpedia.用三元组 (subject, predicate, object) 表示事实.LLM 的 RAG 系统用知识图谱.

### 2. 形式化验证 Formal Verification

Coq、Lean、Isabelle.数学证明、软件验证.2024 AI 用 Lean 辅助数学证明(DeepMind AlphaProof).

### 3. 符号-神经混合 Neuro-Symbolic AI

主流方向之一: 用 LLM 学习感知,用符号系统推理.如 IBM Neuro-Symbolic、MIT-IBM Watson AI Lab.

### 4. 自动规划 Automated Planning

NASA 火星车路径规划、物流调度,仍是符号方法(STRIPS, PDDL).

### 5. Cyc 项目

Douglas Lenat 1984 开始的 Cyc,试图手工编码**所有常识**.30 年 ~200 万规则.2023 转向用 LLM 增强.失败的雄心,但**思想值得反思**.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 是"反向"符号 AI**
   符号 AI: 手工写规则,机器执行.**没有学习**.
   LLM: 从数据学习,自动产生"软规则".**没显式规则**.
   两者是光谱的两端.
   > Symbolic AI: hand-written rules, no learning. LLM: learned, no explicit rules. Two ends of a spectrum.

2. **神经-符号混合: 未来方向之一**
   LLM 擅长感知(语言、视觉)、模式匹配.符号 AI 擅长精确推理、知识表示.**结合**是未来方向之一.例: 用 LLM 把 NL 翻译为逻辑公式,用 SAT 求解器推理.
   > Neuro-symbolic: LLM for perception/pattern, symbolic for precise reasoning. Combine for future.

3. **符号 AI 的"知识" vs LLM 的"知识"**
   符号 AI 的知识: 显式、可解释、可信,但**不完整**.
   LLM 的知识: 隐式、不可解释、可能幻觉,但**覆盖广**.
   两者**互补**,不应该单独追求一个.
   > Symbolic: explicit, interpretable, but incomplete. LLM: implicit, hallucinated, but wide. Complementary.

4. **范式思考**: "智能 = 笩号操作"对吗?
   Newell-Simon 论断的"充分性"部分可能对(任何 PSS 都能展现智能)."必要性"部分(智能**必须**是 PSS)被现代神经科学挑战.
   现代主流观点: **智能可能涉及多种机制**,符号操作是其中之一,但不是全部.
   > PSS "sufficiency" may hold; "necessity" disputed. Modern view: intelligence may involve multiple mechanisms, not just symbol manipulation.

## 关键问题 / Questions

1. Newell-Simon 物理符号系统假设的"必要性"部分错在哪? / What's wrong with PSS's "necessity"?
2. 专家系统的"知识获取瓶颈"用 LLM 能解决吗? / Can LLMs solve expert systems' knowledge acquisition bottleneck?
3. Cyc 项目 30 年的失败告诉我们什么? / What does Cyc's 30-year failure teach us?
4. 神经-符号 AI 是真正的未来,还是过渡方案? / Is neuro-symbolic the future, or a transition?

## 推荐资源 / Resources

- 书 / Book: Pamela McCorduck *Machines Who Think* (1979, 2004 修订) — 早期 AI 史 / Early AI history
- 书 / Book: Howard Gardner *The Mind's New Way* — 认知革命史 / Cognitive revolution history
- 论文 / Paper: Newell & Simon (1976) *Computer Science as Empirical Inquiry*
- 视频 / Video: **Marvin Minsky "Society of Mind"** 讲座

---

参见 / See also: [[perceptron]], [[connectionism]], [[deep-learning-winter]]
