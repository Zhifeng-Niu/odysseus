---
title: 逻辑门 · Logic Gates
type: concept
phase: 2
tags: [logic-gates, nand, nor, universal-gate, circuit]
created: 2026-07-21
language: zh-CN
---

# 逻辑门 · Logic Gates

> **学习目标 / Learning Objectives**
> - 熟悉所有基本逻辑门的符号、真值表、电路图 / Be familiar with all basic logic gates: symbols, truth tables, circuits
> - 理解为什么 NAND (和 NOR) 是通用门 / Understand why NAND (and NOR) are universal gates
> - 用单一 NAND 门构建任意逻辑 / Build any logic using only NAND

> **关键术语 / Key Terms**
> - 与门 AND gate · 或门 OR gate · 非门 NOT gate (反相器 inverter) · 与非 NAND · 或非 NOR · 异或 XOR · 同或 XNOR · 通用门 Universal gate

## 基本逻辑门 / Basic Logic Gates

### 非门 (反相器) NOT Gate (Inverter)

**功能 Function**: 输出 = 输入的取反 / Output = inverted input

**真值表 Truth Table**:
| A | Y |
|---|---|
| 0 | 1 |
| 1 | 0 |

**符号 Symbol**: 三角形 + 末端小圆圈 / Triangle with bubble

**布尔表达式 Boolean**: Y = Ā

**CMOS 实现 CMOS Implementation**:
```
       V_DD
         |
       [PMOS]  ← 输入 A 接 PMOS 栅极
         |
         ├────→ 输出 Y = Ā
         |
       [NMOS]  ← 输入 A 接 NMOS 栅极
         |
        GND
```

### 与门 AND Gate

**功能 Function**: 所有输入都为 1,输出才为 1 / All inputs 1 → output 1

**真值表 Truth Table** (2 输入 / 2-input):
| A | B | Y |
|---|---|---|
| 0 | 0 | 0 |
| 0 | 1 | 0 |
| 1 | 0 | 0 |
| 1 | 1 | 1 |

**布尔表达式 Boolean**: Y = A · B

**符号 Symbol**: D 形 / D-shape

**实现 Implementation**: NAND + NOT

### 或门 OR Gate

**功能 Function**: 任一输入为 1,输出为 1 / Any input 1 → output 1

**真值表 Truth Table**:
| A | B | Y |
|---|---|---|
| 0 | 0 | 0 |
| 0 | 1 | 1 |
| 1 | 0 | 1 |
| 1 | 1 | 1 |

**布尔表达式 Boolean**: Y = A + B

**符号 Symbol**: 弯曲 D 形 / Curved D-shape

## 复合门 / Compound Gates

### 与非门 NAND Gate ⭐

**功能 Function**: AND 的输出取反 / AND output inverted

**真值表 Truth Table**:
| A | B | Y |
|---|---|---|
| 0 | 0 | 1 |
| 0 | 1 | 1 |
| 1 | 0 | 1 |
| 1 | 1 | 0 |

**布尔表达式 Boolean**: Y = ¬(A · B) = A NAND B

**符号 Symbol**: AND 符号 + 末端小圆圈 / AND symbol with bubble

**⭐ 重要 Important**: NAND 是**通用门 Universal Gate**。任意逻辑都能用单一 NAND 实现。

> **⭐ Important**: NAND is the **Universal Gate**. Any logic can be implemented using only NAND.

### 或非门 NOR Gate ⭐

**功能 Function**: OR 的输出取反 / OR output inverted

**真值表 Truth Table**:
| A | B | Y |
|---|---|---|
| 0 | 0 | 1 |
| 0 | 1 | 0 |
| 1 | 0 | 0 |
| 1 | 1 | 0 |

**布尔表达式 Boolean**: Y = ¬(A + B)

NOR 也是通用门。但工业界更多用 NAND,因为 NMOS 串联比 PMOS 串联快(NMOS 电子迁移率高)。

> NOR is also universal. But industry prefers NAND because NMOS series is faster than PMOS series (higher electron mobility).

### 异或门 XOR Gate

**功能 Function**: 输入不同为 1,相同为 0 / Different inputs → 1

**真值表 Truth Table**:
| A | B | Y |
|---|---|---|
| 0 | 0 | 0 |
| 0 | 1 | 1 |
| 1 | 0 | 1 |
| 1 | 1 | 0 |

**布尔表达式 Boolean**: Y = A ⊕ B = A·B̄ + Ā·B

**符号 Symbol**: OR 符号 + 双弯线 / OR symbol with double curve

**为什么 XOR 重要 / Why XOR matters**:
- 加法器的核心: 1 + 0 = 1, 0 + 1 = 1, 但 1 + 1 = 10 (即 SUM 位为 0)
- XOR 正好实现"和位 sum bit"
- 加法是计算的基石 → XOR 是计算的基石

### 同或门 XNOR Gate

XOR + NOT。相等比较器。

> XOR + NOT. An equality comparator.

## 用 NAND 构建一切 / Building Everything with NAND

### NOT from NAND

```
NOT A = A NAND A

     ┌─────┐
A ───┤     ├──── Y = Ā
   └─┤NAND │
A ───┤     │
     └─────┘
```

### AND from NAND

```
A·B = NOT(A NAND B) = (A NAND B) NAND (A NAND B)

A ──┐
    ├─→ [NAND] ──┐
B ──┘            │
                 ├─→ [NAND] ──→ A·B
                 │
              ┌──┘
              (same signal)
```

### OR from NAND (德摩根 / De Morgan)

```
A + B = (NOT A) NAND (NOT B)

A ──→ [NOT] ──┐
              ├─→ [NAND] ──→ A + B
B ──→ [NOT] ──┘
```

### XOR from NAND

```
A ⊕ B = (A NAND (A NAND B)) NAND (B NAND (A NAND B))

需要 4 个 NAND gate
Requires 4 NAND gates
```

### 用 NAND 实现的全加器 / Full Adder Using Only NAND

1 位全加器 / 1-bit full adder:

输入 Inputs: A, B, Cin (进位输入 carry-in)
输出 Outputs: S (和 sum), Cout (进位输出 carry-out)

```
S    = A ⊕ B ⊕ Cin
Cout = (A·B) + (Cin·(A ⊕ B))
```

用 NAND 实现,需要 ~9 个 NAND。一个 32 位加法器就是 32 个全加器串联,~288 个 NAND。

> Implementing with NAND requires ~9 NANDs. A 32-bit adder is 32 full adders in series, ~288 NANDs.

## 通用门的存在性证明 / Proof of Universal Gates

**为什么 NAND 是通用的 / Why is NAND universal**?

要证明 NAND 通用,只需证明它能实现 NOT、AND、OR 这三个基本运算。

> To prove NAND universal, just show it implements NOT, AND, OR.

我们已经在上节看到:NOT、AND、OR 都能用 NAND 实现 → 任何布尔函数都能用 AND/OR/NOT 表达 → 任何布尔函数都能用 NAND 表达。✓

> We've seen NOT, AND, OR all implementable with NAND → any boolean function expressible via AND/OR/NOT → any boolean function expressible via NAND. ✓

**这个事实的深远影响 / The profound consequence**:

> 用一种门,构建整个 CPU。整个 Intel Core i9,如果展开,就是上百亿个 NAND 门(实际为了速度用更复杂门,但理论上可以只用 NAND)。

> With one gate type, build the entire CPU. The entire Intel Core i9, expanded, is billions of NAND gates (in practice, more complex gates are used for speed, but theoretically NAND alone suffices).

这是**抽象的胜利**: 用最简单的重复单元,构建最复杂的系统。

> This is **abstraction's triumph**: build the most complex system from the simplest repeating unit.

## 门延迟与扇出 / Gate Delay and Fan-Out

### 门延迟 Propagation Delay

每个门从输入变化到输出稳定,需要时间。典型值 / Typical value: 1 个 NAND 延迟 ~10-50 ps (10⁻¹² s)。

> Each gate takes time from input change to output stable. Typical: ~10-50 ps per NAND.

**关键路径 Critical Path**: 从输入到输出经过最多门的路径。32 位加法器 ~32 级 XOR + AND,延迟 ~1 ns。这就是为什么 CPU 主频上限 ~几个 GHz。

> The longest path through a circuit. A 32-bit adder ~32 levels XOR + AND, ~1 ns delay. That's why CPUs cap at ~several GHz.

### 扇出 Fan-Out

一个门的输出可以驱动多少个下游门的输入。受电容限制。典型 ~4-10。

> How many downstream gate inputs one output can drive. Capacitance-limited. Typical ~4-10.

## 与 LLM 的连接 / Connection to LLMs

1. **GPU 的"流处理器"本质上就是极大量的简单门**
   NVIDIA H100 有 800 亿晶体管,大部分是简单的 NAND/NOR 门组成的计算单元。LLM 推理的本质就是这些门在高速翻转。
   > NVIDIA H100 has 80 billion transistors, mostly simple NAND/NOR gates in compute units. LLM inference is essentially these gates toggling at high speed.

2. **门延迟决定推理延迟下限**
   每生成一个 token,需要数百到数千次矩阵乘法,每次乘法是几十亿门翻转,总延迟由关键路径决定。LLM 推理延迟不可能低于"门的物理延迟 × 必要串行步骤"。
   > Each token requires hundreds to thousands of matrix multiplies, each billions of gate toggles. Total latency determined by critical paths. LLM inference latency cannot fall below "physical gate delay × required sequential steps."

3. **范式思考: 如果不用布尔门?**
   有没有可能用模拟电路、神经形态、量子、光学等非布尔方式做"计算"?这就是阶段 9 的核心议题。
   > Paradigm thinking: what if we didn't use boolean gates? Could analog, neuromorphic, quantum, optical computing do "computation"? This is Phase 9's core question.

## 关键问题 / Questions

1. 只用 NOR,实现 AND. / Using only NOR, implement AND.
2. 设计一个 1 位 ALU,支持 ADD、AND、OR、XOR。用 NAND 实现。/ Design a 1-bit ALU supporting ADD, AND, OR, XOR, using only NAND.
3. 你的电脑 CPU 主频是 3 GHz,意味着每个时钟周期 0.33 ns。NAND 门延迟 10 ps。一个时钟周期可以串行通过多少级 NAND?这对 CPU 设计意味着什么? / Your CPU clock is 3 GHz, so each cycle = 0.33 ns. NAND delay = 10 ps. How many NAND levels per cycle? Implications for CPU design?

## 推荐资源 / Resources

- 工具 / Tool: **Logisim-Evolution** (免费,跨平台 / Free, cross-platform) — 强烈推荐 / Highly recommended
- 工具 / Tool: **Digital** (替代 simulator / Alternative simulator)
- 视频 / Video: *Ben Eater* "Building an 8-bit breadboard computer" 系列 — 实物连线 / Real wires

---

参见 / See also: [[boolean-algebra]], [[combinational-logic]]
