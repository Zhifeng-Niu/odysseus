---
title: 阶段 2 · 数字逻辑 / Phase 2 · Digital Logic
type: overview
tags: [phase, digital-logic, boolean, binary]
created: 2026-07-21
language: zh-CN
---

# 阶段 2 · 数字逻辑 / Phase 2 · Digital Logic

## 核心问题 / Core Question

> 为什么 0 和 1 够用?
>
> Why are 0 and 1 enough?

## 学习目标 / Learning Objectives

完成本阶段后,你应当能够 / After completing this phase, you should be able to:

1. 在二进制/十六进制/十进制之间流畅转换 / Fluently convert between binary, hex, and decimal
2. 用布尔代数化简任意逻辑表达式 / Simplify any boolean expression using boolean algebra
3. 用 NAND 门单独构建一个 8 位加法器 / Build an 8-bit adder using only NAND gates
4. 理解触发器、寄存器、计数器的原理 / Understand flip-flops, registers, counters
5. **关键批判点**: 能说出"为什么二进制是物理的必然" / **Key critique**: State why binary is a physical inevitability

## 核心概念 / Key Concepts

- [[binary-and-hex|二进制与十六进制:信息的最小语言 / Binary & Hex: The Minimal Language of Information]]
- [[boolean-algebra|布尔代数:逻辑的代数化 / Boolean Algebra: Logic as Algebra]]
- [[logic-gates|逻辑门:从代数到电路 / Logic Gates: From Algebra to Circuits]]
- [[combinational-logic|组合逻辑:加法器、多路复用器 / Combinational Logic: Adders, MUXes]]
- [[sequential-logic|时序逻辑:触发器、寄存器、状态机 / Sequential Logic: Flip-Flops, Registers, FSMs]]

## 关键术语 / Key Terms

参见 [[glossary#阶段 2 · 数字逻辑|术语表阶段 2 部分 / Glossary Phase 2 section]]

## 推荐资源 / Recommended Resources

### 入门 / Introductory
- 《编码:隐匿在计算机软硬件背后的语言》 Charles Petzold,第 7-14 章
  - *Code: The Hidden Language of Computer Hardware and Software* by Charles Petzold, Chapters 7-14
  - 从摩尔斯电码到加法器的最佳过渡 / Best bridge from Morse code to adders
- *But How Do It Know?* by J. Clark Scott

### 进阶 / Intermediate
- 《数字设计与计算机体系结构》 Harris & Harris
  - *Digital Design and Computer Architecture* by Harris & Harris

### 工具 / Tools
- **Logisim** (开源逻辑仿真器 / Open-source logic simulator) — 必装必备 / Must-install
- **Digital** (备用 simulator,跨平台 / Alternative simulator)

## 关键问题 / Key Questions

1. 二进制 1011 + 1101 等于多少? 手算,然后写出十六进制结果。/ What is binary 1011 + 1101? Calculate by hand, then write hex result.
2. 用布尔代数化简: `A·B + A·B̄ + Ā·B`. / Simplify using boolean algebra: `A·B + A·B̄ + Ā·B`.
3. 只用 NAND 门实现 XOR. / Implement XOR using only NAND gates.
4. D 触发器和 D 锁存器有什么区别? / What's the difference between a D flip-flop and a D latch?
5. 为什么现代计算机用二进制,而不是三进制(苏联 Setun 计算机就是三进制)? / Why binary, not ternary (the Soviet Setun computer was ternary)?

## 阶段反思 / Phase Reflection

学完后回到 [[learning-roadmap#反思机制 · Reflection Mechanism]],问自己 3 个问题。

---

返回 [[README|首页 / Home]] · 进入 [[03-computer-architecture/README|阶段 3 · 计算机架构 / Phase 3 · Computer Architecture]]
