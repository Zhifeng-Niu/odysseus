---
title: PN 结 · PN Junction
type: concept
phase: 1
tags: [pn-junction, diode, rectification, depletion-region]
created: 2026-07-21
language: zh-CN
---

# PN 结 · PN Junction

> **学习目标 / Learning Objectives**
> - 理解 PN 结的形成过程,以及耗尽层的来源 / Understand PN junction formation and the origin of the depletion region
> - 解释为什么 PN 结能"整流"(单向导电) / Explain why PN junctions rectify (one-way conduction)
> - 看到PN结是如何从"被动结构"变成"主动器件"的桥梁 / See how the PN junction bridges "passive structure" to "active device"

> **关键术语 / Key Terms**
> - PN 结 PN junction · 耗尽层 Depletion region · 内建电场 Built-in electric field · 整流 Rectification · 正向偏置 Forward bias · 反向偏置 Reverse bias

## PN 结的形成:两片半导体相接触 / Formation: Two Semiconductor Pieces Meet

把一块 P 型硅和一块 N 型硅**直接接触**(实际工艺是同一块硅上分别掺杂 P 区与 N 区),会发生什么?

> Put a P-type and an N-type silicon **in direct contact** (in practice, doped into regions of the same crystal). What happens?

### 第 0 步:刚刚接触的瞬间 / Step 0: The Moment of Contact

```
      P 区 (空穴多)        |        N 区 (电子多)
      ░░░░░░░░░░░░░      |        ●●●●●●●●●●●●●
                          |
   空穴 ░ 多数载流子              ● 电子 多数载流子
   费米能级靠近价带                 费米能级靠近导带
```

- P 区空穴浓度 ~10¹⁸ cm⁻³, N 区空穴浓度 ~10⁴ cm⁻³ → 空穴从 P → N 扩散 / Holes diffuse P → N
- N 区电子浓度 ~10¹⁸ cm⁻³, P 区电子浓度 ~10⁴ cm⁻³ → 电子从 N → P 扩散 / Electrons diffuse N → P

**扩散是熵驱动的:粒子从高浓度流向低浓度,如同墨水滴入水。**

> Diffusion is entropy-driven: particles flow high → low concentration, like ink in water.

### 第 1 步:载流子复合,留下固定电荷 / Step 1: Carriers Recombine, Leaving Fixed Charges

扩散过来的电子和空穴在 PN 界面相遇,**复合** (annihilate),留下**固定的杂质离子电荷**:

> Diffused electrons and holes meet at the PN interface, **recombine**, leaving **fixed impurity ion charges**:

```
      P 区              |          N 区
      ░░░░░░  ← 空穴减少    电子减少 → ●●●●●●
      ----  ←  负离子 (受主) | (施主) 正离子  → ----
                          |
       [耗尽层 Depletion Region]
       ←─────────────────→
       内建电场 E (N → P)
```

- P 区一侧,失去空穴的硼原子变成**负离子** (固定不动) / On P side, boron atoms that lost holes become **negative ions** (fixed)
- N 区一侧,失去电子的磷原子变成**正离子** (固定不动) / On N side, phosphorus atoms that lost electrons become **positive ions** (fixed)
- 这个区域不再有自由载流子 → 称为**耗尽层** (depletion region) / This region has no free carriers → **depletion region**

### 第 2 步:内建电场阻止继续扩散 / Step 2: Built-in E-field Stops Further Diffusion

固定电荷形成**内建电场** E (从 N 指向 P)。这个电场阻止电子从 N → P 继续扩散,也阻止空穴从 P → N 继续扩散。

> Fixed charges form a **built-in electric field** E (from N to P). This field stops further diffusion.

**平衡态**: 扩散 = 漂移,耗尽层宽度稳定(典型 ~1 μm)。这就是 PN 结的稳态。

> **Equilibrium**: diffusion = drift. Depletion width stabilizes (typically ~1 μm). This is the PN junction steady state.

## PN 结的整流性:电子的单向门 / Rectification: The One-Way Gate for Electrons

### 正向偏置(电池正极接 P,负极接 N)/ Forward Bias (battery + to P, − to N)

外加电场**抵消**内建电场 → 耗尽层变窄 → P 区空穴被推向结,N 区电子被推向结 → 大量复合 → **大电流**。

> Applied field **cancels** built-in field → depletion narrows → P holes pushed to junction, N electrons pushed to junction → massive recombination → **large current**.

### 反向偏置(电池正极接 N,负极接 P)/ Reverse Bias (battery + to N, − to P)

外加电场**增强**内建电场 → 耗尽层变宽 → 载流子被拉离结 → 几乎没有复合 → **极小漏电流**。

> Applied field **enhances** built-in field → depletion widens → carriers pulled away from junction → little recombination → **tiny leakage current**.

### I-V 曲线:单向门的最直接表达 / I-V Curve: Direct Expression of the One-Way Gate

```
电流 I
  ↑
  |                正向 Forward (大电流 large current)
  |               /
  |              /
  |             /
  |------------+------------→ 电压 V
  |           /
  |          /
  |         反向 Reverse (微小漏电流 tiny leakage)
  |
```

**这就是整流**: 电流几乎只能从 P → N 通过(传统电流方向)。

> **This is rectification**: current flows almost only from P → N (conventional direction).

## 为什么 PN 结是半导体器件的基石? / Why Is the PN Junction the Cornerstone of Semiconductor Devices?

### 1. 二极管:最简单的 PN 结 / 1. Diode: The Simplest PN Junction

PN 结本身就是一个二极管: 单向导电。

> A PN junction is itself a diode: one-way conduction.

### 2. 双极型晶体管(BJT):两个 PN 结背靠背 / 2. BJT: Two PN Junctions Back-to-Back

NPN 或 PNP 结构,中间的基极很薄,可让发射结注入的载流子穿过到达集电结 → 信号放大。

> NPN or PNP structure with thin middle base; carriers injected by emitter traverse to collector → amplification.

### 3. MOS 电容:用 PN 结做衬底 / 3. MOS Capacitor: PN Junction as Substrate

MOSFET 的源极和漏极就是两个 N+ (重掺杂 N 型) 区域嵌入 P 型衬底 —— 两个 PN 结。这就是下一章 [[transistor-mosfet]] 的基础。

> MOSFET source and drain are two N+ (heavily doped N) regions embedded in a P substrate — two PN junctions. This is the basis of the next chapter [[transistor-mosfet]].

### 4. 太阳能电池:光生载流子被 PN 结电场分离 / 4. Solar Cell: Photogenerated Carriers Separated by PN Junction Field

光照激发电子-空穴对,PN 结电场将它们分开 → 光电流。

> Light excites electron-hole pairs; PN junction field separates them → photocurrent.

### 5. LED:复合时释放光子 / 5. LED: Photons Released on Recombination

正向偏置下,电子从 N 跃迁到 P 与空穴复合,释放能量 → 光子。

> Under forward bias, electrons jump from N to P, recombine with holes, release energy → photons.

## 历史与意义 / History and Significance

- **1874 年 Ferdinand Braun** 发现金属-硫化物接触整流现象(不是 PN 结,但是单向导电的首次发现) / Discovered rectification in metal-sulfide contacts (not PN junction, but first observation of one-way conduction)
- **1930s-40s Russell Ohl** 在 Bell Labs 意外发现硅 PN 结光生伏特效应 / Accidentally discovered silicon PN junction photovoltaic effect at Bell Labs
- **1947 年 Bardeen, Brattain, Shockley** 发明晶体管(基于 PN 结理解) / Invented the transistor (based on PN junction understanding)
- **1959 年 Jean Hoerni** 发明平面工艺,使 PN 结可在硅片上"印刷" → 集成电路成为可能 / Invented planar process, enabling PN junctions to be "printed" on silicon → integrated circuits became possible

## 工程直觉 / Engineering Intuitions

1. **PN 结的本质是"打破对称性"** / The essence of PN junction is "breaking symmetry."
   没有 P 区和 N 区的差异,就没有二极管,就没有逻辑开关。**所有计算都依赖不对称性**。
   Without the P-N difference, no diodes, no logic switches. **All computation depends on asymmetry.**

2. **整流的本质是耗尽层的可调宽度** / Rectification is essentially tunable depletion width.
   外加电压改变耗尽层,耗尽层改变电流。所有半导体放大器、开关、存储都是这个原理的变体。
   Applied voltage changes depletion; depletion changes current. All semiconductor amplifiers, switches, memory are variants of this principle.

3. **PN 结是物理层的"if 语句"** / PN junction is the physical-layer "if statement."
   逻辑层的 if/else 在物理层就是 PN 结的单向门。当你写代码 if (x > 0),编译器最终把它翻译成无数个晶体管的开关,每个晶体管内部都有 PN 结在工作。
   The logical if/else is physically the PN junction one-way gate. When you write `if (x > 0)`, the compiler ultimately translates it into billions of transistor switches, each with PN junctions at work.

## 关键问题 / Questions

1. 反向偏置下,耗尽层宽度会增加。从能量角度看,额外能量储存在哪里? / Under reverse bias, depletion width increases. From an energy perspective, where is the extra energy stored?
2. 当 PN 结温度升高,反向漏电流会显著增加。为什么? / When PN junction temperature rises, reverse leakage current increases significantly. Why?
3. 不对称的 PN 结(P⁺N 即 P 重掺杂、N 轻掺杂)与对称 PN 结,整流性有何不同? / Asymmetric P⁺N junction (P heavily doped, N lightly doped) vs symmetric PN: how does rectification differ?

## 推荐资源 / Resources

- 书 / Book: *Semiconductor Device Fundamentals* — Pierret (第 5-7 章 / Chapters 5-7)
- 视频 / Video: *Brilliant* "PN Junction" 互动课程 / Interactive course
- 论文 / Paper: Ohl, R. S. (1941). *Light-Sensitive Electric Device*. US Patent 2402662. — 历史一手材料 / Historical primary source

---

参见 / See also: [[semiconductor-physics]], [[transistor-mosfet]]
