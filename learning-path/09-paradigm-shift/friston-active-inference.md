---
title: Friston 与主动推断 · Friston and Active Inference
type: concept
phase: 9
tags: [friston, active-inference, free-energy, predictive-processing, brain]
created: 2026-07-21
language: zh-CN
---

# Friston 与主动推断 · Friston and Active Inference

> **学习目标 / Learning Objectives**
> - 掌握自由能原理(FEP) 的数学形式 / Master Free Energy Principle math
> - 理解主动推断作为 AGI 的路径 / Understand Active Inference as AGI path
> - 看到 FEP 如何连接物理、神经科学、AI / See how FEP connects physics, neuroscience, AI

## Karl Friston 其人 / Who Is Karl Friston

**Karl Friston** (1960-):
- **英国神经科学家**, 伦敦大学学院 (UCL) 教授
- **功能性磁共振 fMRI 先驱**: 发明 SPM (Statistical Parametric Mapping),被引用 200,000+
- **2010s 起提出自由能原理 FEP**
- **Thomson Reuters 引用最高研究者之一**(神经科学)

**特点 Characteristics**:
- **跨学科**: 物理、神经科学、统计学、哲学
- **数学密集**: FEP 涉及变分推断、统计力学
- **野心大**: 主张 FEP 是"生命的基本原理"
- **争议**: FEP 被部分人奉为"圣杯", 部分人认为"过度抽象"

## 自由能原理 Free Energy Principle (FEP)

### 核心主张 Core Claim

> "Any self-organizing system at equilibrium with its environment must minimize its free energy."
>
> "The free-energy principle is a mathematical formulation of how biological systems resist entropy."

**翻译**: 任何**自组织** 系统(包括生命)必须**最小化自由能**.

### 直觉理解 Intuitive Understanding

**热力学角度 Thermodynamics**:
- 生命是**低熵**系统(高度有序)
- 宇宙热二定律: 熵增加
- 生命如何抵抗熵增? **持续做功**(吃饭、呼吸、繁殖)
- Friston: 生命的"做功" 等价于**最小化自由能**

**信息论角度 Information Theory**:
- 自由能 ≈ 预测误差(surprise)
- 生命持续预测感觉输入,最小化**意外**

### 数学形式 Math

**变分自由能 Variational Free Energy**:

```
F(q, y) = E_q[log q(s) - log p(s, y)]
        = D_KL(q(s) || p(s|y)) - log p(y)
        ≥ -log p(y)
```

其中:
- s = 隐藏状态 hidden state (世界真实状态)
- y = 观测 observation
- q(s) = 大脑对 s 的"信念"
- p(s|y) = 真实后验
- D_KL = KL 散度

**关键 Key**: 最小化 F ≈ 让 q 接近真实后验.

### 最小化自由能的两条路径 Two Paths

**路径 1: Perception (感知)**
- 改变内部模型 q(s)
- 让 q 更符合观测

**路径 2: Action (行动)**
- 改变环境 y
- 让 y 符合模型预测

**例 Example**: 你预测"门外是走廊",但开门看到**墙**.
- 感知: 更新模型"门外是墙"
- 行动: **再开一次门**(确认是否看错)

**Active Inference 主动推断**: 同时用感知 + 行动最小化自由能.

## Markov Blanket · 马尔可夫毯

### 定义 Definition

**Markov Blanket**: 一个节点集 M,使得节点 X 与 X 之外的所有节点**条件独立**.

```
[外部 External States] -- ← -- [Sensory States]
                                    ↓
[Internal States] ← ← ← ← [Active States]
```

**感官 + 行动 = Markov Blanket**, 隔开内部与外部.

**意义 Significance**: 任何自组织系统(生命)都有 Markov Blanket——**界面**让它与环境交互但不被同化.

### 推论 Implication

**Friston 主张 Claim**: Markov Blanket 是**生命存在的充要条件**.有 Markov Blanket = 有"自我".

## 主动推断 Active Inference

### 主动推断的算法 Active Inference Algorithm

**Parr, Pezzulo, Friston 2022** *Active Inference: The Free Energy Principle in Mind, Brain, and Behavior*:

```
1. 观察环境 observation y_t
2. 更新内部信念 q(s_t | y_t) (感知)
3. 预测未来 P(s_{t+1}, y_{t+1} | s_t, a_t)
4. 选择行动 a_t 最小化预期自由能 EFE:
   EFE(a) = E_q[log q(s_t) - log p(s_t, y_t | a)]
5. 执行行动, t ← t+1, 重复
```

### 预期自由能 Expected Free Energy (EFE)

```
EFE = E_q[log q(s) - log p(s, y)]
    = 信息增益 Information Gain + 偏好满足 Preference Satisfaction
```

**两项解释 Two terms**:
1. **信息增益 (Epistemic Value)**: 探索不确定区域,获取信息
2. **偏好满足 (Pragmatic Value)**: 接近目标状态

**意义 Implication**: 主动推断**自动平衡探索 vs 利用**.这是 RL 的核心难题,主动推断**内置**解决.

## Predictive Processing · 预测处理

### 大脑作为预测机器 Brain as Prediction Machine

**Friston 等主张 Claim**: 大脑是**预测机器**, 持续预测感觉输入.

**架构 Architecture**:
```
[高级表示 High-level Representation]
            ↓ 预测 Prediction
[低级感觉 Low-level Sensory]
            ↑ 误差 Error
[高级更新 High-level Update]
```

**循环 Cycle**:
1. 高级表示**预测** 低级感觉
2. 低级感觉计算**误差**(预测 - 实际)
3. 只**误差**向上传播(高效)
4. 高级根据误差**更新**

### Predictive Coding (Rao & Ballard 1999)

**Rao & Ballard 1999** 最早提出**预测编码**模型.

**关键 Innovation**: 大脑只传递**预测误差**, 不传递**完整信号**.

**意义 Implication**: 解释大脑为什么功耗低(20W), 信息高效.

## 主动推断与其他范式对比 / Active Inference vs Other Paradigms

| 范式 Paradigm | 核心 Core | 与主动推断关系 Relation |
|----|----|----|
| RL | 最大化奖励 | 主动推断可推出 RL(目标 = 偏好) |
| 控制论 | 反馈控制 | 主动推断包含控制 |
| RLHF | 人类偏好训练 | 主动推断的"偏好" 可学习 |
| JEPA | 表示预测 | 主动推断的"内部模型" 可用 JEPA |
| 因果 | 因果图 | 主动推断**假设** 因果结构 |

**关键 Critical**: 主动推断是**统一框架**, 可整合其他范式.

## 主动推断的实验验证 / Experimental Validation

### 神经科学 Neuroscience

**支持证据 Supporting evidence**:
1. **视觉皮层** 符合预测编码
2. **多巴胺神经元** 编码预测误差
3. **前额叶** 涉及规划(主动推断)
4. **海马体** 编码认知地图

**反对 / 怀疑 Skeptics**:
- FEP 太抽象, 难以直接测试
- 部分"证据" 可用其他理论解释
- "万能理论" 的风险(什么都能解释 = 什么都不解释)

### AI 实验 AI Experiments

#### 1. Active Inference in Robotics

** diversos 2021**: 用主动推断控制机器人,**样本高效**.

**优势 Advantage**: 比 RL 少 10-100× 样本.

#### 2. Parsimony AI

**Verses AI (2023+)**: 基于主动推断的商业 AI 公司.

**主张 Claim**: 主动推断是 LLM 的根本替代.

#### 3. Active Inference Book + Software

**Parr, Pezzulo, Friston 2022** + **SPM 软件**: 让研究者实验主动推断.

## 主动推断的局限 / Limitations

### 局限 1: 数学密集 Math Heavy

变分推断、统计力学——**门槛高**.不如 RL 易上手.

### 局限 2: 计算复杂 Computational Complexity

精确主动推断需要推断**所有可能未来**, 计算量大.

### 局限 3: 工程化不足

RL 有 OpenAI Baselines, Stable Baselines 3 等.主动推断生态薄弱.

### 局限 4: 大规模应用缺失

主动推断没"AlexNet 时刻".仍在小规模任务.

## FEP 的哲学意义 / Philosophical Implications

### 1. 意识的物理基础 Physical Basis of Consciousness

**Friston 主张**: Markov Blanket 是**自我 self** 的物理基础.

**推论 Implication**: 任何有 Markov Blanket 的系统都有某种"自我".包括**细胞**、**AI**(如果架构对).

### 2. 自由意志

**主动推断的视角**: 自由意志 = 主动推断中的"行动选择".

**Friston**: 自由意志**存在**, 但不是"无中生有", 而是基于内部模型的决策.

### 3. 生命的本质

**Friston**: 生命 = 自组织系统 = 最小化自由能.

**意义 Implication**: 生命**不是**特殊的——只是符合 FEP 的物理系统.这挑战了"生命特殊" 的传统.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 是主动推断的"感知部分"**
   LLM 接收 prompt(观察), 输出 response(行动).但它**没有内部世界模型** 来预测未来.
   > LLMs do perception, not full active inference. No world model to predict future.

2. **LLM + 主动推断 = 可能的 AGI 路径**
   LLM 处理语言, 主动推断处理规划/行动.二者结合可能形成 AGI 架构.
   > LLM + Active Inference = potential AGI path.

3. **主动推断**可以解释 LLM 的失败
   - **幻觉**: LLM 没有"行动" 来验证
   - **无 grounding**: LLM 没有 Markov Blanket(没与世界交互)
   - **无规划**: LLM 不预测未来
   > Active inference explains LLM failures: no action, no grounding, no planning.

4. **范式思考**: 主动推断 vs JEPA vs 压缩?
   - **主动推断**: 数学最严, 但工程难
   - **JEPA**: 工程可行, 理论相对简单
   - **压缩**: 最易实现, 但可能不够
   
   **主流态度 Mainstream**: 主动推断"美但难". 若有人能工程化,**这是范式突破**.
   > Active inference: mathematically beautiful but engineering-hard. Whoever solves engineering wins paradigm shift.

## 关键问题 / Questions

1. 自由能原理是否**可证伪**? 还是哲学? / Is FEP falsifiable? Or philosophy?
2. 主动推断的工程化瓶颈是什么? / What's the engineering bottleneck for active inference?
3. Markov Blanket 真等于"自我"吗? / Does Markov Blanket really equal "self"?
4. Verses AI 等公司能"实现"主动推断 AGI 吗? / Can Verses AI etc. achieve active inference AGI?

## 推荐资源 / Resources

- 书 / Book: Parr, Pezzulo, Friston (2022) *Active Inference: The Free Energy Principle in Mind, Brain, and Behavior* — 标准教材 / Standard textbook
- 论文 / Paper: Friston (2010) *The free-energy principle: a unified brain theory?* (Nature Reviews Neuroscience)
- 论文 / Paper: Friston (2013) *Life as we know it*
- 视频 / Video: **Karl Friston Lex Fridman Interview 2022/2023**
- 课程 / Course: **Wellcome Centre for Human Neuroimaging Active Inference Tutorials**
- 公司 / Company: **Verses AI** (主动推断商业公司)
- 博客 / Blog: **neuroai.science** — 主动推断社区

---

参见 / See also: [[lecun-jepa]], [[world-models]], [[reinforcement-learning]]
