---
title: 学习路线图 · Learning Roadmap
type: roadmap
tags: [roadmap, foundational, paradigm-shift]
created: 2026-07-21
language: zh-CN
---

# 学习路线图 · Learning Roadmap

## 起点 · Starting Point

> 除了"AI 不是真正的智能"这一直觉外,我没有任何关于计算、关于智能的奠基性积累。
>
> Besides the intuition that "AI is not genuine intelligence," I have no foundational grounding in computation or intelligence.

这是诚实的起点。从这里出发,我们要走 9 个阶段。

> This is an honest starting point. From here, we walk through 9 phases.

## 路线图全景 · Full Roadmap

```
阶段 1-2: 物理与符号 (硬件是物理的,逻辑是数学的)
Phases 1-2: Physics & Symbols (hardware is physical, logic is mathematical)

  ↓↓↓

阶段 3-4: 架构与编程 (通用性涌现)
Phases 3-4: Architecture & Programming (generality emerges)

  ↓↓↓

阶段 5-6: 算法与极限 (什么是可解的)
Phases 5-6: Algorithms & Limits (what is solvable)

  ↓↓↓

阶段 7-8: AI 历史与当前范式 (我们走到哪里了)
Phases 7-8: AI History & Current Paradigm (where we are)

  ↓↓↓

阶段 9: 范式突破方向 (下一步可能在哪)
Phase 9: Paradigm Shift Directions (where the next step might be)
```

## 各阶段详情 · Phase Details

### 阶段 1 · 物理基础 / Phase 1 · Physics Foundations

- **核心问题**: 计算的物理基底是什么? / What is the physical substrate of computation?
- **关键概念**: [[silicon]], [[semiconductor]], [[transistor]], [[pn-junction]], [[mosfet]]
- **关键资源**:
  - 《编码:隐匿在计算机软硬件背后的语言》 Charles Petzold
  - *Code: The Hidden Language of Computer Hardware and Software*
  - NPTEL Semiconductors 公开课
- **预期时间**: 3-4 周 / 3-4 weeks
- **完成判据**: 能画出 NMOS 晶体管剖面图,解释为什么硅是计算的物质基础 / Can sketch an NMOS cross-section and explain why silicon is the material basis of computation

### 阶段 2 · 数字逻辑 / Phase 2 · Digital Logic

- **核心问题**: 为什么 0 和 1 够用? / Why are 0 and 1 enough?
- **关键概念**: [[binary]], [[hexadecimal]], [[boolean-algebra]], [[logic-gates]], [[karnaugh-map]]
- **关键资源**:
  - 《数字设计与计算机体系结构》 Harris & Harris
  - *Digital Design and Computer Architecture*
  - Logisim (开源逻辑仿真器)
- **预期时间**: 2-3 周 / 2-3 weeks
- **完成判据**: 用 NAND 门搭出加法器 / Build an adder using only NAND gates

### 阶段 3 · 计算机架构 / Phase 3 · Computer Architecture

- **核心问题**: 程序如何"自己跑起来"? / How does a program "run itself"?
- **关键概念**: [[von-neumann-architecture]], [[instruction-set-architecture]], [[cpu-pipeline]], [[memory-hierarchy]], [[interrupts]]
- **关键资源**:
  - 《计算机系统要素》 Nisan & Schocken
  - *The Elements of Computing Systems* (TECS, 又称 Nand2Tetris)
  - 《计算机组成与设计》 Patterson & Hennessy
- **预期时间**: 6-8 周 / 6-8 weeks
- **完成判据**: 完成 Nand2Tetris 项目 1-5 / Complete Nand2Tetris projects 1-5

### 阶段 4 · 编程与系统 / Phase 4 · Programming & Systems

- **核心问题**: 人类如何让机器听话? / How do humans make machines obey?
- **关键概念**: [[c-language]], [[operating-system]], [[compiler]], [[linker]], [[system-call]], [[process-memory-layout]]
- **关键资源**:
  - *The C Programming Language* (K&R)
  - 《深入理解计算机系统》 CSAPP
  - *Computer Systems: A Programmer's Perspective*
  - MIT 6.828 (Operating Systems)
- **预期时间**: 8-12 周 / 8-12 weeks
- **完成判据**: 写一个 shell + 一个小编译器 / Write a shell and a small compiler

### 阶段 5 · 算法与复杂度 / Phase 5 · Algorithms & Complexity

- **核心问题**: 什么是"难"? / What does "hard" mean?
- **关键概念**: [[data-structures]], [[big-o]], [[p-vs-np]], [[np-completeness]], [[reduction]]
- **关键资源**:
  - 《算法导论》 CLRS
  - *Introduction to Algorithms*
  - *Algorithm Design Manual* Skiena
- **预期时间**: 8-10 周 / 8-10 weeks
- **完成判据**: 能独立解释 P vs NP 的精确定义 / Can precisely define P vs NP independently

### 阶段 6 · 可计算性理论 / Phase 6 · Computability Theory

- **核心问题**: 什么永远算不出? / What can never be computed?
- **关键概念**: [[turing-machine]], [[church-turing-thesis]], [[godel-incompleteness]], [[halting-problem]], [[information-theory]], [[shannon-entropy]]
- **关键资源**:
  - *Gödel, Escher, Bach* Hofstadter
  - *Introduction to the Theory of Computation* Sipser
  - *Information Theory and Reliable Communication* Gallager
- **预期时间**: 6-8 周 / 6-8 weeks
- **完成判据**: 能解释图灵停机问题为什么不可解 / Can explain why the Halting Problem is unsolvable

### 阶段 7 · AI 简史 / Phase 7 · AI History

- **核心问题**: 70 年里试过什么、失败在哪? / What was tried over 70 years, and where did it fail?
- **关键概念**: [[symbolic-ai]], [[perceptron]], [[connectionism]], [[backpropagation]], [[deep-learning-winter]], [[transformer-architecture]]
- **关键资源**:
  - *Artificial Intelligence: A Modern Approach* Russell & Norvig
  - 《深度学习》 Goodfellow
  - 论文合集: McCulloch-Pitts (1943), Rosenblatt (1958), Rumelhart (1986), Vaswani (2017)
- **预期时间**: 6-8 周 / 6-8 weeks
- **完成判据**: 能画出 AI 七十年的方法论潮汐图 / Can draw the methodological tide chart of AI's 70 years

### 阶段 8 · 当前范式 / Phase 8 · Current Paradigm

- **核心问题**: 我们现在站在哪里? / Where do we stand now?
- **关键概念**: [[llm-essence]], [[scaling-laws]], [[reinforcement-learning]], [[world-models]], [[reinforcement-learning-from-human-feedback]]
- **关键资源**:
  - 论文: *Scaling Laws* (Kaplan 2020, Chinchilla 2022)
  - 论文: * reinforcement Learning: An Introduction* Sutton & Barto
  - *World Models* Ha & Schmidhuber (2018)
  - *Direct Preference Optimization* (Rafailov 2023)
- **预期时间**: 4-6 周 / 4-6 weeks
- **完成判据**: 能清晰说出 LLM 能做什么、不能做什么,边界在哪 / Can clearly articulate what LLMs can and cannot do, and where the boundary lies

### 阶段 9 · 范式突破方向 / Phase 9 · Paradigm Shift Directions

- **核心问题**: 下一个结构性的可能是什么? / What is the next structural possibility?
- **关键概念**: [[jepa]], [[active-inference]], [[causal-reasoning]], [[predictive-coding]], [[compressive-ai]], [[model-based-rl]]
- **关键资源**:
  - Yann LeCun JEPA 系列论文 (2022, 2023, I-JEPA, V-JEPA)
  - Karl Friston *Active Inference* (2022)
  - Judea Pearl *Causality* (2009, 2018)
  - Jürgen Schmidhuber on Compressive AI / RNN / World Models
  - *World Models* Ha & Schmidhuber (2018)
- **预期时间**: 持续 / Ongoing
- **完成判据**: 形成自己的判断:哪些方向是真突破,哪些是换包装 / Form independent judgment on which directions are real breakthroughs vs repackaging

## 节奏建议 · Pacing Recommendation

- **每天**: 30-60 分钟 / 30-60 minutes daily
- **每周**: 1 次 2-3 小时的深度阅读 + 1 次代码实践 / One 2-3 hour deep reading session + one coding session per week
- **每月**: 写一篇中文笔记 + 一篇英文笔记 / One Chinese note + one English note per month
- **每个阶段结束**: 用 Feynman 技巧向自己解释一遍 / At each phase end, explain it to yourself using the Feynman technique

## 警告 · Warnings

- **不要**只读不看。计算是手艺活。/ **Don't** just read. Computation is a craft.
- **不要**跳到阶段 9。没有 1-6 阶段的基底,阶段 9 是空中楼阁。/ **Don't** skip to Phase 9. Without Phases 1-6, it's a castle in the air.
- **不要**只看二手解读。一手论文必须读,哪怕一次只读 1 页。/ **Don't** only read secondary interpretations. Primary papers are mandatory, even if only 1 page at a time.
- **不要**迷信大佬。LeCun、Schmidhuber、Friston 都有自己的盲点。/ **Don't** idolize leaders. LeCun, Schmidhuber, Friston all have their blind spots.

## 反思机制 · Reflection Mechanism

每个阶段结束时,问自己 3 个问题 / At the end of each phase, ask yourself:

1. 这个阶段最让我意外的是什么? / What surprised me most in this phase?
2. 这个阶段的哪个概念我至今讲不清楚? / Which concept in this phase can I still not articulate clearly?
3. 这个阶段如何改变了阶段 7-9 我对 AI 的判断? / How did this phase change my judgment of AI in Phases 7-9?

如果第 2 个问题答不出具体概念,说明这个阶段没真正学完。回去补。

> If you can't name a specific concept for Question 2, you haven't truly finished this phase. Go back.
