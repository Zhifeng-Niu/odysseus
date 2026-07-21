---
title: 指令集架构 ISA · Instruction Set Architecture
type: concept
phase: 3
tags: [isa, instruction-set, risc, cisc]
created: 2026-07-21
language: zh-CN
---

# 指令集架构 ISA · Instruction Set Architecture

> **学习目标 / Learning Objectives**
> - 理解 ISA 是软硬件之间的契约 / Understand ISA as the contract between hardware and software
> - 掌握 RISC 与 CISC 的本质区别 / Master the essential RISC vs CISC difference
> - 看到一段 C 代码如何被翻译为机器码 / See how C code translates to machine code

## 什么是 ISA? / What Is ISA?

**ISA (Instruction Set Architecture)** 是 CPU 设计师与程序员之间的契约 / The contract between CPU designers and programmers:

- 对**编译器作者**:ISA 规定可用的指令、寄存器、寻址模式 / For compiler writers: available instructions, registers, addressing modes
- 对**CPU 设计师**:ISA 规定要实现的硬件行为 / For CPU designers: hardware behaviors to implement
- 对**程序员**:汇编语言是 ISA 的助记形式 / For programmers: assembly is ISA's mnemonic form

**ISA 是抽象层** / ISA is an abstraction layer:

```
高层语言 (C, Python)    ← 程序员关心的 / programmers' concern
        ↓ 编译 compile
汇编 (mov, add, jmp)    ← ISA 的可读形式 / ISA's readable form
        ↓ 汇编 assemble
机器码 (01101000...)    ← CPU 直接执行 / CPU directly executes
        ↓
CPU 硬件(CU + ALU + Registers + ...)  ← 硬件实现者关心的 / hardware designers' concern
```

## 典型 RISC-V 指令示例 / Typical RISC-V Instructions

RISC-V 是 UC Berkeley 设计的开源 ISA,教学友好 / RISC-V is an open-source ISA from UC Berkeley, education-friendly:

```
add  x1, x2, x3    # x1 = x2 + x3 (寄存器加法 register add)
sub  x1, x2, x3    # x1 = x2 - x3
and  x1, x2, x3    # x1 = x2 & x3
or   x1, x2, x3    # x1 = x2 | x3
lw   x1, 0(x2)     # x1 = Memory[x2 + 0] (load word)
sw   x1, 0(x2)     # Memory[x2 + 0] = x1 (store word)
beq  x1, x2, label # if x1 == x2: goto label
jal  x1, label     # x1 = PC+4; goto label (jump and link)
```

**关键观察 Key observation**: 所有指令长度相同(32 位),格式规整。这是 RISC 设计哲学。

> **Key observation**: All instructions same length (32 bits), regular format. This is RISC design philosophy.

## RISC vs CISC / RISC vs CISC

| 特性 Feature | RISC (RISC-V, ARM, MIPS) | CISC (x86) |
|----------|-----------------------|-----------|
| 指令长度 Instruction length | 固定 fixed (32-bit) | 可变 variable (1-15 bytes) |
| 指令数量 Instruction count | 少 (~50) | 多 (~1500) |
| 寻址模式 Addressing modes | 少 few | 多 many |
| 内存访问 Memory access | 仅 load/store | 任意指令 (add Mem, ...) |
| 编译器复杂度 Compiler complexity | 简单 simple | 复杂 complex |
| 硬件复杂度 Hardware complexity | 简单 (易流水线 pipelining) | 复杂 |
| 代表 Examples | ARM (手机), RISC-V, MIPS | x86 (PC, 服务器) |

**历史 / History**:
- 1980 年前: CISC 主导,因为内存贵 / Before 1980: CISC dominated (memory expensive)
- 1980s: Berkeley RISC 项目 + Stanford MIPS 项目 → RISC 兴起 / RISC projects emerged
- 今天: 手机/嵌入式 ARM (RISC), 服务器/PC x86 (CISC), 数据中心 GPU(NVIDIA 自有 ISA)

**讽刺的现实 / Ironic reality**: 现代 x86 CPU 内部先把 CISC 指令翻译为类似 RISC 的微操作(micro-ops),再执行。**整个工业界都走向 RISC 思想**,只是 x86 在前端多了一层翻译。

> **Ironic reality**: Modern x86 CPUs translate CISC instructions into RISC-like micro-ops internally. **The entire industry drifts toward RISC**, just that x86 has a translation layer in front.

## 从 C 到机器码:完整的翻译链 / From C to Machine Code

C 代码 / C code:
```c
int sum = 0;
for (int i = 0; i < 10; i++) {
    sum = sum + i;
}
```

RISC-V 汇编 / RISC-V assembly:
```
    li   x1, 0          # sum = 0 (sum in x1)
    li   x2, 0          # i = 0 (i in x2)
    li   x3, 10         # limit = 10
loop:
    bge  x2, x3, done   # if i >= 10: goto done
    add  x1, x1, x2     # sum += i
    addi x2, x2, 1      # i++
    j    loop
done:
```

机器码(十六进制 / hex):
```
0x00100093  # li x1, 0
0x00000113  # li x2, 0
0x00a00193  # li x3, 10
0x0031d463  # bge x2, x3, done
0x002082b3  # add x1, x1, x2
0x00110113  # addi x2, x2, 1
0xff9ff06f  # j loop
```

**这是同一份程序的三种表达**: 高层语言(给人类)/ 汇编(给汇编器)/ 机器码(给 CPU)。**信息相同,只是编码不同**。

> **Three expressions of the same program**: high-level (human) / assembly (assembler) / machine code (CPU). **Same information, different encodings**.

## ABI:二进制接口 / ABI: Application Binary Interface

ABI 是 ISA 之上的扩展契约,规定 / ABI extends ISA, specifying:

- **寄存器约定 Calling convention**: 哪些寄存器存参数,哪些存返回值 / Which registers hold args, return values
- **栈布局 Stack layout**: 帧大小、对齐、调用顺序 / Frame size, alignment, call order
- **数据大小 Data sizes**: char=1byte, int=4bytes, 指针=8bytes (64 位) / char=1B, int=4B, pointer=8B
- **系统调用 System calls**: 如何进入内核 / How to enter kernel

**为什么重要 / Why important**: 不同编译器、不同语言、不同 OS 都必须遵守同一 ABI,否则无法互操作。

> Different compilers, languages, OSes must follow the same ABI for interoperability.

## 与 AI 的连接 / Connection to AI

1. **GPU 是不同 ISA**
   NVIDIA GPU 用 SASS(内部)/ PTX(中间) ISA,与 CPU 完全不同。CUDA 程序编译为 PTX,再编译为 SASS。当你在 PyTorch 调用 `model.forward()`,实际指令流是 CPU x86 + GPU SASS 混合。
   > NVIDIA GPU uses SASS (internal) / PTX (intermediate) ISA. CUDA compiles to PTX then SASS. When you call `model.forward()` in PyTorch, the actual instruction stream is CPU x86 + GPU SASS.

2. **TPU 有自己的 ISA**
   Google TPU 的指令直接对应矩阵乘法 (systolic array)。一条 TPU 指令 = 一个矩阵运算,而 x86 需要 1000 条指令。
   > Google TPU instructions directly correspond to matrix multiply (systolic array). One TPU instruction = one matrix op, vs 1000 x86 instructions.

3. **未来 AI 加速器的核心问题**: 什么样的 ISA 适合 AI?
   - 稠密矩阵乘法 → NVIDIA/TPU 已经做得很好
   - 稀疏计算 / 神经形态 / 量子 → 还没有清晰答案
   > The core question for future AI accelerators: what ISA suits AI?
   > - Dense matmul → NVIDIA/TPU excel
   > - Sparse / neuromorphic / quantum → no clear answer yet

4. **LLM 自己生成代码,也受限于 ISA**
   LLM 写 Python 代码,Python 调用 C 库,C 编译为汇编。**最终仍受限于冯·诺依曼 ISA**。如果 AI 想超越人类代码,必须超越冯·诺依曼 ISA。
   > LLM writes Python → calls C library → compiles to assembly. **Ultimately limited by Von Neumann ISA**. If AI wants to surpass human code, it must transcend Von Neumann ISA.

## 关键问题 / Questions

1. 为什么 x86 内部要翻译为 micro-ops? / Why does x86 internally translate to micro-ops?
2. ARM 手机 CPU 主频不到 3 GHz,但性能追上 x86。为什么? / ARM mobile CPUs < 3 GHz but match x86. Why?
3. 如果让你为 AI 设计一个新 ISA,你会优化什么? / If you designed a new ISA for AI, what would you optimize?
4. RISC-V 开源 ISA 的意义是什么?会改变 AI 芯片格局吗? / What does open-source RISC-V mean? Will it reshape AI chips?

## 推荐资源 / Resources

- 书 / Book: *Computer Organization and Design RISC-V Edition* — Patterson & Hennessy
- 网站 / Website: [riscv.org](https://riscv.org) — 完整规范 / Full specs
- 课程 / Course: **Berkeley CS61C** — Great Ideas in Computer Architecture
- 模拟器 / Simulator: **RARS** (RISC-V 汇编模拟器 / RISC-V assembler simulator)

---

参见 / See also: [[von-neumann-architecture]], [[cpu-pipeline]]
