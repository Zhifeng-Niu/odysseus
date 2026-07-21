---
title: 半导体物理 · Semiconductor Physics
type: concept
phase: 1
tags: [semiconductor, band-theory, doping, carrier]
created: 2026-07-21
language: zh-CN
---

# 半导体物理 · Semiconductor Physics

> **学习目标 / Learning Objectives**
> - 用能带理论解释导体、绝缘体、半导体的差别 / Explain the difference between conductors, insulators, and semiconductors using band theory
> - 理解掺杂如何创造 N 型与 P 型半导体 / Understand how doping creates N-type and P-type semiconductors
> - 看清"电子流"与"空穴流"是同一个物理过程的两种描述 / See that "electron flow" and "hole flow" are two descriptions of the same physical process

> **关键术语 / Key Terms**
> - 能带 Energy band · 价带 Valence band · 导带 Conduction band · 带隙 Band gap · 费米能级 Fermi level · 掺杂 Doping · 多数载流子 Majority carrier · 少数载流子 Minority carrier

## 能带理论:理解半导体的钥匙 / Band Theory: The Key to Understanding Semiconductors

### 什么是能带? / What Are Energy Bands?

孤立原子的电子只能占据离散的能级。但当大量原子紧密排列(如晶体)时,每个原子的能级因为泡利不相容原理而**分裂成密集的能级带**——能带。

> Isolated atoms have discrete energy levels. But when many atoms pack tightly (as in a crystal), Pauli exclusion splits each level into a dense **energy band**.

```
能量 Energy
  ↑
  |  导带 Conduction band (自由电子 free electrons)
  |
  |  间隙 = 带隙 Band gap (禁带)
  |
  |  价带 Valence band (束缚电子 bound electrons)
  |
  +-----------------------------------
```

### 三种材料,三种带隙 / Three Materials, Three Band Gaps

| 材料 Material | 带隙 Band Gap | 室温导电? Conductive at RT? | 例子 Example |
|------------|------------|------------------------|-----------|
| 导体 Conductor | 0 (导带与价带重叠) | 是 Yes | 铜 Copper, 铝 Aluminum |
| 绝缘体 Insulator | 大 (~5-10 eV) | 否 No | 金刚石 Diamond (~5.5 eV), SiO₂ (~9 eV) |
| 半导体 Semiconductor | 中等 (~0.5-3 eV) | 微弱 Weakly | 硅 Si (1.12 eV), 锗 Ge (0.67 eV), 砷化镓 GaAs (1.42 eV) |

**关键洞察**: 硅的带隙是 1.12 eV,刚好让少量电子在室温下被热激发进入导带。

> **Key Insight**: Silicon's band gap is 1.12 eV, just enough for a small number of electrons to be thermally excited into the conduction band at room temperature.

- 太小(如 0.1 eV) → 热激发太多 → 难以控制 → 不适合做逻辑开关
  - Too small → too much thermal excitation → hard to control → unsuitable for logic switches
- 太大(如 5 eV) → 热激发太少 → 完全不导电 → 用作绝缘体
  - Too large → too little thermal excitation → completely non-conductive → used as insulator
- **1.12 eV 是工程上的甜蜜点**
  - **1.12 eV is the engineering sweet spot**

### 本征半导体:纯净的硅 / Intrinsic Semiconductor: Pure Silicon

本征半导体 = 没有任何杂质的纯净硅。

> Intrinsic semiconductor = pure silicon with no impurities.

在室温下,每立方厘米约 1.5 × 10¹⁰ 个电子被热激发进入导带。同时,这些电子离开后留下"空穴"。

> At room temperature, ~1.5 × 10¹⁰ electrons/cm³ are thermally excited into the conduction band. They leave behind "holes."

```
价带 Valence band:                  导带 Conduction band:
... ▓ ▓ ░ ▓ ▓ ...    电子 e⁻ →     ... ░ ░ ● ░ ░ ...

    ▓ = 电子 electron
    ░ = 空穴 hole (电子离开后留下的"虚位")
```

**空穴可导电吗? / Can holes conduct?**

可以!虽然空穴本质是"没有电子",但我们可以把它当成**带正电的粒子**。邻近电子来填补空穴,等于空穴"移动"了。

> Yes! Though a hole is fundamentally "no electron," we can treat it as a **positively charged particle**. A neighboring electron fills the hole, which means the hole "moved."

这种"双载流子"思维是半导体物理的基础。

> This "two-carrier" thinking is the foundation of semiconductor physics.

## 掺杂:把半导体"调"到我们想要的样子 / Doping: Tuning Semiconductors to What We Want

本征半导体的导电性太弱(电阻率高),无法直接做器件。我们需要**掺杂** —— 故意加入微量杂质原子。

> Intrinsic semiconductors are too weakly conductive to use directly. We need **doping** — intentionally introducing trace impurity atoms.

### N 型掺杂 / N-Type Doping

向硅中加入**第 15 族元素**(磷 P、砷 As、锑 Sb),它们有 5 个价电子。

> Add **Group 15 elements** (phosphorus P, arsenic As, antimony Sb) — they have 5 valence electrons.

```
        Si --- P --- Si        P 替换 Si,多出 1 个电子
        |     |      |
        Si --- Si --- Si

磷 P 的 5 个价电子,4 个与硅成键,多 1 个 → 自由电子
Phosphorus has 5 valence electrons; 4 bond with Si, 1 left over → free electron
```

- 电子是**多数载流子** / Electrons are **majority carriers**
- 空穴是**少数载流子** / Holes are **minority carriers**
- "N" = Negative (负),因为电子带负电 / "N" = Negative, because electrons are negative

### P 型掺杂 / P-Type Doping

向硅中加入**第 13 族元素**(硼 B、铝 Al、镓 Ga、铟 In),它们有 3 个价电子。

> Add **Group 13 elements** (boron B, aluminum Al, gallium Ga, indium In) — they have 3 valence electrons.

```
        Si --- B --- Si        B 替换 Si,缺 1 个电子
        |     |      |
        Si --- Si --- Si

硼 B 的 3 个价电子全部成键,还差 1 个 → 空穴
Boron has 3 valence electrons, all bond, still 1 short → hole
```

- 空穴是**多数载流子** / Holes are **majority carriers**
- 电子是**少数载流子** / Electrons are **minority carriers**
- "P" = Positive (正),因为空穴视为带正电 / "P" = Positive, because holes are treated as positive

### 掺杂浓度:从 ppb 到 ppm / Doping Concentration: ppb to ppm

典型掺杂浓度:每 10⁷ 到 10⁹ 个硅原子掺 1 个杂质原子。即 **0.1 ppm 到 0.0001 ppm**。

> Typical doping: 1 impurity atom per 10⁷ to 10⁹ silicon atoms — **0.1 ppm to 0.0001 ppm**.

剂量极小,但效果惊人:掺杂后的硅电导率比纯净硅高 **数百万倍**。

> Tiny dose, dramatic effect: doped silicon is **millions of times** more conductive than pure silicon.

## 费米能级:半导体物理的"水线" / Fermi Level: The "Waterline" of Semiconductor Physics

费米能级 E_F 是热力学上电子填充概率为 0.5 的能级。把它想成"水线"。

> Fermi level E_F is the energy level with electron occupation probability 0.5. Think of it as a "waterline."

- 在 N 型半导体中,E_F 接近导带(水线靠近上) / In N-type, E_F is near conduction band
- 在 P 型半导体中,E_F 接近价带(水线靠近下) / In P-type, E_F is near valence band
- 在本征半导体中,E_F 在带隙中央 / In intrinsic, E_F is in the middle of the band gap

费米能级差是 PN 结电场的来源,这是下一章 [[pn-junction]] 的核心。

> Fermi level difference is the source of the PN junction electric field — the core of the next chapter [[pn-junction]].

## 半导体物理与 LLM / Semiconductor Physics and LLMs

这是阶段 1 与阶段 8 的桥梁 / This is the bridge between Phase 1 and Phase 8:

1. **LLM 训练能耗的物理基础**: 每次 MOSFET 翻转都有 RC 充放电损耗(动态功耗 P = αCV²f)。千亿参数模型训练一次消耗吉瓦时级电力,全部转化为热。
   > Each MOSFET toggle has RC charging/discharging loss (dynamic power P = αCV²f). A 100-billion-parameter model training consumes GWh of electricity, all converted to heat.

2. **能量效率的物理极限**: Landauer 原理说擦除 1 比特信息最少需要 kT·ln(2) ≈ 2.8 × 10⁻²¹ 焦耳。现代 CPU 的每比特能耗是这个的 ~10000 倍。还有巨大的优化空间,但不是通过 LLM 这种"压缩信息"的方式。
   > Landauer's principle: erasing 1 bit requires at least kT·ln(2) ≈ 2.8 × 10⁻²¹ J. Modern CPUs consume ~10000× this per bit. Huge optimization space remains, but not via the "information compression" approach of LLMs.

3. **为什么"压缩信息"不能产生真智能**: 物理层,硅在能量上廉价;信息层,LLM 用海量比特压缩"人类语言"这种已经被人类高度处理过的数据。这是**两层浪费**:物理上的能源 + 信息上的二次压缩。
   > Why "information compression" can't produce true intelligence: at the physical layer, silicon is cheap; at the information layer, LLMs use massive bits to compress "human language" — data already heavily processed by humans. This is **two-layer waste**: physical energy + secondary information compression.

## 关键问题 / Questions

1. 用能带图解释为什么金刚石是绝缘体,而硅是半导体(尽管两者都是第 14 族共价晶体)。/ Use a band diagram to explain why diamond is an insulator while silicon is a semiconductor (both Group 14 covalent crystals).
2. 掺杂浓度从 10¹⁵ cm⁻³ 增加到 10¹⁸ cm⁻³,N 型硅的电导率增加多少倍? / Doping increases from 10¹⁵ cm⁻³ to 10¹⁸ cm⁻³. How many times does N-type silicon conductivity increase?
3. 在绝对零度,本征硅完全不导电吗?在 1000°C 呢? / At absolute zero, is intrinsic silicon completely non-conductive? At 1000°C?

## 推荐资源 / Resources

- 书 / Book: *Semiconductor Device Fundamentals* — Robert F. Pierret (第 1-4 章 / Chapters 1-4)
- 视频 / Video: *NOC: Semiconductor Devices* — NPTEL (印度理工,英文讲义清晰 / IIT India, clear English lectures)
- 互动 / Interactive: PhET "Semiconductor" 模拟器 / PhET "Semiconductor" simulator

---

参见 / See also: [[sand-to-silicon]], [[pn-junction]], [[transistor-mosfet]]
