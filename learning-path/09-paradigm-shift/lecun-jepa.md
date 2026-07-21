---
title: LeCun 与 JEPA · Yann LeCun and JEPA
type: concept
phase: 9
tags: [lecun, jepa, world-model, predictive-coding, energy-based]
created: 2026-07-21
language: zh-CN
---

# LeCun 与 JEPA · Yann LeCun and JEPA

> **学习目标 / Learning Objectives**
> - 深入理解 LeCun 对 LLM 的批判 / Deeply understand LeCun's LLM critique
> - 掌握 JEPA 架构的数学和直觉 / Master JEPA's math and intuition
> - 评估 JEPA 是否是 AGI 的"正确路径" / Evaluate if JEPA is the "right path" to AGI

## Yann LeCun 其人 / Who Is Yann LeCun

**Yann LeCun** (1960-):
- **1989** 发明 CNN (LeNet), 用于手写数字识别
- **1998** MNIST 数据集 (与 Corinna Cortes)
- **2003** 纽约大学教授
- **2013** Facebook AI Research (FAIR) 创始主任
- **2018** ACM Turing Award (与 Hinton, Bengio 共同)
- **2022-** Meta 首席 AI 科学家

**特点 Characteristics**:
- **反潮流**: 2022- 反复批判 LLM, 但 Meta 仍训 Llama
- **持久**: 从 1980s 坚持神经网络,即便寒冬
- **理论派**: 喜欢从原理出发设计
- **社交媒体活跃**: Twitter/X 上活跃,犀利点评

## LeCun 对 LLM 的批判 / LeCun's LLM Critique

### 主张 1: LLM 没有世界模型

> "LLMs do not have a world model. They have a world model, but it's very superficial."

**论证 Argument**:
1. LLM 不能**规划**:它生成第一个 token,然后基于这个 token 生成下一个.**没有搜索**.
2. LLM 不能**反事实**:问"如果 X 不同会怎样",LLM 用统计模式回答.
3. LLM **数据效率极低**:需要万亿 token,儿童只需几亿词.

### 主张 2: 自回归 LLM 是死胡同

> "Autoregressive LLMs are doomed. They will never reach AGI."

**论证 Argument**:
- 自回归每步**复合误差**:每 token 有 ε 错误,生成 n token 后误差 ≈ nε.
- 这是**指数爆炸**问题.
- 即便 GPT-10 也不能解决——**架构本质**问题.

### 主张 3: LLM 不能"理解"

> "LLMs do not understand. They manipulate language forms."

**论证 Argument**:
- LLM 学到语言**形式**,不是**意义**.
- 没有任何"接地 grounding"——LLM 的"苹果"不连接真实苹果.
- 这是 LLM 幻觉、推理失败的根源.

### 主张 4: 需要"世界模型" AI

> "We need a new architecture that learns world models."

**核心 Key**: AI 应该学**抽象表示**,在表示上做预测和规划.

## JEPA 架构 / JEPA Architecture

**JEPA = Joint-Embedding Predictive Architecture**

**LeCun 2022** *A Path Towards Autonomous Machine Intelligence*:

### 核心思想 Core Idea

**不要在 pixel/token 上预测. 在抽象表示上预测**.

```
传统生成模型 Traditional Generative:
   x₁ (pixel) ───→ x₂ (pixel)   ← 预测每个像素

JEPA:
   x₁ ──→ s₁ (abstract) ──→ s₂ (abstract)   ← 预测抽象表示
   x₂ ──→ s₂ (abstract)
```

**直觉 Intuition**: 预测每个像素浪费算力在不重要的细节(如背景纹理).**抽象表示**才捕获重要结构.

### JEPA 的能量函数 Energy Function

**能量函数 E(x₁, x₂)**: 衡量 (x₁, x₂) 是否"兼容".

```
E(x₁, x₂) = ||φ(x₁) - g(φ(x₁))||²    (简单形式 simple version)
```

- φ: encoder (输入 → 表示)
- g: predictor (给定 s₁, 预测 s₂)

**训练目标 Training objective**:
- 对**真实** (x₁, x₂): 最小化 E
- 对**虚假** (x₁, x̂₂): 最大化 E (对比 learning)

### 与对比学习 Contrastive Learning 的关系

JEPA 是**对比学习的扩展**.但 LeCun 强调:
- 对比学习用**负样本**(随机采样)
- JEPA 用**能量函数**(连续度量)

### Variants of JEPA

#### 1. I-JEPA (Image JEPA, Assran et al. 2023)

**图像版 JEPA**:
- 输入图像,encoder 编码
- 部分图像的表示 → 预测其他部分的表示

**结果 Result**: 比对比学习(MoCo, SimCLR)**更样本高效**.线性探测(linear probe)效果好.

#### 2. V-JEPA (Video JEPA, Bardes et al. 2024)

**视频版 JEPA**:
- 视频片段 → 预测其他片段
- **学到的表示** 用于下游(分类、检测)

**意义 Significance**: 视频是**自然的世界模型训练数据**——物理常识、运动规律都在视频中.

#### 3. V-JEPA 2 (2024)

扩展到大规模,效果接近 GPT-4V 在某些视觉任务.

## JEPA 的架构组件 / JEPA Components

### 1. Perception Module (感知)

```
observation → encoder φ → representation s
```

### 2. Actor Module (行动)

```
state s → policy π → action a
```

### 3. World Model (世界模型)

```
(s_t, a_t) → predictor g → s_{t+1} prediction
```

**关键 Key**: 预测**抽象表示** s_{t+1}, 不预测像素.

### 4. Cost Module (成本)

```
(s_t, a_t) → cost c
```

类似 RL 的负奖励.

### 5. Short-term Memory (短期记忆)

```
past states → memory
```

### 6. Critic / Configurator

调整其他模块的行为.

## JEPA 如何规划 / How JEPA Plans

**经典 RL/规划 Classic RL/Planning**:
```
for each candidate action a:
    simulate trajectory with world model
    evaluate cost
choose action with minimum cost
```

**JEPA Inference**:
```
对可能的动作序列 a_1, a_2, ..., a_T:
    用 world model 预测 s_1, s_2, ..., s_T
    计算总成本
选最小成本的第一个动作
```

**关键 Critical**: 因为预测在**抽象空间**,搜索**高效**.

## JEPA vs LLM / JEPA vs LLM

| 维度 Dimension | LLM | JEPA |
|----|----|----|
| 预测对象 Predict | pixel/token | abstract representation |
| 训练目标 Objective | cross-entropy | energy / contrastive |
| 规划 Planning | 无 (生成) | 有 (search in latent) |
| 数据效率 Sample Eff. | 低 (万亿 token) | 高 (目标: 婴儿水平) |
| 推理 Inference | 自回归 | 搜索 + 单步预测 |
| 学习 Learning | 监督 | 自监督 |
| 接地 Grounding | 无 | 通过感知-行动循环 |

## JEPA 的开放问题 / Open Problems

### 1. 表示坍塌 Representation Collapse

**问题 Problem**: encoder φ 可能输出**常数**(避免预测错误).

**解决 Solution**: 对比损失、能量函数、停止梯度(stop-gradient).

### 2. 评估难 Evaluation Difficulty

JEPA 学到表示,如何评估"好不好"?
- Linear probe: 下游任务准确率
- 但**最理想的下游任务**是什么?

### 3. 规划算法

JEPA 提供世界模型,但**如何搜索**最佳动作?
- 经典方法(MCTS, A*): 复杂度高
- 强化学习: 样本效率问题
- 这是**未解难题**

### 4. 语言处理

JEPA 擅长视觉.**语言** 怎么办?
- LeCun 主张语言也应在"抽象表示" 上预测
- 但**什么是语言的抽象表示**?没共识

## 业界反应 / Industry Response

### 支持派 Supporters

- **Meta AI**: 全力推进 JEPA (V-JEPA, I-JEPA)
- **学术**: 越来越多 JEPA 论文(2024-2025)
- **部分 OpenAI/DeepMind**: 注意到 JEPA,但未全面转向

### 怀疑派 Skeptics

- **Hinton**: "JEPA 可能对,但 LLM 也有真世界模型"
- **Sutskever**: "预测 token 足够"
- **工业 LLM 团队**: 不愿放弃已投入

### 主流态度 Mainstream Attitude

**观望 Wait-and-see**:
- JEPA 还没"AlexNet 时刻"(没在重大任务上击败 LLM)
- 但**值得跟踪**(尤其是 V-JEPA 2)

## JEPA 的潜在突破点 / Potential Breakthrough Points

### 突破 1: 机器人

如果 JEPA 能让机器人用**少量数据**学会操作,这是 LLM 做不到的.

### 突破 2: 视频理解

V-JEPA 在视频理解上若超过 GPT-4V,说明抽象预测优于像素预测.

### 突破 3: 规划

如果 JEPA 能在围棋/星际/真实规划任务上**击败** AlphaZero 等,证明其范式优势.

### 突破 4: AGI 检验

如果 JEPA 用 **婴儿级数据量** 达到 GPT-4 能力,证明其数据效率优势.

## 与 LLM 的连接 / Connection to LLMs

1. **LeCun 的批判是当前 LLM 范式最重要的内部挑战**
   LeCun 是 Turing 奖得主,Meta 首席.他的批判**有分量**.即便主流不转向,也迫使工业界反思.
   > LeCun's critique is the most important internal challenge to LLM paradigm.

2. **JEPA 与 LLM 可能融合**
   未来: LLM 处理语言,JEPA 处理感知/规划,通过接口协作.
   > Future: LLM for language, JEPA for perception/planning, collaborate via interface.

3. **JEPA 的成功不等于 LLM 失败**
   即便 JEPA 在某些任务超 LLM,LLM 仍有价值(语言任务).两者**互补**.
   > JEPA success ≠ LLM failure. Complementary.

4. **范式思考**: JEPA 是不是"对的范式"?
   - **理论角度**: 有道理(学抽象表示,不学像素)
   - **实验角度**: 还需更多证据
   - **市场角度**: 资本仍押 LLM,J EPA 资源少
   - **哲学角度**: 接近"预测编码" 神经科学
   
   **判断 Judgment**: JEPA 是**当前最有理论深度的范式转变候选**.但是否"赢",取决于工程突破.
   > JEPA is most theoretically deep paradigm candidate. Whether it wins depends on engineering breakthroughs.

## 关键问题 / Questions

1. JEPA 在语言任务上能匹敌 LLM 吗? / Can JEPA match LLM on language?
2. 表示坍塌问题的根本解决? / Fundamental solution to representation collapse?
3. JEPA 如何处理**抽象推理**(数学、逻辑)? / How does JEPA handle abstract reasoning?
4. 如果 JEPA 成功,AGI 的实现还需要什么? / If JEPA succeeds, what else is needed for AGI?

## 推荐资源 / Resources

- 论文 / Paper: LeCun (2022) *A Path Towards Autonomous Machine Intelligence* (开放白皮书 / open whitepaper)
- 论文 / Paper: Assran et al. (2023) *I-JEPA*
- 论文 / Paper: Bardes et al. (2024) *V-JEPA*
- 视频 / Video: **Yann LeCun Lex Fridman Interview 2022/2024**
- 视频 / Video: **Yann LeCun Turing Award Lecture**
- 博客 / Blog: LeCun 在 Facebook/Meta 的公开帖

---

参见 / See also: [[world-models]], [[friston-active-inference]], [[llm-essence]]
