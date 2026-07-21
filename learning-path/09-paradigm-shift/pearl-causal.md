---
title: Pearl 与因果推理 · Pearl and Causal Reasoning
type: concept
phase: 9
tags: [pearl, causal-inference, bayesian-network, ladder-of-causation]
created: 2026-07-21
language: zh-CN
---

# Pearl 与因果推理 · Pearl and Causal Reasoning

> **学习目标 / Learning Objectives**
> - 理解 Pearl 的"因果之梯 Ladder of Causation" / Understand Pearl's Ladder of Causation
> - 掌握结构因果模型(SCM)和 do-calculus / Master Structural Causal Models and do-calculus
> - 看到 LLM 缺乏因果推理的根源 / See root of LLMs' lack of causal reasoning

## Judea Pearl 其人 / Who Is Judea Pearl

**Judea Pearl** (1936-):
- **以色列裔美国计算机科学家**, UCLA 教授
- **1980s 发明贝叶斯网络 Bayesian Networks**
- **2011 ACM Turing Award**
- **1990s- 转向因果推理**, 提出 SCM, do-calculus
- **父亲视角**: 儿子 Daniel Pearl (记者) 2002 在巴基斯坦被绑架杀害.此后 Pearl 推动穆斯林-犹太对话.

**特点 Characteristics**:
- **数学严密**: 用概率论 + 图论
- **批判性强**: 公开批判深度学习"只学相关"
- **思想家**: 关心 AI 的哲学基础
- **持续高产**: 80+ 岁仍发论文

## 因果之梯 Ladder of Causation

**Pearl 2018** *The Book of Why*:

```
                Level 3: 反事实 Counterfactual
                    ↑
                    │ "如果当时 X 不同, Y 会怎样?"
                    │ (想象 / 后悔 / 责任)
                    │
                Level 2: 干预 Intervention
                    ↑
                    │ "如果我做 X, Y 会怎样?"
                    │ (实验 / 决策)
                    │
                Level 1: 关联 Association
                    ↑
                    │ "如果我观察 X, 关于 Y 我知道什么?"
                    │ (观察 / 预测)
```

### Level 1: 关联 Association

**问题 Question**: P(Y | X) = ? (观察 X 时, Y 的分布?)

**方法 Methods**:
- 统计学
- 机器学习(监督)
- 深度学习 / LLM

**关键 Key**: **无因果, 只是相关**.

**LLM 在 Level 1**: 这是 LLM **唯一**在的层级.

### Level 2: 干预 Intervention

**问题 Question**: P(Y | do(X)) = ? (我**做** X 时, Y 的分布?)

**关键 Critical**: `do(X)` ≠ `观察 X`. 干预**改变**系统, 观察不改变.

**例 Example**:
- 观察: 高血压病人吃降压药 → 还是发病(P(发病 | 吃药))
- 干预: 让一组人吃药, 一组不吃 → P(发病 | do(吃药))

**方法 Methods**:
- 随机对照试验 RCT
- do-calculus
- 因果图

**LLM 在 Level 2**: **不能**.LLM 不能干预, 只能预测.

### Level 3: 反事实 Counterfactual

**问题 Question**: P(Y_x | X = x', Y = y') = ? (如果当时做 X 而不是 x', Y 会怎样?)

**例 Examples**:
- "如果希特勒没出生, 二战会爆发吗?"
- "如果我当时没吃糖, 现在会瘦吗?"
- " defendant 当时如果不开枪, victim 还会死吗?"

**方法 Methods**:
- 结构因果模型
- 反事实推理

**LLM 在 Level 3**: **完全不能**.LLM 用统计模式"想象", 无因果保证.

## 结构因果模型 Structural Causal Models (SCM)

### 定义 Definition

**SCM** = (V, U, F):
- V = 内生变量 endogenous variables (可观测)
- U = 外生变量 exogenous variables (噪声/隐变量)
- F = 函数 functions (V_i = f_i(parents(V_i), U_i))

### 因果图 Causal Diagram

**有向无环图 DAG**: 节点 = 变量, 边 = 因果关系.

```
例 Example: 吸烟 → 肺癌

[吸烟 Smoking] ─────→ [肺癌 Cancer]
       │                  
       ↓                  
   [黄牙 Yellow Teeth]     
       ↑                  
       │                  
   [吸烟 Smoking] ───→ ...
```

**关键 Insight**: "黄牙"和"肺癌" **相关**, 但**没有因果关系**(都由吸烟引起).

### d-separation

**Pearl 的 d-separation**: 从因果图判断**条件独立性**.

**意义 Significance**: 不需数据, **从图就能推断**变量间的统计关系.

### do-calculus

**Pearl 1995** 发明 **do-calculus**: 给定因果图 + 观察数据, 计算**干预效果**.

**核心规则 Three rules**:
1. 插入/删除观察 Insertion/deletion of observations
2. 行动/观察交换 Action/observation exchange
3. 插入/删除行动 Insertion/deletion of actions

**重要性 Importance**: do-calculus 是**完备 complete**的——能算的都能算, 不能算的数学上无解.

## 因果发现 Causal Discovery

### 问题 Problem

**反向问题 Inverse Problem**: 给定数据, **发现**因果图.

### 方法 Methods

#### 1. 基于约束 Constraint-based

**PC 算法 (Spirtes, Glymour, Scheines 1993)**:
1. 假设所有变量都有边
2. 用条件独立性测试**移除**边
3. 用方向规则**定向**剩余边

#### 2. 基于分数 Score-based

**GES, GIES**: 用 BIC, BDeu 等分数**搜索**最优图.

#### 3. 基于非线性/深度学习

**NOTEARS (Zheng 2018)**: 把因果发现**变成连续优化**.

**GraN-DAG**: 用神经网络学因果结构.

## 因果推理与机器学习 / Causal ML

### 因果发现 + ML Causal Discovery + ML

**问题 Problem**: 标准 ML 学**相关**, **不学因果**.

**例 Example**:
- ML 学到"雨伞 → 雨天"(高相关)
- 但**带伞不会导致下雨**(因果反向)

**解决 Solution**: 加入**因果先验** 或用 SCM.

### Invariant Risk Minimization (IRM)

**Arjovsky et al. 2019**: **IRM** 损失.

**核心思想 Core idea**: 找在**所有环境** 都不变的预测器.

**直觉 Intuition**: 真因果特征在不同环境(干预) 下**稳定**.假相关**易变**.

### Causal Representation Learning

**2022-**: 用深度学习学**因果表示**.

**目标 Goal**: 学到**符合 SCM** 的潜在变量.

## Pearl 对 LLM 的批判

### 主张 1: LLM 在 Level 1 (关联)

> "Current machine learning is stuck on the first rung of the ladder of causation."

**论证**: LLM 预测下一 token = 学**相关**.无因果概念.

### 主张 2: 因果 AI 是下一个范式

> "Causal reasoning is the next frontier of AI."

**论证**: 
- 历史上的科学革命 = 因果推理革命
- 当前 AI 缺乏, 阻碍真正智能
- 必须有"因果意识"

### 主张 3: 数据 + 算力 ≠ 智慧

> "Data is profoundly dumb. It cannot tell you what will happen if you intervene."

**论证**:
- 数据是关联的, 不是因果的
- 大数据 + 深度学习 = Level 1 极致, **无法** 升 Level 2/3
- 需要**因果模型 + 数据**

## Pearl 与深度学习派的辩论

### 深度学习派的反驳 DL's Rebuttals

**反对 1: LLM 隐式学因果**
**Bareinboim, Pearl 的学生** 等: 部分承认.但不够.

**反对 2: Pearl 的 SCM 太手工**
**批评 Critique**: 因果图需要**专家定义**, 难规模化.

**反对 3: do-calculus 不实用**
**批评**: 现实数据复杂, do-calculus 假设太强.

### Pearl 的回应 Pearl's Response

**回应 1**: "隐式" 不够.**显式因果模型**才能 Level 2/3.

**回应 2**: 因果发现算法正在改进, 不再纯手工.

**回应 3**: 实用性是工程问题, 数学原理已建立.

### 主流共识 Mainstream Consensus (2024)

- Pearl 的"因果之梯" 框架**正确**
- 但**深度学习 + 因果** 如何结合, 未解决
- **混合范式**(LLM + SCM) 可能是路径

## 实际应用 / Practical Applications

### 1. 医药 Medicine

**RCT**: 黄金标准.但贵.
**因果推断**: 从**观察数据** 估计药效.

### 2. 经济学 Economics

**2021 Nobel Economics**: Card, Angrist, Imbens 因**自然实验** (因果方法).

### 3. 推荐系统 Recommendation

**因果推荐**: 解决"偏差 bias"问题.例: 推荐电影, 不是"看 A 的人也看 B"(相关), 而是"推荐 A 会让人多看 B"(因果).

### 4. 公平性 Fairness

**Counterfactual Fairness**: "如果性别不同, 决策会不同吗?" 这是**反事实公平**.

### 5. LLM 的因果能力

**测试 Tests**:
- **CLADDER** (Zhang et al. 2023): 测试 LLM 因果推理
- **结果**: LLM 在简单因果问题上**能**(模式匹配), 复杂的**不能**

## 因果 AI 公司 / Causal AI Companies

### 1. Causal AI (公司名)

**2021 创立**, 伦敦.基于 Pearl 等的因果推理, 服务金融、医药.

### 2. GSI Inc.

** causaLens** 等: 商业因果 AI 平台.

### 3. 学术 - 工业界合作

Microsoft Research, Google DeepMind 有因果团队.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 在因果之梯 Level 1, 无法升 Level 2/3**
   这是 Pearl 的核心批判.即便 GPT-10, 也可能仍在 Level 1.
   > LLMs at Level 1. Even GPT-10 may stay Level 1.

2. **LLM + SCM 可能是路径**
   未来: LLM 处理自然语言 + SCM 做因果推理 + 工具执行干预.**神经符号** 路径.
   > Future: LLM + SCM + tools = neuro-symbolic path.

3. **AlphaProof 的启示**
   DeepMind AlphaProof (2024): 用形式语言 Lean + RL + LLM 做数学.**类似思路**: LLM 生成 + 符号系统验证.
   > AlphaProof: LLM + Lean + RL. Template for future causal AI.

4. **范式思考**: 因果 AI 能"超越" Pearl 吗?
   Pearl 的 SCM 是**经典因果** 框架.但**量子因果**、**模糊因果** 可能超越.
   
   目前, Pearl 框架是**数学最严密**的因果 AI 路径.
   > Can causal AI surpass Pearl? Quantum/fuzzy causality may. Currently, Pearl's framework is most rigorous.

## 关键问题 / Questions

1. 因果图如何**自动学习**? / How to automatically learn causal graphs?
2. LLM + 因果图的具体架构? / Concrete architecture for LLM + SCM?
3. 反事实推理的**计算复杂度**? / Computational complexity of counterfactuals?
4. 因果 AI 能解决 LLM 幻觉吗? / Can causal AI solve LLM hallucination?

## 推荐资源 / Resources

- 书 / Book: Pearl & Mackenzie (2018) *The Book of Why* — 通俗 / Popular
- 书 / Book: Pearl (2009) *Causality: Models, Reasoning, and Inference* — 严密 / Rigorous
- 书 / Book: Pearl, Glymour, Jewell (2016) *Causal Inference in Statistics: A Primer*
- 论文 / Paper: Pearl (1995) *Causal diagrams for empirical research*
- 论文 / Paper: Arjovsky et al. (2019) *Invariant Risk Minimization*
- 视频 / Video: **Judea Pearl Lex Fridman Interview 2021**
- 课程 / Course: **Coursera "A Crash Course in Causality"**

---

参见 / See also: [[neuro-symbolic]], [[llm-essence]], [[world-models]]
