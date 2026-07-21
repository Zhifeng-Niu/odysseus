---
title: Schmidhuber 与压缩主义 · Schmidhuber and Compressionism
type: concept
phase: 9
tags: [schmidhuber, compression, kolmogorov, ait, rnn]
created: 2026-07-21
language: zh-CN
---

# Schmidhuber 与压缩主义 · Schmidhuber and Compressionism

> **学习目标 / Learning Objectives**
> - 理解"压缩即智能" 的精确数学形式 / Understand precise math of "compression = intelligence"
> - 掌握 Schmidhuber 的历史贡献(LSTM, Highway Network) / Master Schmidhuber's historical contributions
> - 评估压缩主义作为 AGI 路径 / Evaluate compressionism as AGI path

## Jürgen Schmidhuber 其人 / Who Is Schmidhuber

**Jürgen Schmidhuber** (1963-):
- **1987** 慕尼黑工业大学博士
- **1997** 与 Hochreiter 发明 **LSTM**(被引用 > 100,000 次)
- **2004** 创立 **IDSIA** (瑞士 AI 研究所)
- **2014** 与 Hochreiter 获 IEEE CIS Neural Networks Pioneer Award
- **2021** NNAISENSE 创始人(工业 AI)
- **2024** 沙特 KAUST 教授(引起争议)

**特点 Characteristics**:
- **理论先驱**: 1990s 起主张"压缩即智能", 早于 Hutter
- **争议人物**: 多次公开争 LSTM 归属(与 Hinton/LeCun/Bengio 关系紧张)
- **持续高产**: 60+ 岁仍发论文
- **多领域**: RL, RNN, World Models, AIT, Godel Machine

## 压缩即智能 · Compression Is Intelligence

### 核心主张 Core Claim

> "Understanding is compression. The better you compress, the better you understand."
> 
> "智能就是压缩数据的能力.最优压缩器 = 最优智能."

### 数学基础 Mathematical Foundation

**Schmidhuber 的论证基于 Kolmogorov 复杂度** (见 [[kolmogorov-complexity]]):

1. **K(x) = 最短程序生成长度**
2. 学习 x 的结构 = 找到 x 的最短描述
3. 智能 = 高效压缩 = 找到通用模式

### Schmidhuber 的"科学就是压缩"

**主张 Claim**: 科学的本质是压缩.

**例 Examples**:
- **牛顿万有引力**: 把千万观测(行星运动、苹果下落、潮汐)压缩为一个公式 F = G m₁m₂/r².
- **元素周期表**: 把 100+ 元素的性质压缩为周期函数.
- **自然选择**: 把千万物种的起源压缩为"变异 + 选择".

**意义 Implication**: 科学家做的,就是**寻找压缩**.AI 也应该这样.

## Speed Prior · Schmidhuber 的新主张

### Solomonoff 归纳的问题

**Solomonoff 归纳** (见 [[kolmogorov-complexity]]): 最短程序最可能正确.

**问题 Problem**: Solomonoff 没考虑**计算时间**.一个"短但慢"程序可能比"长但快"程序**实际**更糟.

### Speed Prior (Schmidhuber 2002)

**Schmidhuber 修正**: 程序的"先验"应考虑**计算速度**.

```
P(p) ∝ 2^(-|p| - log(fast(p)))
```

其中:
- |p| = 程序长度
- fast(p) = 程序运行时间

**意义 Implication**: **快 + 短** 的程序优于**短 + 慢**.

**实际效果 Practical implication**: 这解释了为什么大脑用**快速启发式**(认知偏差),而不是**最优算法**.大脑的"算法" 是速度优先的近似.

## Schmidhuber 的历史贡献 / Schmidhuber's Historical Contributions

### 1. LSTM (1997, with Hochreiter)

**Hochreiter & Schmidhuber 1997** *Long Short-Term Memory*.

**问题 Problem**: RNN 梯度消失,不能学长依赖.

**解决 Solution**: **门控机制** (input, forget, output gates) 控制信息流.

```
c_t = f_t ⊙ c_{t-1} + i_t ⊙ g_t
h_t = o_t ⊙ tanh(c_t)
```

**影响 Impact**:
- 2010s 翻译、语音识别的**核心技术**
- 被 Transformer (2017) 取代,但**思想**仍影响深层架构

### 2. Highway Network (2015, with Srivastava)

**Highway Network**: 最早提出**残差连接**(skip connection) 思想之一.

```
y = T(x) · H(x) + (1-T(x)) · x
```

T 是"门",决定用 H(x) 还是 x.

**影响 Impact**: **直接启发 ResNet** (He et al. 2015, 更简化).ResNet 是 Transformer 深度训练的关键.

**争议 Controversy**: Schmidhuber 主张 ResNet 是 Highway 的简化,未充分引用.

### 3. World Models (2018, with Ha)

**Ha & Schmidhuber 2018** *World Models*.

**思想 Idea**: 用 VAE + MDN-RNN 学世界模型,在"梦境"训练 policy.

**意义 Significance**: Dreamer 系列 (Hafner 等) 的**先驱**.

### 4. Gödel Machine (2003)

**Schmidhuber 2003** *Gödel Machine*.

**核心主张 Core idea**: 一个能**自我修改**代码的系统,**只要**能**证明**修改有用.

```
1. 系统执行一个解释器 (interpreter)
2. 系统可以重写自己的代码
3. 但重写**必须** 通过一个"证明搜索"证明改进
4. 这保证每次修改都"改进"
```

**意义 Significance**: 这是**自指 self-reference**的优雅应用.也是"AI 自我改进"的**最早严肃理论**.

### 5. PowerPlay (2011)

**Schmidhuber 2011**: 一个**持续学习**框架.

**思想 Idea**: AI 持续"寻找有趣的新任务,解决它们".

**避免模式**: AI 不被"卡"在已知任务,持续扩展.

## Schmidhuber vs Hinton/LeCun/Bengio 的争议

### 历史冲突 Historical Conflict

**2015 ACM Turing Award**: Hinton, LeCun, Bengio 共同获奖.

**Schmidhuber 不满**: 主张自己也有重要贡献(LSTM, Highway, World Models).

**2015-on**: Schmidhuber 多次公开**质疑** Turing Award 公正性.

### 论据 Schmidhuber's Arguments

1. **LSTM (1997)**: 引用 > 100,000 次,深度学习基础之一
2. **Highway Network (2015)**: 残差连接先驱
3. **World Models (2018)**: 模型预测控制先驱
4. **理论贡献**: AIT, Speed Prior, Gödel Machine

### 反方 Counter-arguments

1. **LSTM**: 1997 写出,但 2014-2015 才流行(因 Sutskever 等应用)
2. **Highway vs ResNet**: ResNet 独立发展,简化更优雅
3. **Hinton/LeCun/Bengio**: 在"寒冬"中坚持神经网络,贡献更大

### 评价 Assessment

**主流共识 Mainstream consensus**:
- Schmidhuber **确实有重大贡献**
- 但 Hinton/LeCun/Bengio 的**综合贡献**(深度学习复兴)更大
- Schmidhuber 的**公开争论** 部分被理解为**酸葡萄**

## 压缩主义作为 AGI 路径 / Compressionism as AGI Path

### 当前实验进展 Current Progress

#### LLM 作为压缩器

**DeepMind 2023 实验**: 用 Chinchilla 70B 压缩文本,**接近** 专用压缩器.

**结论 Conclusion**: LLM 训练**就是**压缩.

#### Google-Docs "ZIP 压缩器"

**2024**: Google 用 LLM 压缩技术优化 Chrome、Android 体积.

#### Schmidhuber 自己的实验

**2010s**: Schmidhuber 团队训练 RNN 压缩 Wikipedia, 显示 RNN "学到了" 语言结构.

### 压缩主义的批评 Criticisms

#### 批评 1: 形式 vs 意义

LLM 压缩**语言形式**,但**不一定** 学**意义**.

**反批 Rebuttal**: Schmidhuber 说"形式 = 意义",没有区分.

#### 批评 2: 相关 vs 因果

压缩学**相关**,不学**因果**.

**反批 Rebuttal**: Schmidhuber 主张"完美压缩" 必须学因果(否则无法最短描述).

#### 批评 3: 上下文限制

LLM 压缩限于**训练数据**.训练外无效.

**反批 Rebuttal**: 真正的压缩器(如人类)能**外推** extrapolate.

#### 批评 4: 计算不可约性

Wolfram: 某些复杂系统无法"跳过"计算.压缩不能解决.

**反批 Rebuttal**: Schmidhuber: Speed Prior 允许近似.

## Speed Prior 和大脑 / Speed Prior and the Brain

**主张 Claim**: 大脑符合 Speed Prior,不是 Solomonoff.

**证据 Evidence**:
- 认知偏差(快速但不精确)
- 启发式推理(Kahneman 系统 1)
- 大脑功耗 20W(必须高效)

**意义 Implication**: AI 应该模仿 Speed Prior, 不是 Solomonoff.这可能解释 LLM 的"推理失败"——它们没考虑速度.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 训练本质是压缩**
   预测下一 token = 最大化似然 = 最优压缩. Schmidhuber 1990s 主张,2020s 被 DeepMind 实验验证.
   > LLM training is compression (Schmidhuber's 1990s claim, DeepMind 2023 verified).

2. **"压缩即智能" 是范式问题,不是工程问题**
   Schmidhuber 主张: **继续优化压缩,自然到 AGI**.LeCun/Pearl 反对: 压缩不够,需要世界模型/因果.
   > Is "compression = intelligence" enough for AGI? Schmidhuber: yes. LeCun/Pearl: no.

3. **Schmidhuber 的 Speed Prior 是被忽视的洞察**
   主流关注 Solomonoff.但大脑用 Speed Prior.AI 设计可能也应该用 Speed Prior.
   > Speed Prior is overlooked insight. Brain uses Speed Prior. AI should too.

4. **范式思考**: 压缩能否产生**理解**?
   这是 Schmidhuber vs Pearl/LeCun 的核心分歧:
   - Schmidhuber: 压缩 = 理解(同义)
   - Pearl: 压缩 + 因果 = 理解
   - LeCun: 压缩 + 抽象表示 = 理解
   
   没有定论.**这是未来 10 年最重要的问题之一**.
   > Compression = understanding? Schmidhuber: yes. Pearl: need causality. LeCun: need abstraction. Open question, defining next decade.

## 关键问题 / Questions

1. "压缩即智能" 的反例是什么? / What are counter-examples to "compression = intelligence"?
2. Speed Prior 能解释大脑的认知偏差吗? / Can Speed Prior explain cognitive biases?
3. 如果 Schmidhuber 的 LSTM/Highway 贡献被公认,Turing Award 应该如何? / If Schmidhuber's contributions were recognized, how should Turing Award change?
4. 压缩能否解决 LLM 的幻觉问题? / Can compression solve LLM hallucination?

## 推荐资源 / Resources

- 论文 / Paper: Schmidhuber (2014) *Deep Learning in Neural Networks: An Overview* — 历史 / History
- 论文 / Paper: Hochreiter & Schmidhuber (1997) *LSTM*
- 论文 / Paper: Schmidhuber (2002) *Hierarchies of Time Scales and Speed Prior*
- 论文 / Paper: Schmidhuber (2003) *Gödel Machine*
- 视频 / Video: **Schmidhuber Lex Fridman Interview 2022**
- 网站 / Website: [schmidhuber.ai](http://people.idsia.ch/~juergen/)

---

参见 / See also: [[kolmogorov-complexity]], [[information-theory]], [[lecun-jepa]]
