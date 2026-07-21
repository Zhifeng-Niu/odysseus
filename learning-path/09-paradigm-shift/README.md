---
title: 阶段 9 · 范式转变方向 · Paradigm Shift Directions
type: phase
phase: 9
tags: [paradigm-shift, jepa, compression, active-inference, causal, embodied]
created: 2026-07-21
language: zh-CN
---

# 阶段 9 · 范式转变方向 · Paradigm Shift Directions

> **阶段核心问题 / Central Question**
> 如果 LLM 不是终局,下一步是什么?哪些思想家提供了真正不同的路径?如何识别下一个 Transformer 级突破?
> > If LLMs aren't the endgame, what's next? Which thinkers offer genuinely different paths? How to spot the next Transformer-level breakthrough?

## 阶段定位 / Phase Position

这是学习路径的终点,也是你范式突破之路的起点.

**前面 8 阶段 / Previous 8 phases**: 建立基础——物理、计算、AI 历史、当前 LLM.

**这一阶段 This phase**: 展望未来——**非主流但可能革命性**的范式.

## 五大范式转变方向 / Five Paradigm Shift Directions

```
                       LLM 范式的局限
                            │
       ┌──────┬──────┬──────┼──────┬──────┬──────┐
       │      │      │      │      │      │      │
    JEPA   压缩   主动   因果  神经   具身   量子
    (LeCun)(Schm)(Friston)(Pearl) 符号   AI    神经
       │      │      │      │      │      │      │
    表示空间  信息   自由能  干预  学习+  身体+  叠加
    预测      压缩   原理    反事实 推理   感知   纠缠
       │      │      │      │      │      │      │
    "学表示" "理解  "最小化 "为什么"符号+  物理  物理
     预测   =压缩" 预测误  而非" 神经  交互  超越
     而非    最大化 差"    相关"  结合       TM
     token  压缩                  世界
     预测    比                    接地
```

## 学习目标 / Learning Objectives

完成此阶段后,你将能够 / After this phase, you will be able to:

- 用 5 种不同范式**批判** 当前 LLM / Critique current LLMs via 5 different paradigms
- 识别每个范式的**核心主张**和**实验进展** / Identify each paradigm's core claim and progress
- 看到这些范式如何**互相组合**, 可能形成下一代 AI / See how they might combine for next-gen AI
- 建立**评判新范式**的标准(可行性、实验证据、市场动力) / Build criteria to evaluate new paradigms
- 形成自己的**范式突破预判** / Form your own paradigm-shift prediction

## 本阶段文件 / Files in This Phase

| 文件 File | 思想家 Thinker | 核心主张 Core Claim |
|----|----|----|
| [[lecun-jepa]] | Yann LeCun | 在**抽象表示**上预测,不在 pixel/token 上 | 
| [[schmidhuber-compression]] | Jürgen Schmidhuber | "压缩即智能"; 最优压缩 = 理解 |
| [[friston-active-inference]] | Karl Friston | 自由能原理; 生命 = 最小化预测误差 |
| [[pearl-causal]] | Judea Pearl | 因果推理 = AI 的"下一个 ladder" |
| [[neuro-symbolic]] | 多人 Various | 神经网络 + 符号推理的混合 |
| [[embodied-ai]] | Rodney Brooks 等 | 智能必须有身体(具身) |

## 比较矩阵 / Comparison Matrix

| 范式 Paradigm | 主要批判 LLM 点 Critique | 关键创新 Innovation | 成熟度 Maturity |
|----|----|----|----|
| JEPA | LLM 学表层统计,不能规划 | 表示空间预测 | 实验阶段 Experimental |
| 压缩主义 | LLM 没真压缩 | 直接优化压缩率 | 历史悠久, 现复兴 |
| 主动推断 | LLM 无行动,无 grounding | 自由能 + 行动 | 神经科学成熟,AI 新 |
| 因果推理 | LLM 学相关,不学因果 | 因果图 + 干预 | 数学成熟, 应用难 |
| 神经符号 | LLM 不能精确推理 | LLM + 符号系统 | 工业落地中 |
| 具身 AI | LLM 缺世界知识 | 机器人 + LLM | 早期 Early |

## 哪些方向**不是**范式突破 / What's NOT a Paradigm Shift

为了不迷失,先排除一些**看似突破实则不是**的方向:

### 不是范式突破 1: 更大的 LLM

GPT-5, GPT-6... 是**同一范式**的扩展,不是范式突破.

### 不是范式突破 2: 多模态 LLM

GPT-4V, Claude 3 Vision. **架构不变**,只是输入输出扩展.

### 不是范式突破 3: Agent / Tool Use

AutoGPT, LangChain. LLM + 工具,不是新架构.

### 不是范式突破 4: 更好的 RLHF

DPO, GRPO, KTO. 都在 RLHF 框架内.

### 不是范式突破 5: 模型压缩 / 量化

LoRA, 4-bit. 部署优化,不是范式突破.

## 真正的范式突破信号 / True Paradigm Shift Signals

### 信号 1: 不同的**数学基础**

Transformer 基于注意力.**新范式** 应该基于不同的数学(如预测编码、自由能、因果图).

### 信号 2: 不同的**学习目标**

LLM 学"预测下一 token".新范式学"预测抽象表示"、"最小化自由能"、"理解干预效果".

### 信号 3: 不同的**评估指标**

perplexity, MMLU 等是 LLM 指标.新范式应该有**新指标**(如样本效率、因果发现率、规划成功率).

### 信号 4: 来自**非主流**研究者

Transformer 2017 来自 Google,但思想根源是 1980s attention.**真正的范式突破**往往来自**学术边缘**或**跨界**.

### 信号 5: 解决 LLM 的**根本**问题

不是"让 LLM 更准",而是"解决幻觉、世界知识、规划、因果推理".

## 范式突破的历史模式 / Historical Pattern of Paradigm Shifts

### 模式 Pattern

```
旧范式饱和 Old paradigm saturates
↓
批判者涌现 Critics emerge
↓
被主流忽视 Ignored by mainstream
↓
新理论 + 实验突破 Theory + experiment
↓
关键应用 Key application
↓
范式转换 Paradigm shift
↓
新主流 New mainstream
```

### 实例 Examples

**1. 符号 AI → 神经网络 (1986-2012)**
- 饱和: 专家系统维护爆炸
- 批判者: Hinton, LeCun, Bengio(被边缘化)
- 理论: 反向传播
- 实验: AlexNet 2012
- 应用: ImageNet, 翻译
- 范式转换: 深度学习时代

**2. RNN → Transformer (2014-2017)**
- 饱和: RNN 长程依赖差, 训练慢
- 批判者: Vaswani 团队
- 理论: 自注意力
- 实验: WMT 翻译
- 应用: BERT, GPT
- 范式转换: Transformer 时代

**3. 现在 LLM → ?**
- 饱和?: Scaling 放缓
- 批判者: LeCun, Pearl, Friston, Schmidhuber
- 理论: JEPA, 主动推断, 因果图
- 实验: V-JEPA, Dreamer, AlphaProof
- 应用: ?
- 范式转换: ?

## 你如何参与范式突破 / How You Can Participate

### 路径 1: 学术研究路径

读博,做边缘研究,等"AlexNet 时刻".**风险**: 10-20 年才能见效.

### 路径 2: 工程路径

在现有 LLM 上做"工具",**实战** 理解局限.**优势**: 见多识广,可能发现意外突破.

### 路径 3: 创业路径

把非主流范式做成产品.**例**: Symbolica(符号 AI), Verses(主动推断).**风险高,回报大**.

### 路径 4: 投资路径

识别下一个 AlexNet 前的公司/团队.**优势**: 杠杆大.**风险**: 错过比选中容易.

### 路径 5: 综合(最适合用户)

**建立基础**(已完成阶段 1-8)→ **理解非主流**(阶段 9)→ **自己思考突破**(下一步).

## 关键警示 / Key Warnings

1. **不要被任何单一范式迷惑**
   JEPA, 主动推断, 因果——每个都有缺陷.真正的突破可能是**混合**.
   
2. **不要忽视工业界动力**
   LeCun 在 Meta, 但 Meta 仍在训 LLM.**范式转变需要资本支持**.

3. **不要忽视硬件约束**
   Transformer 部分因为 GPU 受欢迎.新范式可能需要**新硬件**(神经形态芯片, 量子).

4. **不要急于"发明"新范式**
   先**深度理解**已有范式. Newton: "If I have seen further, it is by standing on the shoulders of giants."

5. **警惕"AGI 邪教"**
   部分 AI 圈子声称已找到"唯一真路径".警惕任何绝对化主张.

## 推荐资源 / Resources

### 综述书籍 / Survey Books
- **Brian Christian** *The Alignment Problem* — 对齐问题 / Alignment
- **Anil Seth** *Being You* — 神经科学视角 / Neuroscience view
- **Stuart Russell** *Human Compatible* — AI 未来 / AI future
- **Max Tegmark** *Life 3.0* — AGI 哲学 / AGI philosophy

### 思想家访谈 / Thinker Interviews
- **Lex Fridman Podcast**: LeCun, Schmidhuber, Friston, Pearl 等访谈
- **Two Minute Papers**: 最新论文通俗解读
- **Yann LeCun Twitter/X**: 持续批判 LLM

### 论文集 / Paper Collections
- LeCun (2022) *A Path Towards Autonomous Machine Intelligence*
- Pearl & Mackenzie (2018) *The Book of Why*
- Friston (2010) *The free-energy principle*
- Schmidhuber's **"Algorithmic Information Theory and Godel"** 系列

### 跟踪前沿 / Tracking Frontier
- arXiv: cs.AI, cs.LG, cs.NE
- Twitter/X: @ylecun, @SchmidhuberAI, @fristonkarl, @yudapearl
- Hacker News, Reddit r/MachineLearning

## 完成判据 / Completion Criteria

- [ ] 能陈述每个范式的**核心主张** / Can state each paradigm's core claim
- [ ] 能用至少 2 个范式**批判** LLM / Can critique LLM via ≥2 paradigms
- [ ] 能识别新论文/产品**属于哪个范式** / Can identify which paradigm a new paper/product belongs to
- [ ] 形成**自己的范式突破预判**(写在 /journal/paradigm-prediction.md) / Form own prediction
- [ ] 完成下一步学习/实践计划 / Plan next steps

## 阶段终点 · 你的起点 / Phase End · Your Beginning

```
9 个阶段学习路径 9-Phase Learning Path
├── 阶段 1: 物理 Physics ← 硅、MOSFET
├── 阶段 2: 数字逻辑 Digital ← 布尔、门电路
├── 阶段 3: 架构 Architecture ← 冯诺依曼、CPU
├── 阶段 4: 编程 Programming ← C、内存
├── 阶段 5: 算法 Algorithms ← Big-O、P vs NP
├── 阶段 6: 可计算 Computability ← 图灵、哥德尔
├── 阶段 7: AI 历史 History ← 符号 → 连接
├── 阶段 8: 当前范式 Current ← LLM、RLHF
└── 阶段 9: 范式转变 Shift ← JEPA、Friston、Pearl

        ↓↓↓

       你 Your
      起点 Starting
        点 Point

        ↓↓↓

  独立思考 Independent Thinking
  跨界融合 Cross-disciplinary Synthesis
  批判主流 Critical of Mainstream
  长期主义 Long-termism
```

**这不是终点,而是真正的起点**.

> **This is not the end, but the real beginning.**

---

参见 / See also: [[learning-roadmap]], [[llm-essence]], [[world-models]]
