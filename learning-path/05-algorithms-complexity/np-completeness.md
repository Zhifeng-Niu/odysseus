---
title: NP 完全性与归约 · NP-Completeness and Reductions
type: concept
phase: 5
tags: [np-complete, reductions, cook-levin]
created: 2026-07-21
language: zh-CN
---

# NP 完全性与归约 · NP-Completeness and Reductions

> **学习目标 / Learning Objectives**
> - 掌握归约(reduction)作为证明复杂度的核心工具 / Master reduction as the core complexity proof tool
> - 理解 Cook-Levin 定理:所有 NP 问题归约到 SAT / Understand Cook-Levin theorem
> - 看到归约思想在 LLM 中的反映 / See reduction thinking in LLMs

## 归约 Reduction

**归约 reduction**: 把问题 A 转化为问题 B 的多项式时间算法. 记作 A ≤_p B.

> **Reduction**: polynomial-time algorithm transforming problem A into problem B. Written A ≤_p B.

**含义 Meaning**: "如果 B 容易,则 A 也容易" 或 "B 至少和 A 一样难".

```
A 的实例 instance of A
     ↓ 多项式归约 poly reduction
B 的实例 instance of B
     ↓ B 的求解器 B solver
B 的解 solution of B
     ↓ 多项式还原 poly reverse
A 的解 solution of A
```

**关键 Critical**: A ≤_p B **且** B ∈ P → A ∈ P.

## 第一个 NP-Complete 问题: Cook-Levin 定理

**Cook-Levin 定理 (1971)**: **SAT 是 NP-Complete**.

**证明直觉 Proof intuition**:
- 任何 NP 问题 X 都能被非确定性图灵机 M 在多项式时间内求解
- 把 M 的整个执行过程编码为布尔公式
- "M 接受输入" ⇔ 公式可满足
- 编码过程是多项式时间

**影响 Impact**: 第一次给出 NPC 的具体例子. 之后所有 NPC 证明都从 SAT 归约.

> First concrete NPC example. All subsequent NPC proofs reduce from SAT.

## 经典归约链 Classic Reduction Chain

```
SAT (Cook-Levin 1971)
  ↓
3-SAT (限制子句长度 3)
  ↓
CLIQUE (团问题)
  ↓
VERTEX COVER (顶点覆盖)
  ↓
HAMTONIAN CYCLE (哈密顿回路)
  ↓
TSP (旅行商)
```

**每个箭头都是多项式归约**. 所以这些全是 NPC.

## 归约示例: 3-SAT ≤_p VERTEX COVER

**目标 Goal**: 证明 Vertex Cover (VC) 至少和 3-SAT 一样难.

**3-SAT 实例 Instance**: (x₁ ∨ ¬x₂ ∨ x₃) ∧ (¬x₁ ∨ x₂ ∨ x₃) ∧ ...

**构造 Construction**:
- 对每个变量 x_i, 创建两个顶点 (x_i 和 ¬x_i), 用一条边连接
- 对每个子句 c_j = (l₁ ∨ l₂ ∨ l₃), 创建一个三角形, 3 个顶点对应 3 个文字
- 把每个文字顶点连接到对应子句的对应顶点

**目标 target k** = (变量数) + 2 × (子句数)

**性质 Property**: 3-SAT 可满足 ⇔ 构造的图有大小 ≤ k 的顶点覆盖.

**直觉 Intuition**:
- 选 x_i 或 ¬x_i 覆盖"变量边"
- 每个子句三角形必须至少 1 个顶点不被选 → 这对应"该文字为真" → 子句被满足

这是经典归约,展示了**如何用图问题编码逻辑问题**.

## NP-Hard 例子 Examples of NP-Hard

### 停机问题 Halting Problem

**问题**: 给定程序 P 和输入 x, P(x) 是否会停机?

**性质**: **不可判定 undecidable** —— 比 NP-Hard 更难(根本无法用任何算法解).

**图灵 1936 证明 Turing's 1936 proof**: 对角线方法 diagonal argument.

### GCD 是 P

```
function gcd(a, b):
    while b != 0:
        a, b = b, a % b
    return a
# O(log min(a,b))
```

## 实践中的 NPC: 不要绝望 / NPC in Practice

虽然 NPC 问题"理论难",但**实际中常用算法效果不错**:

| 算法 | 适用 Suitable | 性能 Performance |
|----|-----------|-------------|
| 分支定界 Branch & Bound | TSP, 整数规划 | 中等规模 ok |
| 启发式 Heuristics | TSP (Lin-Kernighan) | 工业可接受 |
| 近似算法 Approximation | 优化问题 | 有保证 |
| SAT 求解器 (CDCL) | SAT, SMT | 工业规模 |
| 局部搜索 Local Search | SAT, CSP | 实用 |

**关键 Critical**: "NPC" 不等于"无解". 只是"最坏情况指数". 实际案例常常可解.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 用归约思想"解决问题"**
   你问 LLM 一个新问题,它"归约"到见过的问题模式. 比如"如何分配会议室?"→ 归约到"图着色" → 给出方案. 但这种归约是**统计近似**,不是数学归约.
   > LLMs use reduction-like thinking: see new problem, "reduce" to known pattern. "Meeting room scheduling" → "graph coloring". But **statistical approximation**, not mathematical reduction.

2. **SAT 求解器 + LLM 的混合系统**
   学术方向: LLM 把自然语言转为 SAT 公式 → SAT 求解器算 → LLM 解释结果. 这种"神经符号"系统结合两者优势.
   > Academic direction: LLM converts NL to SAT formula → SAT solver → LLM explains result. "Neurosymbolic" system combines both.

3. **范式思考**: NPC 问题对大脑是否"难"?
   人类玩数独高手能秒解,但没见过的高维 NPC 问题,人类也卡. 大脑似乎对**特定 NPC 问题**有内置启发式.
   > Human Sudoku masters solve instantly, but unseen high-dim NPC problems stump humans. Brain seems to have built-in heuristics for **specific NPC problems**.

## 关键问题 / Questions

1. 给定问题 X,如何系统判断它是 P 还是 NPC? / Given problem X, systematic way to determine P vs NPC?
2. 归约的方向: A ≤_p B 和 B ≤_p A 含义不同. 区别是? / Reduction direction matters: A ≤_p B vs B ≤_p A. Difference?
3. 现代 SAT 求解器为什么能解百万变量?核心算法是? / Why can modern SAT solvers handle millions of variables? Core algorithm?
4. 大脑是"NPC 求解器"吗? / Is the brain an "NPC solver"?

## 推荐资源 / Resources

- 书 / Book: *Computers and Intractability* — Garey & Johnson
- 书 / Book: Sipser *Introduction to the Theory of Computation* 第 7-8 章 / Chapters 7-8
- 视频 / Video: *MIT 6.045* — Computational Complexity

---

参见 / See also: [[p-vs-np]], [[turing-machine]]
