---
title: 时序逻辑 · Sequential Logic
type: concept
phase: 2
tags: [sequential-logic, flip-flop, register, fsm]
created: 2026-07-21
language: zh-CN
---

# 时序逻辑 · Sequential Logic

> **学习目标 / Learning Objectives**
> - 理解时序电路与组合电路的根本差别:记忆 / Understand the fundamental difference: memory
> - 掌握锁存器、触发器、寄存器的工作原理 / Master latches, flip-flops, registers
> - 看到时序是"时间"的诞生,有了时间才有"程序" / See that sequential circuits introduce "time" — and with time, "program"

> **关键术语 / Key Terms**
> - 时序逻辑 Sequential logic · 锁存器 Latch · 触发器 Flip-flop · 时钟 Clock · 边沿触发 Edge-triggered · 寄存器 Register · 有限状态机 Finite State Machine (FSM) · 同步 Synchronous · 异步 Asynchronous

## 关键概念:记忆 / The Key Concept: Memory

组合电路没有记忆。但图灵机需要带子(记忆),冯·诺依曼架构需要存储。没有记忆,就没有计算。

> Combinational circuits have no memory. But Turing machines need tape (memory), and Von Neumann architecture needs storage. Without memory, no computation.

时序电路 = 组合电路 + 反馈 = **记忆**。

> Sequential circuit = combinational + feedback = **memory**.

## 最简单的记忆:SR 锁存器 / Simplest Memory: SR Latch

用两个 NOR 门交叉耦合 / Two NOR gates cross-coupled:

```
S ──────┐          
        ├──[NOR]──┬───── Q
        │         │
   ┌────┘         │
   │              │
   │  ┌───────────┘
   │  │
   │  └──[NOR]──┬───── Q̄
   │            │
R ─┼────────────┘
   │
   (反馈 feedback)
```

**行为 Behavior**:

| S | R | Q (next) | Q̄ (next) | 状态 State |
|---|---|----------|----------|---------|
| 0 | 0 | Q (prev) | Q̄ (prev) | **保持 Hold** (记忆 memory!) |
| 0 | 1 | 0        | 1        | **复位 Reset** |
| 1 | 0 | 1        | 0        | **置位 Set** |
| 1 | 1 | X        | X        | **非法 Forbidden** |

**核心洞察 Core insight**: 当 S=R=0,输出**保持上次的值** —— 这就是 1 bit 的记忆!

> **Core insight**: When S=R=0, output **retains previous value** — this is 1 bit of memory!

## D 锁存器 D Latch

SR 锁存器有"非法状态"。D 锁存器简化为单输入 / SR latch has "forbidden state". D latch simplifies to single input:

```
       D ────────┐
                 ├──[NOR]──┬── Q
                 │         │
       Enable ──┼─────────┘
                 │
                 └──[NOR]──┴── Q̄
```

**行为 Behavior**:

| Enable | D | Q (next) |
|--------|---|----------|
| 1      | 0 | 0 (透明 transparent:输出 = D) |
| 1      | 1 | 1 (透明) |
| 0      | X | Q (prev) (锁存 latched) |

**"透明"模式 / "Transparent" mode**: Enable=1 时,输出跟随 D,就像门打开。

**"锁存"模式 / "Latch" mode**: Enable=0 时,输出冻结。

> **"Transparent"**: Enable=1 → output follows D like an open door.
> **"Latch"**: Enable=0 → output frozen.

## D 触发器 D Flip-Flop ⭐

**锁存器的问题 Problem with Latches**: 整个 Enable=1 期间都透明 → 如果 D 在期间变化,Q 跟着变 → **无法预测**。

> **Latches' problem**: transparent for entire Enable=1 period → if D changes during this time, Q follows → **unpredictable**.

**触发器解决方案 / Flip-Flop Solution**: **只在时钟边沿(上升或下降)采样 D**。其余时间不管 D 怎么变,Q 不变。

> **Flip-flop solution**: **samples D only at clock edge (rising or falling)**. Otherwise Q doesn't change regardless of D.

实现 / Implementation: 用 2 个 D 锁存器主从串联 / Two D latches in master-slave config:

```
Clock ──┬──────────────┐
        │              │
        │   Master     │   Slave
D ──────┼─→[Latch 1]──┼─→[Latch 2]──→ Q
        │              │
        │ (clk 相位)   │ (反相 clk 相位)
        └────┬─────────┘
             │
            NOT
             │
             └─────→ Slave Enable
```

- Clock 上升沿: Master 锁定(原数据), Slave 透明 → 输出反映 Master 内容
- Clock 下降沿: Master 透明, Slave 锁定 → 输出不变

**净效果 Net effect**: Q 只在 Clock 上升沿改变,其余时间稳定。这是**同步数字电路的基础**。

> **Net effect**: Q changes only on Clock rising edge, otherwise stable. This is the **foundation of synchronous digital circuits**.

## 寄存器 Register

寄存器 = 一组共享时钟的 D 触发器 / Register = a group of D flip-flops sharing a clock.

**8 位寄存器 / 8-bit register**: 8 个 D 触发器,共同时钟,8 个 D 输入,8 个 Q 输出。

```
        D0 ───→ [D-FF] ──→ Q0
        D1 ───→ [D-FF] ──→ Q1
        ...
        D7 ───→ [D-FF] ──→ Q7
              ↑
           Clock
```

**寄存器是 CPU 的基本存储单元**: 程序计数器(PC)、通用寄存器(R0-R15)、状态寄存器、指令寄存器等都是寄存器。

> **Registers are the CPU's basic storage**: Program Counter (PC), general purpose registers (R0-R15), status register, instruction register, etc.

## 计数器 Counter

把寄存器的输出反馈到加法器,再回到输入,就是计数器 / Feedback register output through an adder back to input → counter.

```
        ┌─────────────────────┐
        │                     │
        │   ┌──[+1]──┐         │
        └───┤        ├─────────┤
            └────────┘         │
                               │
        ┌──────────────────────┴───┐
        │  4-bit Register (D-FF)   │
        └──┬─────┬─────┬─────┬─────┘
           Q0    Q1    Q2    Q3
```

每个时钟边沿,Q = Q + 1。这就是程序计数器 PC 的工作方式。

> Each clock edge, Q = Q + 1. This is how the Program Counter (PC) works.

## 移位寄存器 Shift Register

寄存器 + 横向反馈 = 移位 / Register + lateral feedback = shifter:

```
       D ───→ [D-FF] ──→ [D-FF] ──→ [D-FF] ──→ [D-FF] ──→ Output
              ↑          ↑          ↑          ↑
            Clock      Clock      Clock      Clock
```

每个时钟边沿,数据向右移一位。用于串行 ↔ 并行转换、乘以 2(左移 1)、除以 2(右移 1)。

> Each clock edge, data shifts right one position. Used for serial↔parallel conversion, multiply by 2 (left shift 1), divide by 2 (right shift 1).

## 内存 Memory:SRAM 与 DRAM

### SRAM (Static RAM)

用 6 个晶体管存储 1 bit / Uses 6 transistors to store 1 bit:

```
                V_DD
                 │
              ─[INV]─        ← 6T SRAM 单元 / cell
            │        │
        Q ──┤        ├── Q̄
            │        │
              ─[INV]─
                 │
                GND
```

- **优点 Pros**: 快,不需要刷新
- **缺点 Cons**: 6 个晶体管/bit → 密度低 → 贵
- **用途 Use**: CPU 缓存(L1/L2/L3)

### DRAM (Dynamic RAM)

用 1 个晶体管 + 1 个电容存储 1 bit / Uses 1 transistor + 1 capacitor:

```
         行线 Word line
            │
           [T]   ← 晶体管 transistor
            │
          ─┴─
          │ │   ← 电容 capacitor (实际只有 fF 级 tiny capacitance)
          ─┬─
           │
          GND
```

- **优点 Pros**: 1T+1C/bit → 密度高 → 便宜
- **缺点 Cons**: 电容会漏电 → 必须**每 64 ms 刷新** (读出再写回) → 慢
- **用途 Use**: 主内存 (DIMM)

**关键 Critical**: DRAM 的"动态"就是"会忘记"。如果断电,数据消失。这就是**内存的易失性 volatile**。

> **Critical**: DRAM's "dynamic" = "will forget". Power off → data gone. This is **memory volatility**.

## 同步 vs 异步设计 / Synchronous vs Asynchronous Design

**同步 Synchronous**: 所有触发器共享同一时钟。设计简单,分析容易。现代 CPU 99% 同步。

> **Synchronous**: all flip-flops share same clock. Simple design, easy analysis. Modern CPUs 99% synchronous.

**异步 Asynchronous**: 没有全局时钟,模块间用握手协议通信。理论上更快、更省电,但极难设计。

> **Asynchronous**: no global clock, modules handshake. Theoretically faster and lower power, but extremely hard to design.

**为什么 99% CPU 是同步的 / Why 99% of CPUs are synchronous**:

时钟是"乐队指挥"。没有指挥,各模块要靠相互通信协调,容易死锁、竞争、亚稳态。有时钟,所有动作在同一节拍发生,分析简单。

> Clock is the "conductor." Without it, modules must coordinate through mutual communication — deadlock, race, metastability risks. With clock, all actions on the same beat, simple analysis.

**异步设计是研究前沿**,可能与神经形态 AI 相关 —— 因为大脑就是异步的。

> **Asynchronous design is a research frontier**, possibly relevant to neuromorphic AI — because brains are asynchronous.

## 有限状态机 Finite State Machine (FSM)

FSM 是时序电路的数学抽象 / FSM is the mathematical abstraction of sequential circuits:

```
        ┌─────────────────────┐
input ──→│  组合逻辑           │── output (Mealy machine)
        │  Combinational Logic│── next state
        └─────────┬───────────┘
                  │
              ┌───┴───┐
              │Register│
              │(state) │
              └───┬───┘
                  │
            current state
```

FSM 的 5 元组定义 / 5-tuple definition:

- **状态集 States** S = {s1, s2, ...}
- **输入集 Inputs** I
- **输出集 Outputs** O
- **转移函数 Transition function** δ: S × I → S
- **输出函数 Output function** λ: S × I → O (Mealy) or λ: S → O (Moore)

**例子 Example**: 交通灯 FSM / Traffic light FSM:

```
状态 States: {RED, GREEN, YELLOW}
输入 Input: timer
输出 Output: light color

转移 Transitions:
RED + timer → GREEN
GREEN + timer → YELLOW
YELLOW + timer → RED
```

FSM 是**所有计算的本质抽象**。CPU 本身就是一个巨型 FSM,状态集是寄存器内容。

> FSM is **the essential abstraction of all computation**. A CPU is a giant FSM where the state set is register contents.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 也有"状态": KV Cache**
   Transformer 推理时,KV Cache 存储已生成 token 的 Key/Value 张量,避免重复计算。KV Cache 本质是 GPU 显存(GDDR HBM)中的海量数据,基于 DRAM。
   > Transformer inference uses KV Cache to store Key/Value tensors of generated tokens, avoiding recomputation. KV Cache is fundamentally massive data in GPU VRAM (GDDR HBM), based on DRAM.

2. **LLM 推理的"时钟"是 token 生成频率**
   每生成一个 token,模型"前进一拍"。这与 CPU 每周期前进一拍是同构的。
   > Each generated token, model "advances one beat". Isomorphic to CPU advancing one beat per cycle.

3. **范式思考: 大脑是同步还是异步?**
   大脑没有全局时钟(可能是)。神经形态计算要模拟大脑,可能必须异步。但异步设计极难,这是当前工业界回避的方向 —— 也可能是范式突破的方向。
   > Brain has no global clock (probably). Neuromorphic computing simulating brain may have to be asynchronous. But asynchronous design is hard, currently avoided by industry — possibly the paradigm shift direction.

## 关键问题 / Questions

1. 为什么触发器比锁存器更常用? / Why are flip-flops more common than latches?
2. 设计一个 FSM,识别输入序列 "1011"。 / Design an FSM to detect input sequence "1011".
3. SRAM 6T 单元 vs DRAM 1T1C 单元:为什么 CPU L1 cache 用 SRAM,主存用 DRAM? / SRAM 6T cell vs DRAM 1T1C cell: why SRAM for L1 cache, DRAM for main memory?
4. 假设大脑是异步的,人类模拟它的瓶颈是什么? / If the brain is asynchronous, what's the bottleneck in simulating it?

## 推荐资源 / Resources

- 书 / Book: *Digital Design and Computer Architecture* Harris & Harris, 第 3 章 / Chapter 3
- 课程 / Course: **Nand2Tetris** 项目 3 (时序 / Sequential)
- 视频 / Video: *Ben Eater* 8-bit 计算机系列 — 锁存器实物 / Latches on real hardware

---

参见 / See also: [[combinational-logic]], [[03-computer-architecture/von-neumann-architecture|von Neumann architecture]]
