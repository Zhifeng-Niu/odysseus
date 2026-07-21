---
title: 组合逻辑 · Combinational Logic
type: concept
phase: 2
tags: [combinational-logic, adder, multiplexer, decoder]
created: 2026-07-21
language: zh-CN
---

# 组合逻辑 · Combinational Logic

> **学习目标 / Learning Objectives**
> - 理解组合电路 vs 时序电路的本质区别 / Understand the essential difference between combinational and sequential circuits
> - 设计半加器、全加器、多路复用器、解码器 / Design half-adder, full-adder, multiplexer, decoder
> - 看到加法器是计算的"最小完整单元" / See that the adder is the "minimal complete unit" of computation

> **关键术语 / Key Terms**
> - 组合逻辑 Combinational logic · 时序逻辑 Sequential logic · 半加器 Half adder · 全加器 Full adder · 多路复用器 Multiplexer (MUX) · 解码器 Decoder · 编码器 Encoder

## 什么是组合逻辑? / What Is Combinational Logic?

**组合电路**: 当前输出**完全由当前输入决定**。没有记忆,没有状态。

> **Combinational circuit**: current output is **entirely determined by current input**. No memory, no state.

**时序电路**(下一章 / next chapter): 输出还依赖过去状态 → 有记忆。

> **Sequential circuit**: output also depends on past state → has memory.

组合电路的数学定义 / Mathematical definition:

```
Y(t) = F(X(t))         ← 输出只依赖当前输入 output depends only on current input
                        ← 没有时间,没有历史 no time, no history
```

## 加法器:计算的基石 / Adders: The Cornerstone of Computation

### 半加器 Half Adder

**功能 Function**: 加 2 个 1 位二进制数,输出 SUM 和 CARRY。

**真值表 Truth Table**:
| A | B | SUM | CARRY |
|---|---|-----|-------|
| 0 | 0 |  0  |   0   |
| 0 | 1 |  1  |   0   |
| 1 | 0 |  1  |   0   |
| 1 | 1 |  0  |   1   |

**布尔表达式 Boolean**:
- SUM = A ⊕ B (异或 XOR)
- CARRY = A · B (与 AND)

**电路 Circuit**:
```
       ┌──────┐
A ─────┤      ├──── SUM = A ⊕ B
   ┌───┤ XOR  │
B ─┼───┤      │
   │   └──────┘
   │   ┌──────┐
   └───┤      ├──── CARRY = A · B
       │ AND  │
       └──────┘
```

### 全加器 Full Adder

**功能 Function**: 加 3 个 1 位二进制数 (A, B, 低位进位 Cin),输出 SUM 和 Cout。

**真值表 Truth Table**:
| A | B | Cin | SUM | Cout |
|---|---|-----|-----|------|
| 0 | 0 |  0  |  0  |  0   |
| 0 | 0 |  1  |  1  |  0   |
| 0 | 1 |  0  |  1  |  0   |
| 0 | 1 |  1  |  0  |  1   |
| 1 | 0 |  0  |  1  |  0   |
| 1 | 0 |  1  |  0  |  1   |
| 1 | 1 |  0  |  0  |  1   |
| 1 | 1 |  1  |  1  |  1   |

**布尔表达式 Boolean**:
- SUM = A ⊕ B ⊕ Cin
- Cout = A·B + Cin·(A ⊕ B)

**用 2 个半加器 + OR 实现全加器 / Implement FA with 2 half-adders + OR**:

```
                  ┌──────────────────┐
A ────┬───────────┤                  ├─→ Partial Sum
      │           │   Half Adder 1   │
B ────┴───────────┤                  ├─→ Partial Carry 1
                  └────────┬─────────┘
                           │
                  ┌────────┴─────────┐
                  │                  │
Cin ──────────────┤   Half Adder 2   ├─→ SUM (final)
                  │                  │
                  └────────┬─────────┘
                           │
                       Partial Carry 2
                           │
                           ├───── OR ──→ Cout
                           │
                  Partial Carry 1 ────┘
```

**串联 32 个全加器 → 32 位行波进位加法器 / Chain 32 FAs → 32-bit ripple-carry adder**:

```
  A0 B0    A1 B1         A31 B31
   ↓ ↓      ↓ ↓            ↓ ↓
  [FA0]──→[FA1]──→...──→[FA31]
   Cin      C1            C31 Cout
   ↑
   0 (初始进位 / initial carry)
```

行波进位器 / Ripple-carry adder (RCA):
- 优点 / Pros: 设计简单,面积小 / Simple design, small area
- 缺点 / Cons: **慢**! 总延迟 = N × 单级延迟。32 位 RCA 延迟太长 / **Slow**! Total delay = N × per-stage. 32-bit RCA too slow for GHz CPUs.

### 先行进位加法器 Carry-Lookahead Adder (CLA)

为解决行波进位的慢,工程师发明了 CLA:**预先计算所有进位**,而不是等待。

> To solve ripple-carry slowness, engineers invented CLA: **pre-compute all carries** instead of waiting.

定义"产生 generate"和"传播 propagate"信号 / Define "generate" and "propagate" signals:

```
g_i = A_i · B_i           (这一位自己产生进位 / this stage generates a carry)
p_i = A_i ⊕ B_i           (这一位会传播下级的进位 / this stage propagates incoming carry)

c_{i+1} = g_i + p_i · c_i   (进位公式 / carry formula)
```

递归展开 / Recursively expand:
```
c_1 = g_0 + p_0 · c_0
c_2 = g_1 + p_1 · g_0 + p_1 · p_0 · c_0
c_3 = g_2 + p_2 · g_1 + p_2 · p_1 · g_0 + p_2 · p_1 · p_0 · c_0
...
```

每个进位都**直接由初始输入计算**,延迟 O(log N) 而非 O(N)。代价:门更多,连线更复杂。

> Each carry is **computed directly from initial inputs**, delay O(log N) instead of O(N). Cost: more gates, more wiring.

**这是工程思维的本质**: 用面积换速度,用复杂度换延迟。所有 CPU 的 ALU 都用类似 CLA 的优化。

> **This is engineering's essence**: trade area for speed, complexity for latency. All CPU ALUs use CLA-like optimizations.

## 多路复用器 Multiplexer (MUX)

**功能 Function**: 从 2ⁿ 个输入中选 1 个输出 / Select 1 of 2ⁿ inputs to output

**2 选 1 MUX / 2-to-1 MUX**:
- 输入 Inputs: D0, D1, S (select)
- 输出 Output: Y = S ? D1 : D0 = ¬S·D0 + S·D1

**真值表 Truth Table**:
| S | Y |
|---|---|
| 0 | D0 |
| 1 | D1 |

**电路 Circuit**:
```
        D0 ───┐
              ├──→ [AND] ──┐
S ──┬── NOT ──┘            │
    │                      ├──→ OR ──→ Y
    │             D1 ───┐  │
    └──────────────────┴──┤
                          │
                       [AND]
```

**8 选 1 MUX / 8-to-1 MUX**: 3 个选择线,8 个数据输入。常用于 CPU 寄存器堆选择。

> **8-to-1 MUX**: 3 select lines, 8 data inputs. Common in CPU register file selection.

**为什么 MUX 重要 / Why MUX matters**:

MUX 是**条件分支的硬件实现**。当 C 写 `if (cond) x = a; else x = b;`,编译器最终把它翻译为 `MUX(cond, b, a)` 的硬件电路。

> MUX is **the hardware implementation of conditional branches**. When C writes `if (cond) x = a; else x = b;`, the compiler ultimately translates to a `MUX(cond, b, a)` circuit.

## 解码器 Decoder

**功能 Function**: n 个输入 → 2ⁿ 个输出,其中只有一个为 1 / n inputs → 2ⁿ outputs, only one is 1

**2-to-4 解码器 / 2-to-4 Decoder**:
- 输入 Inputs: A, B
- 输出 Outputs: Y0, Y1, Y2, Y3

| A | B | Y0 | Y1 | Y2 | Y3 |
|---|---|----|----|----|----|
| 0 | 0 | 1  | 0  | 0  | 0  |
| 0 | 1 | 0  | 1  | 0  | 0  |
| 1 | 0 | 0  | 0  | 1  | 0  |
| 1 | 1 | 0  | 0  | 0  | 1  |

**用途 Use**:
- 内存地址解码 memory address decoding: 选哪一个内存字 / Select which memory word
- 指令译码 instruction decoding: 选哪一条指令逻辑 / Select which instruction logic

**关键观察 Key observation**: 解码器 = "寻址寻址寻址"。所有内存访问都从解码器开始。

> **Key observation**: decoder = "addressing, addressing, addressing". All memory access begins with a decoder.

## 编码器 Encoder

解码器的反 / Inverse of decoder: 2ⁿ 输入 → n 输出。优先编码器 priority encoder 用于中断控制。

## 三态门 Tri-State Buffer

普通逻辑门只能输出 0 或 1。但总线设计需要"不输出"状态(高阻 high-impedance, Hi-Z),允许多个驱动器共享一条线。

> Normal gates output 0 or 1. But bus design needs a "no output" state (high-impedance, Hi-Z), allowing multiple drivers to share one wire.

```
        Enable
          │
          ↓
Data ──→ [⎼⎽] ──→ Output
          
Enable = 1: Output = Data (驱动 / drive)
Enable = 0: Output = Hi-Z (不驱动 / not driven)
```

**关键**: 这是允许多个设备共享总线的基石。

> **Key**: cornerstone of bus sharing among devices.

## 算术逻辑单元 ALU (Arithmetic Logic Unit)

ALU = 加法器 + 逻辑运算 + MUX 选择。是 CPU 的核心。

> ALU = adder + logic ops + MUX selection. The CPU's core.

**简化 1 位 ALU / Simplified 1-bit ALU**:

```
     ┌──────────────────────────┐
A ───┤                          ├──── Result
     │     ┌───── AND ─────┐    │
B ───┼─────┤               ├────┤
     │     ├───── OR  ─────┤    │
Cin ─┼─────┤               ├────┤
     │     ├───── XOR ─────┤    │
     │     └───── ADD ─────┘    │
     │           ↑              │
     │      [MUX 4-to-1]        │
     │           ↑              │
     └──────── Op (2 bits) ─────┘
```

`Op` 控制 ALU 做什么:00 = AND, 01 = OR, 10 = XOR, 11 = ADD。

> `Op` selects ALU operation: 00 = AND, 01 = OR, 10 = XOR, 11 = ADD.

**这就是 CPU "做计算"的最小硬件体现**。

> **This is the minimal hardware embodiment of CPU "doing computation".**

## 与 AI 的连接 / Connection to AI

1. **GPU 矩阵乘法 = 海量加法器并行**
   LLM 的核心运算是矩阵乘法。每个矩阵元素乘法是若干加法器 + 移位。GPU 有成千上万个 ALU 并行工作。
   > LLM's core op is matrix multiplication. Each element multiply is adders + shifts. GPU has thousands of ALUs working in parallel.

2. **LLM 训练的算力单位 FLOPS = 加法器每秒翻转次数**
   "1 TFLOPS" = 每秒 10¹² 次浮点运算。每一次浮点运算需要 ~10 个加法器周期 → 10¹³ 次加法器翻转 → 10¹³ × 几十个 NAND 翻转。
   > "1 TFLOPS" = 10¹² floating-point operations per second. Each FP op ~10 adder cycles → 10¹³ adder toggles → 10¹³ × tens of NAND toggles.

3. **范式思考: 我们能不能用非加法器做"AI" ?**
   Transformer 的"注意力"是 softmax(QK^T/√d) V。softmax 包含 exp、归一化。这些都是非线性的。能不能直接用非线性电路(如模拟电路)实现,省去数字化?
   > Transformer attention is softmax(QK^T/√d) V. Softmax contains exp, normalization — all non-linear. Could we use non-linear (e.g., analog) circuits directly, skipping digitization?

   这是**神经形态计算 neuromorphic computing**的思路,也是阶段 9 的讨论。

   > This is the **neuromorphic computing** approach, discussed in Phase 9.

## 关键问题 / Questions

1. 设计 4 位加法器:用 4 个全加器串联。如果每个 FA 延迟 10 ns,32 位 RCA 的最坏情况延迟是多少? / Design a 4-bit adder using 4 FAs in series. If each FA delays 10 ns, what's the worst-case latency of a 32-bit RCA?
2. 用 8 选 1 MUX 实现 4 输入 XOR。提示: 用选择线作为变量。 / Implement 4-input XOR using an 8-to-1 MUX.
3. ALU 设计: 如果加法器需要支持 SUB,最小改动是什么? / ALU design: minimal change to support SUB?

## 推荐资源 / Resources

- 工具 / Tool: **Logisim** — 从全加器搭到 ALU
- 书 / Book: *Digital Design and Computer Architecture* Harris & Harris, 第 5 章 / Chapter 5
- 课程 / Course: **Nand2Tetris** (第 1-2 章项目 / Projects 1-2)

---

参见 / See also: [[logic-gates]], [[sequential-logic]]
