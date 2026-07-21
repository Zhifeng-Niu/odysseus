---
title: 阶段 1 · 物理基础 / Phase 1 · Physics Foundations
type: overview
tags: [phase, physics, semiconductor, transistor]
created: 2026-07-21
language: zh-CN
---

# 阶段 1 · 物理基础 / Phase 1 · Physics Foundations

## 核心问题 / Core Question

> 计算的物理基底是什么?
>
> What is the physical substrate of computation?

## 学习目标 / Learning Objectives

完成本阶段后,你应当能够 / After completing this phase, you should be able to:

1. 解释为什么**硅**成为计算的物质基础(从原子结构到经济原因) / Explain why **silicon** became the material basis of computation (from atomic structure to economics)
2. 描述半导体、PN 结、MOSFET 的工作原理 / Describe the principles of semiconductors, PN junctions, and MOSFETs
3. 画出 NMOS 与 CMOS 反相器的电路图 / Draw the circuit diagrams of NMOS and CMOS inverters
4. 理解光刻与摩尔定律的工程限制 / Understand lithography and Moore's Law engineering limits
5. **关键批判点**: 能说出 LLM 训练消耗多少能量,并将其与物理极限对比 / **Key critique**: State how much energy LLM training consumes and contrast it with physical limits

## 核心概念 / Key Concepts

- [[sand-to-silicon|从沙子到硅:物质基底 / From Sand to Silicon: Material Substrate]]
- [[semiconductor-physics|半导体物理:能带与载流子 / Semiconductor Physics: Bands and Carriers]]
- [[pn-junction|PN 结:整流的诞生 / PN Junction: Birth of Rectification]]
- [[transistor-mosfet|MOSFET:电子开关的奇迹 / MOSFET: The Electron Switch Miracle]]
- [[cmos-and-fabrication|CMOS 与制造工艺 / CMOS and Fabrication]]

## 关键术语 / Key Terms

参见 [[glossary#阶段 1 · 物理基础|术语表阶段 1 部分 / Glossary Phase 1 section]]

## 推荐资源 / Recommended Resources

### 入门 / Introductory
- 《编码:隐匿在计算机软硬件背后的语言》 Charles Petzold
  - *Code: The Hidden Language of Computer Hardware and Software* by Charles Petzold
  - 前 11 章从手电筒讲到半导体,极适合零基础 / Chapters 1-11 go from flashlights to semiconductors, ideal for beginners
- YouTube: *Veritasium* "How To Make a CPU" 系列 / *Veritasius* "How To Make a CPU" series

### 进阶 / Intermediate
- 《数字设计与计算机体系结构》 Harris & Harris,第 1 章
  - *Digital Design and Computer Architecture* by Harris & Harris, Chapter 1
- *But How Do It Know?* by J. Clark Scott

### 深入 / Deep Dive
- *Semiconductor Device Fundamentals* by Robert F. Pierret
- *CMOS VLSI Design* by Weste & Harris

## 关键问题 / Key Questions

完成本阶段后,合上书本,独立回答 / After completing this phase, close the book and answer independently:

1. 为什么是硅,不是锗? 不是碳? / Why silicon, not germanium? Not carbon?
2. PN 结为什么能整流? 用能带图解释。/ Why does a PN junction rectify? Explain using a band diagram.
3. NMOS 和 PMOS 在导通时,载流子分别是什么? / When conducting, what are the carriers in NMOS vs PMOS?
4. 摩尔定律为什么必然会终结? / Why must Moore's Law end?
5. 一颗现代 CPU 有几十亿晶体管,但功耗只有几十瓦。为什么没烧掉? / A modern CPU has billions of transistors but draws only tens of watts. Why doesn't it burn up?

如果第 5 题答不出来,说明你不理解 CMOS 的静态功耗近乎为零 —— 这是整条路径最重要的物理事实之一。

> If you can't answer Question 5, you don't understand that CMOS static power is near zero — one of the most important physical facts in the entire path.

## 阶段反思 / Phase Reflection

学完后回到 [[learning-roadmap#阶段反思机制|反思机制]],问自己 3 个问题。/ After finishing, return to [[learning-roadmap#反思机制 · Reflection Mechanism]] and ask yourself the 3 questions.

---

返回 [[README|首页 / Home]] · 进入 [[02-digital-logic/README|阶段 2 · 数字逻辑 / Phase 2 · Digital Logic]]
