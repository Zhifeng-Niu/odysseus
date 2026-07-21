---
title: 阶段 3 · 计算机架构 / Phase 3 · Computer Architecture
type: overview
tags: [phase, architecture, von-neumann, isa]
created: 2026-07-21
language: zh-CN
---

# 阶段 3 · 计算机架构 / Phase 3 · Computer Architecture

## 核心问题 / Core Question

> 程序如何"自己跑起来"?
>
> How does a program "run itself"?

## 学习目标 / Learning Objectives

完成本阶段后,你应当能够 / After completing this phase, you should be able to:

1. 画出冯·诺依曼架构图,解释每一部分的作用 / Draw Von Neumann architecture diagram and explain each part
2. 写一段 RISC-V 或 x86 汇编,理解指令周期 / Write RISC-V or x86 assembly, understand the instruction cycle
3. 解释 CPU 流水线、缓存层次、中断机制 / Explain CPU pipeline, cache hierarchy, interrupts
4. **关键批判点**: 能说出冯·诺依曼架构的根本瓶颈,以及为什么 GPU 在某些任务上胜过 CPU / **Key critique**: State Von Neumann's fundamental bottleneck, and why GPUs beat CPUs on certain tasks

## 核心概念 / Key Concepts

- [[von-neumann-architecture|冯·诺依曼架构:存储程序革命 / Von Neumann: The Stored-Program Revolution]]
- [[instruction-set-architecture|指令集架构:软硬件的契约 / ISA: The Contract Between Hardware and Software]]
- [[cpu-pipeline|CPU 流水线:让指令像流水一样跑 / CPU Pipeline: Making Instructions Flow Like Water]]
- [[memory-hierarchy|存储层次:缓存、内存、磁盘 / Memory Hierarchy: Cache, RAM, Disk]]
- [[interrupts-and-io|中断与 I/O:CPU 如何与外部世界打交道 / Interrupts & I/O: How CPU Talks to the World]]

## 关键术语 / Key Terms

参见 [[glossary#阶段 3 · 计算机架构|术语表阶段 3 部分 / Glossary Phase 3 section]]

## 推荐资源 / Recommended Resources

### 入门 / Introductory
- 《编码》 Petzold 第 22-25 章 / *Code* Chapters 22-25
- *But How Do It Know?* by J. Clark Scott

### 进阶 / Intermediate
- 《计算机系统要素》 Nisan & Schocken
  - *The Elements of Computing Systems* (TECS, 又称 / also known as Nand2Tetris)
  - **强烈推荐 / Highly recommended**: 从 NAND 门到操作系统,自己造一台计算机 / From NAND gates to OS, build your own computer
- 《计算机组成与设计》 Patterson & Hennessy
  - *Computer Organization and Design* by Patterson & Hennessy

### 课程 / Courses
- **Nand2Tetris** (免费在线课程 / Free online course) — 项目 1-12,从逻辑门到操作系统 / Projects 1-12, from gates to OS
- **MIT 6.004** Computer Architecture (公开课 / OpenCourseWare)

## 关键问题 / Key Questions

1. 冯·诺依曼架构的"存储程序"思想为什么是革命性的? / Why was "stored program" revolutionary?
2. CPU 主频 3 GHz,内存访问需要 100 ns。一个时钟周期内 CPU 能做几次内存访问? / CPU 3 GHz, memory access 100 ns. How many memory accesses per cycle?
3. 为什么 CPU 缓存层次(L1, L2, L3)的延迟和容量是指数级递增? / Why does cache hierarchy (L1, L2, L3) grow exponentially in latency and capacity?
4. GPU 和 CPU 在架构上的根本差异是什么? / What's the fundamental architectural difference between GPU and CPU?
5. 为什么 Apple M 系列芯片用"统一内存"而 NVIDIA GPU 用"HBM"? / Why does Apple M series use "unified memory" while NVIDIA uses "HBM"?

## 阶段反思 / Phase Reflection

学完后回到 [[learning-roadmap#反思机制 · Reflection Mechanism]],问自己 3 个问题。

---

返回 [[README|首页 / Home]] · 进入 [[04-programming-systems/README|阶段 4 · 编程与系统 / Phase 4 · Programming & Systems]]
