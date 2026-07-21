---
title: 布尔代数 · Boolean Algebra
type: concept
phase: 2
tags: [boolean-algebra, logic, algebra, de-morgan]
created: 2026-07-21
language: zh-CN
---

# 布尔代数 · Boolean Algebra

> **学习目标 / Learning Objectives**
> - 理解布尔代数的公理与定理 / Understand the axioms and theorems of boolean algebra
> - 用布尔代数化简任意逻辑表达式 / Simplify any logic expression using boolean algebra
> - 掌握德摩根律:逻辑设计的"瑞士军刀" / Master De Morgan's laws: the "Swiss Army Knife" of logic design

> **关键术语 / Key Terms**
> - 布尔代数 Boolean algebra · 文字 Literal · 项 Term · 积之和 Sum of Products (SoP) · 和之积 Product of Sums (PoS) · 德摩根律 De Morgan's Law

## 布尔代数的起源 / Origin of Boolean Algebra

**1854 年,英国数学家 George Boole** 发表 *An Investigation of the Laws of Thought* (《思维规律的研究》),试图用代数描述人类逻辑。

> **In 1854, English mathematician George Boole** published *An Investigation of the Laws of Thought*, attempting to algebraically describe human logic.

Boole 不知道他的代数会在 90 年后成为现代计算机的基础。1937 年 Claude Shannon 在 MIT 硕士论文 *A Symbolic Analysis of Relay and Switching Circuits* 中**首次将布尔代数与电路设计结合**。

> Boole didn't know his algebra would underpin modern computers 90 years later. In 1937, Claude Shannon in his MIT master's thesis *A Symbolic Analysis of Relay and Switching Circuits* **first connected boolean algebra to circuit design**.

**这是一个关键的历史时刻**: 抽象数学 → 工程实践。Shannon 也因此被称作"信息论之父"。

> **This is a critical historical moment**: abstract math → engineering practice. Shannon is also called the "father of information theory."

## 布尔代数的基本元素 / Basic Elements

只有两种值 / Only two values:

- **0** (假 False)
- **1** (真 True)

三种基本运算 / Three basic operations:

| 运算 Operation | 符号 Symbol | C 语法 | 含义 Meaning |
|------------|---------|------|----------|
| 与 AND | `·` 或省略 omitted | `&` | "都真才真" Both true → true |
| 或 OR | `+` | `\|` | "任一真即真" Either true → true |
| 非 NOT | 上划线 overbar 或 `'` | `~` 或 `!` | "取反" Negate |

## 基本公理 / Basic Axioms

这些是布尔代数的"九九乘法表"。必须背到肌肉记忆。

> These are the "multiplication table" of boolean algebra. Must be memorized to muscle memory.

### 与的公理 / AND Axioms

```
0 · 0 = 0
0 · 1 = 0
1 · 0 = 0
1 · 1 = 1
```

### 或的公理 / OR Axioms

```
0 + 0 = 0
0 + 1 = 1
1 + 0 = 1
1 + 1 = 1    ← 注意!1 + 1 = 1,不是 2! / Note! 1 + 1 = 1, not 2!
```

### 非的公理 / NOT Axioms

```
0̄ = 1
1̄ = 0
```

## 重要定理 / Important Theorems

### 同一律 Identity

```
A + 0 = A
A · 1 = A
```

### 互补律 Complement

```
A + Ā = 1         (A OR NOT A is always true)
A · Ā = 0         (A AND NOT A is always false)
```

### 零元素 / 单位元素 Null / Domination

```
A + 1 = 1         (A OR 1 is always 1)
A · 0 = 0         (A AND 0 is always 0)
```

### 幂等律 Idempotence

```
A + A = A         (OR with self = self)
A · A = A         (AND with self = self)
```

### 对合律 Involution

```
Ā̄ = A            (NOT NOT A = A)
```

### 交换律 Commutative

```
A + B = B + A
A · B = B · A
```

### 结合律 Associative

```
(A + B) + C = A + (B + C)
(A · B) · C = A · (B · C)
```

### 分配律 Distributive

```
A · (B + C) = A·B + A·C        ← 这条与普通代数一样 / Same as ordinary algebra
A + (B · C) = (A + B) · (A + C)   ← 这条与普通代数不同!Different from ordinary algebra!
```

第二条是布尔代数独有的。试试 / Try the second:

```
A=1, B=0, C=0:
A + (B·C) = 1 + 0 = 1
(A+B)·(A+C) = (1+0)·(1+0) = 1·1 = 1 ✓
```

### 吸收律 Absorption

```
A + A·B = A              (A absorbs A·B)
A · (A + B) = A          (A absorbs A+B)
```

证明 Proof: `A + A·B = A·1 + A·B = A·(1+B) = A·1 = A`

### 德摩根律 De Morgan's Law ⭐

这是**最重要的定理**。所有复杂的逻辑化简都靠它。

> **The most important theorem**. All complex logic simplification relies on it.

```
──────     ─   ─
A · B = A + B          (NOT (A AND B) = NOT A OR NOT B)
                  
──────     ─   ─
A + B = A · B          (NOT (A OR B) = NOT A AND NOT B)
```

**口诀 Mnemonic**: "切一刀,反符号,逐位反" / "Break the bar, flip the operator, invert each operand"

**英文 English**: "Break the bar, change the sign, negate each."

### 德摩根律的物理意义 / Physical Meaning of De Morgan's Law

德摩根律告诉我们:**AND/OR/NOT 三者中,NOT 加上 AND 或 OR 中的任意一个,就够了**。这是为什么 NAND 和 NOR 是**通用门** —— 用单一门就能实现任意逻辑。

> De Morgan's law tells us: **Of AND, OR, NOT, we need NOT + (AND or OR)** — that's enough. This is why NAND and NOR are **universal gates** — single gate type implements any logic.

## 化简技巧 / Simplification Techniques

### 例 1:用德摩根律化简 / Example 1: Simplify Using De Morgan

化简 / Simplify: `(A + B) · (A + B̄)`

```
(A + B) · (A + B̄)
= A + (B · B̄)           ← 分配律 distributive
= A + 0                  ← 互补律 complement
= A                      ← 同一律 identity
```

这就是 `A OR B` AND `A OR NOT B` 永远等于 `A`。直觉:不管 B 是什么,只要 A=1 就是 1。

> That's why `A OR B` AND `A OR NOT B` always equals `A`. Intuition: regardless of B, if A=1, output is 1.

### 例 2:一致项 / Example 2: Consensus Term

化简 / Simplify: `A·B + Ā·C + B·C`

```
A·B + Ā·C + B·C
看看 B·C 这一项:
  如果 A=1, A·B=B·(1), B·C 是被 A·B 覆盖的部分
  如果 A=0, Ā·C=C·(1), B·C 是被 Ā·C 覆盖的部分
所以 B·C 总是被前两项覆盖,可以删除

= A·B + Ā·C
```

这叫**一致项定理 Consensus Theorem**。化简后逻辑等价,但电路更简单。

> This is the **Consensus Theorem**. After simplification, logic is equivalent but circuit is simpler.

## 标准形式:SoP 与 PoS / Standard Forms: SoP and PoS

### 积之和 Sum of Products (SoP)

形式 Form: `A·B + C·D̄ + E`

每个项叫**乘积项 product term**,所有项用 OR 连接。最直观,最常用。

> Each term is a "product term", connected by OR. Most intuitive, most common.

### 和之积 Product of Sums (PoS)

形式 Form: `(A + B) · (C + D̄) · E`

每个项叫**和项 sum term**,所有项用 AND 连接。

> Each term is a "sum term", connected by AND.

### 最小项 / 最大项 Minterms / Maxterms

**最小项 Minterm**: 包含所有变量的乘积项(原变量或反变量)
- 例:三变量 A, B, C 的最小项 `A·B̄·C`

**最大项 Maxterm**: 包含所有变量的和项
- 例:三变量 A, B, C 的最大项 `A + B̄ + C`

每个布尔函数可唯一表示为最小项之和(主析取范式)或最大项之积(主合取范式)。

> Every boolean function has a unique representation as sum of minterms (canonical Disjunctive Normal Form) or product of maxterms (Conjunctive Normal Form).

## 卡诺图:视觉化简 / Karnaugh Maps: Visual Simplification

卡诺图把布尔函数的真值表重排成 2D 网格,**相邻格子只差一个变量**。圈起连续的 1,即可看出化简结果。

> Karnaugh maps rearrange the truth table into a 2D grid where **adjacent cells differ by only one variable**. Circle contiguous 1s to see the simplified result.

```
        BC
        00  01  11  10
      ┌───┬───┬───┬───┐
   A=0 │ 1 │ 1 │ 0 │ 0 │
      ├───┼───┼───┼───┤
   A=1 │ 0 │ 1 │ 1 │ 0 │
      └───┴───┴───┴───┘

圈起 (A=0, BC=00) 和 (A=0, BC=01) → 两个相邻 → 结果 = Ā·B̄
圈起 (A=0, BC=01) 和 (A=1, BC=11) → 不相邻 → 不能圈
```

卡诺图最多处理 4-6 个变量。超过的需要 Quine-McCluskey 算法(计算机化简)。

> K-maps handle up to 4-6 variables. Beyond that, use Quine-McCluskey algorithm (computer simplification).

## 为什么布尔代数与 AI 相关? / Why Is Boolean Algebra Relevant to AI?

1. **LLM 的所有运算,最终都是布尔运算**
   浮点矩阵乘法 = 定点矩阵乘法 = 整数加法 = 整数加法器电路 = NAND 树。 
   > All LLM operations are ultimately boolean. Float matmul → fixed point → integer adder → NAND tree.

2. **量化 (Quantization)** 是把浮点计算压缩为低精度整数计算,本质是"减少参与布尔运算的位数"。从 FP32 → INT4,运算量减少 8 倍,但精度损失可接受。
   > Quantization compresses float ops to low-precision int ops — fundamentally "reducing bits in boolean ops". FP32 → INT4 = 8× less computation, acceptable precision loss.

3. **布尔可满足性 (SAT)** 是 NP 完全问题的代表性问题。所有 NP 问题最终都可以化为 SAT。LLM 的"推理"如果真是"推理",本质上是在做 SAT 求解 —— 但目前 LLM 用概率方法而非真逻辑求解。
   > Boolean Satisfiability (SAT) is the canonical NP-complete problem. All NP problems reduce to SAT. If LLM "reasoning" were truly reasoning, it would essentially solve SAT — but currently LLMs use probabilistic methods, not real logic.

4. **符号 AI (GOFAI)** 整个范式就是用布尔代数 + 一阶逻辑做推理。它的失败不是布尔代数本身的失败,而是"符号接地问题"(symbol grounding problem) —— 符号与物理世界脱节。
   > Symbolic AI (GOFAI) is entirely about boolean algebra + first-order logic. Its failure is not boolean algebra's failure but the "symbol grounding problem" — symbols disconnected from physical reality.

## 关键问题 / Questions

1. 化简: `A·B + A·B̄ + Ā·B + Ā·B̄`. 答案应当让你感到惊讶。/ Simplify: `A·B + A·B̄ + Ā·B + Ā·B̄`. The answer should surprise you.
2. 证明或反驳: `A · (B ⊕ C) = (A·B) ⊕ (A·C)` (其中 ⊕ 是 XOR). / Prove or disprove.
3. 用德摩根律,只用 NAND 门实现 3 输入 AND. / Use De Morgan to implement 3-input AND using only NAND.
4. 卡诺图化简: `F(A,B,C,D) = Σ(0,1,2,5,8,9,10)`. / K-map simplification.

## 推荐资源 / Resources

- 书 / Book: *Digital Design* — Mano
- 视频 / Video: *Neso Academy* YouTube — 数字电子学系列 / Digital Electronics series
- 工具 / Tool: **Logisim** — 实时验证化简结果 / Real-time verification

---

参见 / See also: [[binary-and-hex]], [[logic-gates]]
