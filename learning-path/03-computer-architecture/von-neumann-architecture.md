---
title: 冯·诺依曼架构 · Von Neumann Architecture
type: concept
phase: 3
tags: [von-neumann, stored-program, architecture]
created: 2026-07-21
language: zh-CN
---

# 冯·诺依曼架构 · Von Neumann Architecture

> **学习目标 / Learning Objectives**
> - 理解"存储程序"思想的革命性 / Understand why "stored program" was revolutionary
> - 看到冯·诺依曼架构的核心组成部分及其交互 / See Von Neumann components and interactions
> - 理解"冯·诺依曼瓶颈"及其对现代 AI 的影响 / Understand "Von Neumann bottleneck" and its AI implications

## 历史背景 / Historical Context

1945 年,John von Neumann 写了 *First Draft of a Report on the EDVAC*,提出了一种新的计算机组织方式。

> In 1945, John von Neumann wrote *First Draft of a Report on the EDVAC*, proposing a new computer organization.

**之前**: ENIAC 等"程序控制计算机"通过**重新连线**来换程序。换程序 = 几天工作。

> **Before**: ENIAC and similar "program-controlled computers" changed programs by **rewiring**. Changing program = days of work.

**冯·诺依曼的突破**: 把程序(指令)和数据**放在同一存储器**中。程序像数据一样被读取、执行。换程序 = 载入新数据。

> **Von Neumann's breakthrough**: store program (instructions) and data in **the same memory**. Program read like data. Change program = load new data.

**这是计算史最重要的抽象之一**: 软件诞生。

> **One of the most important abstractions in computing history**: software was born.

## 经典冯·诺依曼架构 / Classic Von Neumann Architecture

```
        ┌─────────────────────────────────┐
        │                                 │
        │   内存 Memory                   │
        │   (指令 instructions + 数据 data)│
        │                                 │
        └─────────────────────────────────┘
              ↑                   ↓
            读取 read            写入 write
              ↑                   ↓
        ┌─────────────────────────────────┐
        │           CPU                   │
        │  ┌──────────────────────────┐   │
        │  │ 控制单元 Control Unit (CU)│  │
        │  └──────────────────────────┘   │
        │              ↓                  │
        │  ┌──────────────────────────┐   │
        │  │ ALU (算术逻辑单元)       │   │
        │  └──────────────────────────┘   │
        │              ↑                  │
        │  ┌──────────────────────────┐   │
        │  │ 寄存器 Registers         │   │
        │  │  - 程序计数器 PC         │   │
        │  │  - 指令寄存器 IR         │   │
        │  │  - 通用寄存器 GPRs       │   │
        │  └──────────────────────────┘   │
        └─────────────────────────────────┘
                     ↓ ↑
              ┌─────────────┐
              │ I/O Devices │
              │  - 键盘     │
              │  - 显示器   │
              │  - 磁盘     │
              └─────────────┘
```

## 五大组成部分 / Five Components

1. **运算器 ALU (Arithmetic Logic Unit)**: 执行算术与逻辑运算 / Performs arithmetic and logic operations
2. **控制器 CU (Control Unit)**: 解码指令,协调各部件 / Decodes instructions, coordinates components
3. **存储器 Memory**: 存储指令与数据 / Stores instructions and data
4. **输入设备 Input**: 键盘、鼠标、传感器 / Keyboard, mouse, sensors
5. **输出设备 Output**: 显示器、打印机、马达 / Display, printer, motor

## 指令周期 Instruction Cycle (Fetch-Decode-Execute)

每个指令的执行 / Each instruction execution:

```
1. Fetch 取指:
   - PC → MAR (内存地址寄存器 Memory Address Register)
   - 读取内存 → MBR (内存缓冲寄存器 Memory Buffer Register)
   - MBR → IR (指令寄存器 Instruction Register)
   - PC += instruction size

2. Decode 译码:
   - 控制单元解析 IR
   - 确定操作码 opcode 和操作数 operands
   - 准备控制信号

3. Execute 执行:
   - ALU 运算 / 数据搬运 / 跳转 / 等
   - 结果写回寄存器或内存

4. (可能有) Writeback 写回

5. 回到第 1 步,循环
```

**这就是"程序自己跑起来"的本质**: CPU 无限循环 Fetch-Decode-Execute。程序是一连串指令,PC 自动递增(除了 jump),就这样自动执行。

> **This is "program running itself"**: CPU infinitely loops Fetch-Decode-Execute. Program = sequence of instructions, PC auto-increments (except for jumps), automatic execution.

## 与 Harvard 架构的对比 / Comparison with Harvard Architecture

**Harvard Architecture**: 指令和数据分开存储,有两条独立总线。/ Separate instruction and data memories with two independent buses.

| 特性 | 冯·诺依曼 | Harvard |
|----|---------|---------|
| 内存结构 | 统一 unified | 分离 split |
| 总线 | 一条 one | 两条 two |
| 设计复杂度 | 简单 simple | 复杂 complex |
| 带宽 | 低 (瓶颈 bottleneck) | 高 |
| 自修改代码 self-modifying code | 容易 easy | 困难 hard |
| 典型用途 | 通用 CPU | DSP、微控制器 microcontroller |

**现代 CPU 是"改良 Harvard"**: L1 缓存分为 L1 指令缓存 + L1 数据缓存,但外部内存统一。

> **Modern CPUs are "Modified Harvard"**: L1 cache split into L1 instruction + L1 data, but external memory unified.

## 冯·诺依曼瓶颈 / Von Neumann Bottleneck

**问题 Problem**: CPU 速度每秒数 GHz,内存访问需要几十到几百 ns。CPU 与内存之间的数据通道成为瓶颈。

> **Problem**: CPU runs at GHz, memory access takes tens to hundreds of ns. CPU-memory channel becomes the bottleneck.

**实际影响 Real impact**:
- 现代 CPU 算一条指令 ~0.3 ns (1/3 GHz)
- 访问 L1 cache ~1 ns
- 访问 L2 ~4 ns
- 访问 L3 ~12 ns
- 访问主存 (DRAM) ~100 ns → **CPU 要等 300 个周期**

**为什么 LLM 训练消耗大量电力**: GPU 极速计算需要不断从 HBM 搬数据,数据搬运的能耗是计算的 10-100 倍。**冯·诺依曼瓶颈在 AI 时代被放大**。

> **Why LLM training consumes huge power**: GPUs need constant data from HBM; data movement energy is 10-100× computation energy. **Von Neumann bottleneck amplified in AI era**.

## 突破冯·诺依曼的方向 / Directions Beyond Von Neumann

1. **计算在内存 Processing-in-Memory (PIM)**: 把计算单元嵌入内存阵列,减少数据搬运 / Embed compute in memory arrays, reduce data movement
2. **神经形态计算 Neuromorphic Computing**: 模拟大脑,计算与存储在同一物理单元(如忆阻器 memristor) / Mimic brain, compute and store in same physical unit (e.g., memristor)
3. **数据流架构 Dataflow Architectures**: 像 TPU 的 Systolic Array,数据流过计算单元 / Like TPU's Systolic Array, data flows through compute units
4. **模拟计算 Analog Computing**: 用连续物理量(电压、光强)做计算 / Use continuous physical quantities (voltage, light intensity) for computation

**关键观察 Key observation**: 当前 LLM 的根本限制不在算法,而在冯·诺依曼架构本身。真正的范式突破,必须改变架构,而不只是算法。

> **Key observation**: Current LLM's fundamental limit isn't algorithmic but in Von Neumann architecture itself. Real paradigm shift requires architectural change, not just algorithmic.

## 关键问题 / Questions

1. 为什么冯·诺依曼架构在 70 年后仍然统治计算? / Why does Von Neumann still dominate computing after 70 years?
2. "自修改代码 self-modifying code"为什么重要?它让什么成为可能? / Why is self-modifying code important? What does it enable?
3. 冯·诺依曼瓶颈与 LLM 的"上下文窗口限制"是同一个问题吗? / Are Von Neumann bottleneck and LLM's "context window limit" the same problem?
4. 大脑是冯·诺依曼架构吗?为什么? / Is the brain Von Neumann? Why or why not?

## 推荐资源 / Resources

- 书 / Book: *The Computer and the Brain* — John von Neumann (1958,未完成遗作 / unfinished posthumous work) — 冯·诺依曼对大脑与计算机的思考 / von Neumann's thoughts on brain vs computer
- 书 / Book: *Computer Organization and Design* Patterson & Hennessy
- 论文 / Paper: *First Draft of a Report on the EDVAC* — von Neumann (1945)
- 课程 / Course: **Nand2Tetris** 项目 4-5 / Projects 4-5

---

参见 / See also: [[instruction-set-architecture]], [[cpu-pipeline]]
