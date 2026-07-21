---
title: 世界模型 · World Models
type: concept
phase: 8
tags: [world-models, lecun-jepa, predictive-coding, embodied-ai]
created: 2026-07-21
language: zh-CN
---

# 世界模型 · World Models

> **学习目标 / Learning Objectives**
> - 区分"伪世界模型"(LLM)和"真世界模型"(JEPA) / Distinguish pseudo (LLM) vs true (JEPA) world models
> - 理解 LeCun 对 LLM 的核心批判 / Understand LeCun's core LLM critique
> - 看到 Friston 主动推断作为另一种世界模型范式 / See Friston's active inference as alternative

## 什么是"世界模型" / What Are "World Models"

**世界模型 World Model**: 一个能**预测世界如何响应行动**的内部表示.

> An internal representation that can **predict how the world responds to actions**.

**核心能力 Core capabilities**:
1. **预测 Prediction**: 给定当前状态和动作,预测下一状态
2. **反事实 Counterfactual**: "如果 X 不同,会怎样"
3. **规划 Planning**: 通过模型搜索最佳行动序列
4. **因果 Causality**: 理解**为什么**事件发生

**关键 Critical**: 这正是 LLM 缺乏的(根据 LeCun).

## LLM 是"世界模型"吗? / Are LLMs World Models?

### 乐观派 Optimists (Sutskever, Hinton)

**主张 Claim**: 是的,LLM 通过预测下一 token **隐式**学了世界模型.

**论点 Arguments**:
1. 要预测"苹果从树上掉下",必须知道重力(物理常识)
2. 要续写"X 杀了 Y 然后",必须理解"死亡"的因果
3. LLM 在多任务上有效,说明它学到**通用**世界知识

**证据 Evidence**:
- LLM 能解释笑话(需要世界知识)
- LLM 能写代码(需要逻辑模型)
- LLM 能玩文字冒险游戏(需要世界状态跟踪)

### 悲观派 Pessimists (LeCun, Pearl, Friston)

**主张 Claim**: 不是,LLM 学到的是**表层统计**,不是世界模型.

**论点 Arguments**:

1. **没有 grounded 表示**: LLM 的"苹果"是嵌入向量,不连接到真实苹果的物理性质.

2. **不能规划**: LLM 不能前瞻 5 步.它生成第一个 token,然后基于这个 token 生成下一个.**没有搜索**.

3. **不能反事实**: 问"如果 Hitler 没出生会怎样",LLM 用统计模式回答,**没有因果推理**.

4. **没有持续学习**: 大脑每秒学习新事,LLM 训练后冻结.

5. **数据效率极低**: LLM 需要万亿 token 学语言.儿童只需几亿词.**差 10000 倍**.

6. **没有具身**: LLM 没有身体,不知道"重力"是什么感觉.

### LeCun 的核心主张 LeCun's Core Claim

**Yann LeCun** (Meta 首席 AI 科学家) 自 2022 起反复主张:

> "LLMs do not have world models. They have a superficial understanding of the world. They cannot plan, reason, or understand causality."

> "Autoregressive LLMs are doomed. They will never reach AGI."

**LeCun 的解决方案 Solution**: **JEPA (Joint-Embedding Predictive Architecture)**.见阶段 9 [[lecun-jepa]].

**核心差异 Core difference**: LeCun 主张 AI 应该学**抽象表示**的预测,不是**像素/token** 的预测.

## 世界模型的层次 / Levels of World Models

```
Level 0: 无世界模型 No World Model
└─ 简单反射 simple reflex (温控器)

Level 1: 弱世界模型 Weak
└─ 表层统计 surface statistics
└─ 例: 当前 LLM (LeCun 主张)

Level 2: 抽象世界模型 Abstract
└─ 学表示 + 在表示空间预测
└─ 例: JEPA (LeCun)

Level 3: 因果世界模型 Causal
└─ 理解干预和反事实
└─ 例: Pearl 的因果推理

Level 4: 具身世界模型 Embodied
└─ 通过身体与世界交互学习
└─ 例: 婴儿学物理常识

Level 5: 意识世界模型 Conscious
└─ 自我觉察 + 反思
└─ 例: 人类高级思维
```

**当前 LLM**: Level 1(争议中).

## 神经科学启发 / Neuroscience Inspiration

### Predictive Coding (Rao & Ballard 1999)

**主张 Claim**: 大脑**持续预测**感觉输入,只处理**误差 prediction error**.

**架构 Architecture**:
```
[高层表示 High-level representation]
        ↓ 预测 prediction
[低层感觉 Low-level sensory]
        ↑ 误差 error
[高层更新 High-level update]
```

**意义 Implication**: 大脑是**预测机器 prediction machine**.不是被动接收,而是主动预测.

### Friston 自由能原理 Free Energy Principle (2010)

**Karl Friston** (神经科学家): 自由能原理.

**核心主张 Core claim**: 大脑最小化"自由能",等价于最小化"预测误差".

```
Free Energy = -log P(sensory input | world model) + KL(model || true world)
```

**意义 Implication**: 所有生命都遵循这一原理.**主动推断 active inference** 是其推论——生命通过**行动** 减少预测误差.

### 与 LLM 的关系 Relation to LLMs

LLM 是**被动预测机器**: 预测下一 token.

主动推断 / 大脑: **主动**行动减少预测误差.

**关键差异 Key difference**: 大脑有**行动 action** 维度,LLM 没有.

## 世界模型的工程实现 / Engineering World Models

### Dreamer 系列 (Hafner et al.)

**Dreamer v1, v2, v3 (2019-2023)**: 在**学到的世界模型**内做 RL.

**架构**:
```
1. 编码器 Encoder: obs → latent z
2. 转移模型 Transition: z_t, a_t → z_{t+1}
3. 奖励预测 Reward: z → reward prediction
4. Actor-Critic 在 latent space 做 RL
```

**意义 Significance**: **样本效率大幅提升**(从环境采样 100M → 100K).

### World Models (Ha & Schmidhuber 2018)

**David Ha & Jürgen Schmidhuber 2018** *World Models*:

**核心思想 Core idea**: 用 VAE 编码世界,MDN-RNN 预测,简单 policy 在"梦境"中训练.

**先驱 Pioneer**: Schmidhuber 1990s 起主张"世界模型 + RL = AGI".30 年坚持.

### SimPLe, Plaac 等

各种 Atari/Atari-like 世界模型变体.

### NVIDIA GR00T, Tesla FSD

机器人/自动驾驶用神经网络 + 物理仿真混合世界模型.

## 具身智能 Embodied AI

### 为什么 LLM 缺"世界知识" / Why LLMs Lack "World Knowledge"

**论证 Argument**:
1. 物理常识(物体恒存、重力、碰撞)需要**身体交互**学习
2. LLM 训练数据是**文本**,文本**不**包含这些常识的物理直觉
3. 所以 LLM 写物理常识**词**对,但**底层理解**缺失

**例 Examples**:
- LLM 知道"球会掉下",但写不出精确物理仿真
- LLM 描述"火会烫",但不知道烫的具体感受
- LLM 写"门要推",但不能控制机械臂推门

### 具身 AI 解决方案 Embodied AI Solutions

1. **机器人 LLM**: RT-2, Google PaLM-E, Tesla Optimus
2. **仿真训练**: Isaac Sim, Habitat, ANCOR
3. **多模态 grounding**: 视觉+语言+动作

**挑战 Challenges**:
- 仿真与现实差异(sim-to-real gap)
- 数据收集昂贵
- 安全性

## 真正的"世界模型" 范式 / True World Model Paradigms

### 范式 1: JEPA (LeCun)

见阶段 9 [[lecun-jepa]].

### 范式 2: 主动推断 (Friston)

见阶段 9 [[friston-active-inference]].

### 范式 3: 因果推理 (Pearl)

见阶段 9 [[pearl-causal]].

### 范式 4: 神经符号 Neuro-Symbolic

混合 LLM + 符号推理.见阶段 9.

### 范式 5: 大规模仿真 + RL

如 Microsoft Flight Simulator 的地球级仿真,在仿真中训练 AI.

## 与 LLM 的连接 / Connection to LLMs

1. **当前 LLM 没有"真世界模型"** (LeCun 立场)
   - 没有反事实推理
   - 没有规划(只生成)
   - 没有持续学习
   - 数据效率极低
   
   这些都是 LLM 的**根本**局限,不是工程问题.

2. **但 LLM 有"足够好"的世界知识** (Sutskever 立场)
   - 能解释物理常识
   - 能编程
   - 能创意写作
   
   这说明"世界模型"不是 0/1,而是**连续谱**.

3. **未来 LLM 可能集成世界模型**
   - LLM + 物理引擎(如 DeepMind Genie)
   - LLM + RL 推理(如 o1)
   - LLM + 具身(机器人)
   
   这种**混合范式** 可能是 AGI 的路径.

4. **范式思考**: 什么是"真世界模型"的判据?
   主观(像人类一样"理解") vs 客观(通过所有测试).
   
   如果通过所有人类测试,**是否就等于** 有世界模型?这是哲学问题.
   
   **实用主义答案 Pragmatic answer**: 不在乎"真"世界模型,在乎**解决问题**.LLM 解决了 90% 问题,剩下 10% 需要新范式.
   > Does passing all human tests = having a world model? Philosophical. Pragmatic: care about solving problems, not "true" models.

## 关键问题 / Questions

1. LLM 学到的"苹果"和人类大脑的"苹果"表示有何不同? / How does LLM's "apple" differ from brain's?
2. LeCun 的 JEPA 真能解决 LLM 的问题吗? / Can JEPA really solve LLM's problems?
3. 大脑的"世界模型" 和 AI 的"世界模型" 是一回事吗? / Are brain's and AI's "world models" the same thing?
4. 如果 LLM + 真世界模型,会变成什么? / What would LLM + true world model look like?

## 推荐资源 / Resources

- 论文 / Paper: LeCun (2022) *A Path Towards Autonomous Machine Intelligence* (JEPA 白皮书 / whitepaper)
- 论文 / Paper: Ha & Schmidhuber (2018) *World Models*
- 论文 / Paper: Hafner et al. (2023) *Dreamer v3*
- 论文 / Paper: Friston (2010) *The free-energy principle*
- 书 / Book: Anil Seth *Being You* — 神经科学视角 / Neuroscience view
- 视频 / Video: **Yann LeCun Lex Fridman Interview** (2022/2024) — LeCun 论 LLM 局限 / LeCun on LLM limits
- 博客 / Blog: **Lilian Weng "World Models"**

---

参见 / See also: [[llm-essence]], [[lecun-jepa]], [[friston-active-inference]], [[pearl-causal]]
