---
title: Kolmogorov 复杂度 · Kolmogorov Complexity
type: concept
phase: 6
tags: [kolmogorov, complexity, compression, randomness, chaitin]
created: 2026-07-21
language: zh-CN
---

# Kolmogorov 复杂度 · Kolmogorov Complexity

> **学习目标 / Learning Objectives**
> - 理解"算法复杂度"与"计算复杂度"的根本不同 / Understand algorithmic vs computational complexity
> - 掌握 Kolmogorov 复杂度的定义和不可计算性 / Master definition and uncomputability
> - 看到"压缩即智能"主张的数学根源 / See the mathematical root of "compression is intelligence"

## 三种复杂度 / Three Kinds of Complexity

### 1. 计算复杂度 Computational Complexity (Big-O)
问 / Asks: "**运行多快?**" (见 [[big-o-notation]])
- 排序 n 个数: O(n log n)
- 矩阵乘法: O(n³) → Strassen O(n^2.81)

### 2. 描述复杂度 Kolmogorov Complexity
问 / Asks: "**最短程序多长?**"
- 字符串 "010101010101...01" (1000 次 01): 程序 "print '01' * 500" 很短
- 字符串 "4c1k5h...8w2n" (随机 1000 字符): 最短程序就是"打印这个字符串",很长

### 3. 计算复杂度空间/时间
问 / Asks: "**用多少内存/时间?**"

**本文聚焦**: **Kolmogorov 复杂度**,又称**算法信息论 Algorithmic Information Theory (AIT)**.

## Kolmogorov 复杂度的定义 / Definition

**Kolmogorov 复杂度 K(x)**: 字符串 x 的最短程序长度(在固定通用图灵机 U 上).

```
K_U(x) = min{|p| : U(p) = x}
```

- |p| 是程序 p 的长度
- U 是固定的通用图灵机(编程语言,如 Python)
- K(x) 是"用 Python 打印 x 的最短代码长度"

**关键 Critical**: K(x) **不依赖于具体 U**,差不超过一个常数(因为任何 U 可模拟任何其他 U',只需一段解释器).所以"K 复杂度"是一个**不变量**.

### 不变性定理 Invariance Theorem (Kolmogorov 1965)

**定理 Theorem**: 对任意两个通用图灵机 U 和 V,存在常数 c(U,V) 使得对所有 x:

```
|K_U(x) - K_V(x)| ≤ c(U,V)
```

**含义 Implication**: K(x) 在渐近意义上是"客观"的,不依赖于具体计算模型.

> K(x) is asymptotically "objective" — independent of specific computation model.

## 条件 Kolmogorov 复杂度 / Conditional Kolmogorov Complexity

**K(x | y)**: 给定 y 作为输入,最短打印 x 的程序长度.

**应用 Applications**:
- **互信息**: I(x;y) = K(x) + K(y) - K(x,y) ≈ K(x | y) + K(y) (对称)
- **MDL 原则 Minimum Description Length**: 模型选择

## 随机性的定义 / Defining Randomness

### 经典概率论的困境 / Classical Probability's Problem

**问题 Question**: 字符串 A 和 B 哪个"更随机"?

```
A = "01010101010101010101010101010101"  (32 字符)
B = "4c1b7a83f2e905b6d1e8a7c4f30b2e9f"  (32 字符)
```

**概率论回答 Probability's answer**: 两个等概率(都是 (1/2)³²).概率上**一样随机**.

**直觉回答 Intuition's answer**: A 明显有模式,B 才像随机.

### Martin-Löf 随机性 Martin-Löf Randomness (1966)

**Per Martin-Löf** 用 K(x) 定义随机:

**x 是 K-随机的 ⟺ K(x) ≥ |x| - c** (差常数 c 内"无法压缩")

**含义 Implication**:
- A: K(A) ≈ log₂(32) ≈ 5 bit (程序"print '01' * 16") → **非随机**
- B: K(B) ≈ 128 bit (无法压缩) → **随机**

**这就是"真随机"的数学定义**.

> This is the mathematical definition of "truly random": incompressible.

## Kolmogorov 复杂度不可计算 / K is Uncomputable

### 证明 Proof (反证法)

**假设**: K(x) 可计算.

**构造 Construct**: 程序 P(n) 遍历所有字符串 s,找第一个 K(s) > n 的串,输出 s.

**矛盾 Contradiction**:
- P(n) 的长度 ≈ log₂ n + c(常数)
- 但 P(n) 输出的 s 满足 K(s) > n
- 而 P(n) 自己就是生成 s 的程序,长度 ≈ log n + c
- 对大 n: log n + c < n,即 K(s) ≤ log n + c < n,与 K(s) > n 矛盾.

**结论**: K(x) **不可计算**.

**含义 Implication**:
- 没有通用算法找"最短描述"
- ZIP 等只能**近似**(找到次优压缩)
- "完美压缩"在数学上不可能

### Chaitin 常数 Chaitin's Constant Ω

**Gregory Chaitin** 定义常数:

```
Ω = Σ over all halting programs p of 2^(-|p|)
```

**性质**:
- Ω 是一个具体的实数(取决于 U)
- Ω 的二进制前 n 位编码了所有 ≤ n 位程序的停机信息
- 所以**确定 Ω 的前 n 位**等价于解决 ≤ n 位程序的停机问题
- Ω 是**算法随机**的: K(Ω 前 n 位) ≥ n - c

**哲学意义 Philosophical**: Ω 是一个"具体定义"的实数,但**本质上不可计算**,甚至**不可逼近**(除极少数位).

## 三大独立发现 / Three Independent Discoveries

| 发现者 Discoverer | 年份 | 称谓 |
|----|----|----|
| Ray Solomonoff | 1960 | 普遍概率分布 Universal Probability |
| Andrey Kolmogorov | 1965 | 算法复杂度 Algorithmic Complexity |
| Gregory Chaitin | 1966 | 算法信息论 Algorithmic Information |

**三人独立提出相同概念**,又一次"英雄所见略同"(类似阶段 6 三人独立提出可计算性).

## MDL 原则 Minimum Description Length

**Solomonoff 归纳推理 Solomonoff Induction**:
对未知数据 x,最可能的延续是**最短程序生成 x 的延续**.

**公式**:
```
P(continuation y | x) ≈ Σ over programs p with p → xy of 2^(-|p|)
```

**含义 Implication**:
- "奥卡姆剃刀"被数学化: 最短解释最可能正确
- 但 Solomonoff 归纳**不可计算**(因为 K 不可计算)
- 所有 ML 算法都是 Solomonoff 归纳的可计算**近似**

**这就是"压缩即智能"的精确数学版本**.

> "Compression = intelligence" = Solomonoff induction, the mathematically precise version of Occam's razor.

## 实际应用 / Practical Applications

### 1. 深度学习中的 MDL

好的神经网络:**参数少 + 拟合数据**.权重衰减、Dropout、架构搜索都是 MDL 的启发.

### 2. LLM 作为压缩器

LLM 预测下一 token,等价于**算术编码 arithmetic coding** 的概率模型.好的 LLM = 好的压缩器.

**DeepMind 2023 实验**: 用 Chinchilla 70B 压缩 text,效果接近专用压缩器.但**对图像/音频**效果差(因为 LLM 不是图像的最佳先验).

### 3. 程序合成 Program Synthesis

用 K(x) 评估生成的程序:"最短的能做 X 的程序"是最有可能是正确的.

### 4. AI 安全/对齐

"AI 的目标函数最短描述是什么?" 是 AI 安全的核心问题(Yudkowsky 等讨论).

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 的"智能"= 其训练数据的可压缩性**
   LLM 学到了大量模式,所以它**对自己训练过的数据**预测好(压缩好).但对训练数据**外**的数据(分布外),它**不能**预测好.这正是泛化问题.
   > LLM intelligence = compression of training data. Out-of-distribution = no compression.

2. **"压缩即智能"的 Ilya 论点**
   Ilya Sutskever 多次说:"如果你能预测下一 token 足够好,你就**理解**了."这是 Solomonoff 归纳的现代版本.**但**这个论点有问题:
   - 理解 ≠ 高 K 多样性
   - LLM 可能"记住"而没"理解"
   - 真正的 Solomonoff 归纳需要**无穷**计算
   > Sutskever: predict → understand. Modern Solomonoff. But issues: understanding ≠ diversity, memory ≠ understanding, true Solomonoff needs infinite compute.

3. **LLM 不是"算法随机"的**
   LLM 的权重是高维浮点向量,但有大量结构(剪枝、量化、稀疏化都有效).所以 LLM 是**可压缩的**,不是"最优随机权重".
   > LLM weights are compressible (pruning, quantization work). Not algorithmically random.

4. **范式思考**: 完美的智能是否就是完美的压缩?
   Solomonoff 归纳给出了"理想智能"的数学定义.**但它不可计算**.所以任何**实际** AI(包括 LLM、JEPA、符号 AI)都只能是近似.这意味着:**"超级智能"在数学上有上界(Solomonoff),任何实际 AI 都低于这个上界**.
   > Perfect intelligence = perfect compression (Solomonoff). But uncomputable. Any actual AI (LLM, JEPA, symbolic) is approximation. There's a mathematical ceiling for "superintelligence."

## 关键问题 / Questions

1. 为什么 Kolmogorov 复杂度不可计算?这个不可计算能绕过吗? / Why is K uncomputable? Can we bypass it?
2. LLM 的"压缩比"如何衡量?如何用它评估模型? / How to measure LLM "compression ratio"? How to use for evaluation?
3. Solomonoff 归纳的"不可计算"对 AGI 意味着什么? / What does Solomonoff's uncomputability mean for AGI?
4. 如果"理解 = 压缩",LLM 能理解"素数有无穷多个"吗? / If "understanding = compression", does LLM understand "infinitely many primes"?

## 推荐资源 / Resources

- 书 / Book: Ming Li & Paul Vitányi *An Introduction to Kolmogorov Complexity and Its Applications* — 圣经 / The bible
- 书 / Book: Gregory Chaitin *Meta Math!* — 个人化探索 / Personal exploration
- 书 / Book: James Gleick *The Information* 第 12 章 / Chapter 12
- 论文 / Paper: Solomonoff (1960), Kolmogorov (1965), Chaitin (1966)
- 视频 / Video: **Marcus Hutter "Universal Artificial Intelligence"**

---

参见 / See also: [[information-theory]], [[turing-machine]], [[halting-problem]]
