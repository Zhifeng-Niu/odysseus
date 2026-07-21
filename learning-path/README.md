---
title: 学习路径 · 从沙子到范式突破
type: moc
tags: [moc, learning, paradigm-shift, ai, foundational]
created: 2026-07-21
language: zh-CN
---

# 学习路径 · 从沙子到范式突破

> **英文** · Learning Path: From Sand to Paradigm Shift

## 为什么有这份路径 · Why This Path

当下的 AI 行业讨论充满"工业革命""范式转变"这类宏大词汇，但解法层面乏善可陈。LLM 基于 Transformer 架构,本质是对人类过去语言经验的概率逼近——是**组合游戏**,而非**结构突破**。

> The current AI conversation is full of words like "industrial revolution" and "paradigm shift," but solutions remain shallow. LLMs based on Transformer architecture are essentially probabilistic approximations of past human linguistic experience — a **combinatorial game**, not a **structural breakthrough**.

要做出真正的范式突破,必须从最底层(硅物理、二进制)开始,逐层向上理解计算的本质,直到看清当前范式的边界,然后才有可能越过它。

> To make a genuine paradigm shift, one must start from the lowest layer (silicon physics, binary), ascend layer by layer to understand the essence of computation, and only then — seeing the boundary of the current paradigm clearly — possibly transcend it.

## 路径总览 · Path Overview

| 阶段 | 中文 | 英文 | 关键问题 |
|------|------|------|---------|
| [[01-physics-foundations]] | 物理基础:沙子→硅→晶体管 | Physics: Sand → Silicon → Transistor | 计算的物理基底是什么? |
| [[02-digital-logic]] | 数字逻辑:二进制与布尔代数 | Digital Logic: Binary & Boolean Algebra | 为什么 0 和 1 够用? |
| [[03-computer-architecture]] | 计算机架构:冯·诺依曼 | Computer Architecture: Von Neumann | 程序如何"自己跑起来"? |
| [[04-programming-systems]] | 编程与系统:C、OS、编译器 | Programming & Systems: C, OS, Compilers | 人类如何让机器听话? |
| [[05-algorithms-complexity]] | 算法与复杂度 | Algorithms & Complexity | 什么是"难"? |
| [[06-computability-theory]] | 可计算性理论 | Computability Theory | 什么永远算不出? |
| [[07-ai-history]] | AI 简史 | AI History | 70 年里试过什么、失败在哪? |
| [[08-current-paradigm]] | 当前范式:LLM、RL、世界模型 | Current Paradigm: LLM, RL, World Models | 我们现在站在哪里? |
| [[09-paradigm-shift]] | 范式突破方向 | Paradigm Shift Directions | 下一个结构性的可能是什么? |

## 学习方法 · How to Learn

1. **不要跳读前 6 阶段**。前 6 阶段建立"计算是什么"的物理与数学直觉,跳过会导致后面的 AI 讨论变成空谈。
2. **每个阶段都有"关键问题"**。读完材料,关掉屏幕,尝试独立回答。答不出来就是没懂。
3. **中英对照**。术语的英文版本必须记住——所有一手论文、规范、社区都是英文。
4. **手算 + 代码**。二进制手算加法,晶体管用模拟器试,逻辑门用 Logisim,C 语言写一个 hello world,算法自己实现一遍。
5. **批判优先**。读 AI 论文时,先问"这个方法在物理层浪费了什么",再问"效果如何"。

> 1. **Don't skip the first 6 phases**. They build the physical and mathematical intuition for "what computation is." Skip them, and AI discussions become empty talk.
> 2. **Each phase has "Key Questions."** Close your screen after reading and try to answer them independently. If you can't, you didn't understand.
> 3. **Bilingual对照**. English terms must be memorized — primary papers, specs, and communities are all in English.
> 4. **Hand-calc + code**. Do binary addition by hand. Simulate transistors. Use Logisim for logic gates. Write hello world in C. Implement algorithms from scratch.
> 5. **Critique first**. When reading AI papers, ask "what does this method waste at the physical layer" before "how well does it perform."

## 文件组织约定 · File Organization Convention

每个阶段目录包含:
- `README.md` — 阶段总览
- 核心概念的 `.md` 文件,每个文件 ≤ 400 行
- 每个文件顶部都有 `learning-objectives`、`key-terms`、`core-concepts`、`resources`、`questions` 五个 section

> Each phase directory contains:
> - `README.md` — phase overview
> - `.md` files for core concepts, each ≤ 400 lines
> - Each file has five sections at the top: `learning-objectives`, `key-terms`, `core-concepts`, `resources`, `questions`

## 索引 · Index

- [[00-overview/learning-roadmap]] — 完整路线图 / Full Roadmap
- [[00-overview/glossary]] — 中英术语对照表 / Bilingual Glossary
- [[SYNTHESIS]] — 九层综合视角(读完 9 阶段后看) / Nine-layer synthesis (read after the 9 phases)

## 元信息 · Meta

- **创建日期 / Created**: 2026-07-21
- **目标 / Goal**: 建立"范式突破"所需的奠基性知识体系
- **预计周期 / Estimated Duration**: 6-12 个月业余学习 / 6-12 months part-time
- **状态 / Status**: 持续迭代 / Iterative
