---
title: 阶段 4 · 编程与系统 / Phase 4 · Programming & Systems
type: overview
tags: [phase, c, os, compiler]
created: 2026-07-21
language: zh-CN
---

# 阶段 4 · 编程与系统 / Phase 4 · Programming & Systems

## 核心问题 / Core Question

> 人类如何让机器听话?
>
> How do humans make machines obey?

## 学习目标 / Learning Objectives

完成本阶段后,你应当能够 / After completing this phase, you should be able to:

1. 写出 500 行 C 程序,理解指针、内存布局、ABI / Write 500-line C programs, understand pointers, memory layout, ABI
2. 实现一个简单的 shell + 简单的 malloc / Implement a simple shell + simple malloc
3. 理解编译器前端(lexer, parser)和后端(codegen, optimization) / Understand compiler frontend (lexer, parser) and backend (codegen, optimization)
4. **关键批判点**: 能说出"高级语言"在抽象层叠中丢失了什么 / **Key critique**: State what "high-level languages" lose in abstraction layering

## 核心概念 / Key Concepts

- [[c-language|C 语言:贴近金属的高级语言 / C: High-Level Language Close to Metal]]
- [[memory-layout|内存布局:栈、堆、数据段 / Memory Layout: Stack, Heap, Data Segment]]
- [[operating-system|操作系统:资源抽象的艺术 / OS: The Art of Resource Abstraction]]
- [[compiler|编译器:从源码到机器码 / Compiler: Source to Machine Code]]
- [[linker-and-loader|链接与加载:从可执行文件到运行进程 / Linker & Loader: Executable to Process]]

## 推荐资源 / Recommended Resources

### 入门 / Introductory
- *The C Programming Language* — Kernighan & Ritchie (K&R, 必读经典 / must-read classic)
- *Head First C* — Griffiths

### 进阶 / Intermediate
- 《深入理解计算机系统》 CSAPP
  - *Computer Systems: A Programmer's Perspective* by Bryant & O'Hallaron
  - **强烈推荐 / Highly recommended** —— 第 3 版是程序员必读 / 3rd edition is required reading for programmers

### 课程 / Courses
- **CMU 15-213** CSAPP 配套课 (公开课 / OpenCourseWare)
- **MIT 6.828** Operating Systems (有 xv6 实战 / xv6 hands-on)
- **Berkeley CS162** Operating Systems

## 关键问题 / Key Questions

1. C 语言的指针为什么既是力量也是陷阱? / Why are C pointers both power and trap?
2. 进程和线程的本质区别是什么? / Essential difference between process and thread?
3. 编译器优化的边界在哪? / Where are compiler optimization limits?
4. Python 比 C 慢 100 倍,这 100 倍具体消耗在哪? / Python 100× slower than C — where does it go?
5. JavaScript 和 C++ 的内存模型差别有多大? / How different are JS and C++ memory models?

## 阶段反思 / Phase Reflection

学完后回到 [[learning-roadmap#反思机制 · Reflection Mechanism]].

---

返回 [[README|首页 / Home]] · 进入 [[05-algorithms-complexity/README|阶段 5 · 算法与复杂度 / Phase 5 · Algorithms & Complexity]]
