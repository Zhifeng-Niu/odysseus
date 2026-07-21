---
title: 信息论 · Shannon Information Theory
type: concept
phase: 6
tags: [shannon, information-theory, entropy, channel-capacity]
created: 2026-07-21
language: zh-CN
---

# 信息论 · Shannon Information Theory

> **学习目标 / Learning Objectives**
> - 理解 Shannon 熵作为信息的数学度量 / Understand Shannon entropy as mathematical measure of information
> - 掌握信道容量和无噪编码定理 / Master channel capacity and noiseless coding theorem
> - 看到信息论是 LLM(以及所有机器学习)的隐性基石 / See information theory as the hidden foundation of LLMs and all ML

## Claude Shannon (1948)

**克劳德·香农 Claude Shannon** 在 1948 年论文 *A Mathematical Theory of Communication* 中**创立**了信息论.

**关键洞察 Key insight**: 把"信息"作为可量化的物理量,就像质量、能量.

**之前 Before Shannon**: 通信工程是经验性的,信号传输靠试错.
**之后 After Shannon**: 通信变成精确科学,有数学定律.

## 信息的度量: Shannon 熵 / Measuring Information: Shannon Entropy

### 一个事件的"惊讶度" / Surprise of an Event

**直觉 Intuition**: 一个事件越**不可能**,它的发生就携带**越多**信息.

- 太阳从东边升起(概率 1)→ 0 信息(毫无惊讶)
- 骰子掷出 3(概率 1/6)→ 一些信息
- 彩票中头奖(概率 1/10000000)→ 巨量信息

**数学形式 / Mathematical form**:

```
I(x) = -log₂ p(x)   bits
```

- 概率 1/2 → 1 bit
- 概率 1/4 → 2 bits
- 概率 1/2ⁿ → n bits

### Shannon 熵 Shannon Entropy

**随机变量 X 的熵 H(X)**: 所有事件的**平均惊讶度**.

```
H(X) = -Σ p(x) log₂ p(x)   bits
```

**例 Examples**:

| 分布 Distribution | 熵 H |
|----|----|
| 公平硬币 Fair coin | 1 bit |
| 不公平 (0.99, 0.01) | 0.08 bit |
| 公平骰子 Fair die | log₂ 6 ≈ 2.58 bit |
| 32 个等概率字符 | 5 bit |
| 英文文本(字母) | ≈ 1.0-1.5 bit/字符 (远小于 log₂ 26 ≈ 4.7) |

**最大熵 Max entropy**: 等概率分布时 H 最大 = log₂ n.

### 熵与压缩 / Entropy and Compression

**无噪编码定理 Noiseless Coding Theorem (Shannon 1948)**:
要无损编码 X 的每个样本,**平均**至少需要 H(X) bit.

**含义 Implication**: 英文文本理论上可压缩到 ~25% 大小(因为 H ≈ 1 bit/4.7 bit).实际 ZIP 大致达到这个效率.

**这就是为什么 ZIP 能压缩 / Why ZIP works**:
- 文本有冗余,熵低 → 可压缩
- 随机数据(如已加密的)熵高 → 无法压缩
- 你"压缩"一个已压缩文件,大小几乎不变(熵已最大化)

## 联合熵与条件熵 / Joint and Conditional Entropy

### 联合熵 Joint Entropy

```
H(X, Y) = -ΣΣ p(x,y) log₂ p(x,y)
```

两个随机变量**一起**的不确定性.

### 条件熵 Conditional Entropy

```
H(Y | X) = Σ p(x) H(Y | X=x)
```

**已知 X** 后, Y 还剩的不确定性.

**链式法则 Chain rule**: H(X, Y) = H(X) + H(Y | X).

## 互信息 Mutual Information

**互信息 I(X; Y)**: 知道 X 后,对 Y 的不确定性的**减少量**.

```
I(X; Y) = H(Y) - H(Y | X) = H(X) - H(X | Y)
```

**性质 Properties**:
- I(X; Y) = I(Y; X) 对称
- I(X; Y) ≥ 0
- I(X; X) = H(X)

**应用 Applications**:
- 特征选择 feature selection
- VAE 的 ELBO
- InfoNCE loss(对比学习)
- LLM 训练目标(下一 token 预测 = 最大化 H(next | context))

## KL 散度 / KL Divergence

**Kullback-Leibler 散度 / KL 散度**: 衡量两个分布 p 和 q 的"差异".

```
D_KL(p || q) = Σ p(x) log [p(x) / q(x)]
```

**性质**:
- D_KL ≥ 0
- D_KL(p || q) ≠ D_KL(q || p) (不对称)
- D_KL(p || p) = 0

**在 ML 中 In ML**:
- 交叉熵损失 Cross-entropy loss = H(p) + D_KL(p || q)
- 训练 LLM 就是减小 D_KL(data || model)
- KL 散度作为 RLHF 中的"信任约束"(防止 policy 远离 reference)

## 信道容量 / Channel Capacity

**信道 Channel**: 传输信息的媒介(电线、光纤、空气).

**香农-哈特利定理 Shannon-Hartley Theorem**:

```
C = W log₂(1 + S/N)
```

- C = 信道容量(bps)
- W = 带宽(Hz)
- S = 信号功率
- N = 噪声功率

**含义 Implication**: 在有噪信道上,**理论上**可以以低于 C 的速率**无错**传输.超过 C,不可能无错.

### 香农极限 Shannon Limit

**重大洞察 Big Insight**: 噪声信道**不必**导致错误,只要速率 ≤ C.通过**纠错码**(如 LDPC、Turbo Code、Polar Code),可以逼近 C.

**影响 Impact**:
- 5G 用 Polar 码(华裔学者 Erdal Arıkan 2009 发明)
- Wi-Fi 用 LDPC
- 深空通信(NASA Voyager)用级联码

## 信息论与物理 / Information Theory and Physics

### Landauer 原理 Landauer's Principle (1961)

**Rolf Landauer**: 擦除 1 bit 信息(逻辑不可逆操作)在温度 T 下至少耗散:

```
E_min = kT ln(2)  ≈ 3 × 10⁻²¹ J  (室温)
```

**深刻含义 Deep implication**: 信息是**物理的**.计算不是抽象数学,而是物理过程,受热力学约束.

**对 AI 芯片的影响 / For AI chips**:
- 现代 GPU 功耗 ~ 700W,远高于 Landauer 极限
- 但 Landauer 极限设定了**最终物理下限**
- 量子计算必须可逆才能避免 Landauer 极限

### Black Hole Information Paradox

黑洞信息悖论(见阶段 9 [[friston-active-inference]] / 物理学延伸): 信息是否会随黑洞蒸发而消失?

**主流现代观点 Modern consensus** (Susskind 等): 信息守恒,但表面看起来丢失.涉及 holographic principle.

### Maxwell's Demon

1867 年的思想实验: 一个 demon 用分子分选降低系统熵,违反热力学第二定律.

**解法 Resolution**: Demon 自己需要存储信息,擦除这些信息时释放热量(Landauer 原理),总熵不减少.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 训练 = 压缩**
   训练 LLM 预测下一 token,等效于**对训练数据做压缩**(Shannon 1948 就预言了).好的语言模型 → 低交叉熵 → 高压缩比.这是 Schmidhuber "压缩即智能"的数学根源.
   > Training LLMs = compression. Good LM → low cross-entropy → high compression ratio. Root of "compression is intelligence."

2. **InfoNCE 与对比学习**
   SimCLR、CLIP 用 InfoNCE 损失 = 最大化正样本互信息 + 最小化负样本互信息.这是 LeCun JEPA 范式(见阶段 9 [[lecun-jepa]])的核心.
   > Contrastive learning = InfoNCE = maximize positive MI, minimize negative. Core of LeCun's JEPA.

3. **RLHF 的 KL 约束**
   PPO 微调 LLM 时,加入 D_KL(policy || reference) 作为约束.这防止 LLM 为了"奖励"而输出怪异 token.信息论直接指导 RLHF.
   > PPO uses KL divergence to prevent policy drifting too far from reference.

4. **"压缩即智能" 的根源 = 信息论**
   Ilya Sutskever 多次提到:"Predict next token well enough → you understand." 这本质上是说:**好的预测器 = 好的压缩器 = 好的世界模型**.这是 Kolmogorov 复杂度(见 [[kolmogorov-complexity]])和 Shannon 熵的联合洞察.
   > Sutskever: "Predict next token well → understand." Good predictor = good compressor = good world model.

5. **范式思考**: 信息是"物理性"的吗?
   Landauer 原理说**是**.这意味着计算、学习、智能都受热力学约束.这是反对"AI 在理论上无敌"的最深论据之一——AI 受物理定律限制,包括信息物理极限.
   > Information is physical (Landauer). Computation, learning, intelligence are all thermodynamically constrained.

## 关键问题 / Questions

1. 为什么英文文本熵只有 ~1 bit/字符,远小于 log₂ 26? / Why is English entropy ~1 bit/char, far below log₂ 26?
2. ZIP 压缩已经达到 Shannon 极限吗? / Does ZIP reach Shannon limit?
3. RLHF 的 KL 约束设为 0 会怎样? / What if KL constraint = 0 in RLHF?
4. 如果"压缩即智能",最聪明的 AI 是否就是最好的压缩器? / If "compression = intelligence", is the smartest AI just the best compressor?

## 推荐资源 / Resources

- 书 / Book: James Gleick *The Information* — 通俗史 / Accessible history
- 书 / Book: Cover & Thomas *Elements of Information Theory* — 标准教材 / Standard textbook
- 论文 / Paper: Shannon (1948) *A Mathematical Theory of Communication*
- 视频 / Video: **MIT 6.441 Information Theory** (公开课)
- 博客 / Blog: **"Information Theory Primer for Machine Learning"**

---

参见 / See also: [[kolmogorov-complexity]], [[shannon-limit]], [[turing-machine]]
