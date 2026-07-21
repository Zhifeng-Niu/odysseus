---
title: CMOS 与制造工艺 · CMOS and Fabrication
type: concept
phase: 1
tags: [cmos, fabrication, lithography, moores-law]
created: 2026-07-21
language: zh-CN
---

# CMOS 与制造工艺 · CMOS and Fabrication

> **学习目标 / Learning Objectives**
> - 理解 CMOS 逻辑门的设计模式(反相器、NAND、NOR) / Understand CMOS logic gate design patterns (inverter, NAND, NOR)
> - 掌握半导体制造的核心工艺:光刻、刻蚀、离子注入、沉积 / Master semiconductor manufacturing core processes: lithography, etching, ion implantation, deposition
> - 看清摩尔定律的物理与经济双重极限 / See Moore's Law's physical and economic limits

> **关键术语 / Key Terms**
> - 互补 MOS Complementary MOS (CMOS) · 光刻 Lithography · 刻蚀 Etching · 离子注入 Ion implantation · 沉积 Deposition · 互连 Interconnect · 晶圆代工 Foundry · 工艺节点 Process node

## CMOS 逻辑门:从开关到逻辑 / CMOS Logic Gates: From Switches to Logic

### 上拉/下拉网络:CMOS 的通用结构 / Pull-Up / Pull-Down Networks: CMOS General Structure

每个 CMOS 逻辑门都是这样的结构 / Every CMOS gate follows this pattern:

```
         V_DD (电源 supply)
           |
       ┌───┴───┐
       │       │       ← 上拉网络 Pull-Up Network (PMOS)
       │  PMOS │         实现 F' (输出反函数)
       │       │
       └───┬───┘
           ├─────→ 输出 Output F
       ┌───┴───┐
       │       │       ← 下拉网络 Pull-Down Network (NMOS)
       │  NMOS │         实现 F
       │       │
       └───┬───┘
           |
          GND (地)
```

**规则**: 上拉网络是下拉网络的"对偶" —— 串联变并联,并联变串联。这保证了任意输入组合下,输出要么被上拉到 V_DD,要么被下拉到 GND,永远不会悬空。

> **Rule**: The pull-up network is the "dual" of the pull-down — series becomes parallel, parallel becomes series. This ensures any input combination drives output to either V_DD or GND, never floating.

### NAND 门(两输入) / 2-Input NAND Gate

NAND 是逻辑代数中的**通用门** —— 任何逻辑都可以只用 NAND 实现。

> NAND is a **universal gate** — any logic can be built using only NAND.

```
         V_DD
           |
       ┌───┴───┐
       │       │
      PMOS   PMOS      ← 两个 PMOS 并联 parallel
   A─┤├─   B─┤├─
       │       │
       └───┬───┘
           ├─────→ 输出 = ¬(A∧B)
       ┌───┴───┐
       │       │
      NMOS   NMOS      ← 两个 NMOS 串联 series
   A─┤├─   B─┤├─
       │       │
       └───┬───┘
           |
          GND
```

工作原理 / How it works:

- A=0, B=0 → PMOS 都导通 → 输出 V_DD → 输出 1 ✓ (NAND(0,0)=1)
- A=0, B=1 → PMOS A 导通 → 输出 V_DD → 输出 1 ✓ (NAND(0,1)=1)
- A=1, B=0 → PMOS B 导通 → 输出 V_DD → 输出 1 ✓ (NAND(1,0)=1)
- A=1, B=1 → PMOS 都关断, NMOS 都导通 → 输出 GND → 输出 0 ✓ (NAND(1,1)=0)

**所有逻辑都能这样构建。** AND = NAND + 反相器。XOR 用 4 个 NAND 实现。一个加法器用 ~9 个 NAND。一个 32 位 CPU 用 ~10⁹ 个 NAND。

> **All logic can be built this way.** AND = NAND + inverter. XOR uses 4 NANDs. An adder ~9 NANDs. A 32-bit CPU ~10⁹ NANDs.

## 半导体制造工艺:八步循环 / Semiconductor Manufacturing: The 8-Step Cycle

### 整体流程:从晶圆到芯片 / Overall: From Wafer to Chip

```
┌────────────────────────────────────────────┐
│ 1. 晶圆 Wafer (起点 starting point)         │
└─────────────┬──────────────────────────────┘
              ↓
      [重复 repeat N 次, N = 20-100 层 layers]
              │
              ├─→ 2. 沉积 Deposition (SiO₂, Si₃N₄, 多晶硅 polysilicon, 金属 metal)
              │
              ├─→ 3. 光刻胶 Photoresist (涂布 coating)
              │
              ├─→ 4. 光刻 Lithography (紫外光通过掩模曝光 UV exposes via mask)
              │
              ├─→ 5. 显影 Develop (洗掉曝光区/未曝光区)
              │
              ├─→ 6. 刻蚀 Etching (干法/湿法,移除裸露材料 dry/wet, remove exposed material)
              │
              ├─→ 7. 离子注入 Ion Implantation (掺杂 dope source/drain regions)
              │
              └─→ 8. 去胶 Resist strip + 退火 Anneal (激活掺杂 activate dopants)
              
              ↓ (循环 20-100 次 cycles)
              
┌────────────────────────────────────────────┐
│ 最终 Final: 测试 test → 切片 dice → 封装 package → 芯片 chip │
└────────────────────────────────────────────┘
```

### 第 4 步光刻:整个工艺的核心 / Step 4 Lithography: The Heart of the Process

光刻就是把电路图"投影"到硅片上,如同照相。

> Lithography "projects" the circuit pattern onto silicon, like photography.

```
        [紫外光源 UV light source]
              ↓
        [光学系统 optics]
              ↓
        [掩模 Mask / Reticle]  ←—— 这里是电路图的放大版 circuit pattern
              ↓
        [缩小透镜 reduction lens]  (通常 4:1 缩小 reduction)
              ↓
        [光刻胶 Photoresist on wafer]
              ↓
        [晶圆 Wafer]
```

**关键技术参数 / Key technical parameters**:

1. **光源波长 Wavelength λ**: 436nm (g-line) → 248nm (KrF) → 193nm (ArF) → 13.5nm (EUV, 极紫外)
   > Shorter wavelength → smaller features
2. **数值孔径 Numerical Aperture NA**: 透镜收集光的能力 / Lens's light-gathering ability
3. **分辨率 Resolution R = k₁ · λ / NA**: 决定最小特征尺寸 / Determines minimum feature size

**EUV (极紫外光刻)** 是当前最尖端技术 / **EUV (Extreme Ultraviolet Lithography)** is today's leading edge:
- 波长 13.5nm (是 ArF 的 1/14) / Wavelength 13.5nm (1/14 of ArF)
- 由 ASML 独家供应,每台机器 ~$300M / Supplied exclusively by ASML, ~$300M each
- 用激光每秒 50000 次轰击锡液滴产生等离子体,发出 13.5nm 光 / Fires lasers at tin droplets 50000×/sec to produce plasma emitting 13.5nm light
- 整个光路必须在真空中,且全部用反射镜(没有透镜能透 13.5nm) / Entire path must be vacuum with mirrors only (no lens transmits 13.5nm)

### 第 7 步离子注入:精确掺杂 / Step 7 Ion Implantation: Precise Doping

把杂质原子(磷、硼等)电离成离子,用电场加速到几十到几百 keV,打到硅表面。离子嵌入硅中,深度由能量决定。

> Ionize impurity atoms (P, B, etc.), accelerate to tens or hundreds of keV, bombard the silicon surface. Ions embed in silicon; depth determined by energy.

**优点 / Advantages**:
- 掺杂浓度精确(±1%) / Precise doping concentration (±1%)
- 掺杂深度可控 / Controllable doping depth
- 避免横向扩散 / Avoids lateral diffusion

## 摩尔定律:经验规律及其终结 / Moore's Law: Empirical Observation and Its End

### 摩尔定律原始陈述 / Original Statement

1965 年 Gordon Moore(Intel 联合创始人)观察:每 12 个月(后来修正为 18-24 个月),单位面积的晶体管数量翻倍。

> In 1965, Gordon Moore (Intel co-founder) observed: every 12 months (later revised to 18-24 months), transistor count per unit area doubles.

```
晶体管数量 Transistors/chip (log scale)
   ↑
   |                              ●  Apple M4 (28B)
   |                        ●  Apple M1 (16B)
   |                   ●  AMD Epyc (40B)
   |             ●  Intel Core i9 (10B)
   |        ●  Intel Core 2 (0.3B)
   |    ●  Pentium (3M)
   |  ●  Intel 386 (0.3M)
   |● Intel 4004 (2300, 1971)
   +-----------------------------→ 时间 Year
   1971   1990   2010   2025
```

### 摩尔定律的双重极限 / The Dual Limits of Moore's Law

#### 物理极限 / Physical Limits

1. **栅氧厚度接近原子尺度** / Gate oxide approaches atomic scale
   SiO₂ 栅氧已经只有 0.5nm 厚 ~ 5 个原子层。再薄就会因量子隧穿漏电。/ SiO₂ gate oxide is now only 0.5nm ~ 5 atomic layers. Thinner → quantum tunneling leakage.
   
2. **互连线延迟超过晶体管延迟** / Interconnect delay exceeds transistor delay
   金属线越细,电阻越大。RC 延迟成为关键瓶颈。/ Thinner metal wires → higher resistance. RC delay becomes the bottleneck.

3. **散热极限** / Thermal limits
   晶体管密度高 → 单位面积功耗激增 → 散热成为不可能任务 → "暗硅" (Dark Silicon) 现象:芯片上很多区域必须关闭以避免过热。
   > Higher density → power density explodes → heat dissipation impossible → "Dark Silicon": large chip regions must be powered off.

#### 经济极限 / Economic Limits

1. **晶圆厂成本指数增长** / Fab cost grows exponentially
   1990 年代一座晶圆厂 ~$1B。2024 年一座 3nm 晶圆厂 ~$20B(台积电亚利桑那厂)。/ A fab cost ~$1B in the 1990s. A 3nm fab ~$20B in 2024 (TSMC Arizona).
   
2. **掩模成本指数增长** / Mask cost grows exponentially
   一套 28nm 掩模 ~$2M。一套 3nm EUV 掩模 ~$50M。/ A 28nm mask set ~$2M. A 3nm EUV mask set ~$50M.
   
3. **设计复杂度** / Design complexity
   百亿晶体管的芯片,需要几千工程师 + 几亿美元设计成本。/ A 10B-transistor chip requires thousands of engineers and hundreds of millions of dollars.

### 摩尔定律之后 / After Moore's Law

| 方向 Direction | 含义 Meaning | 主要玩家 Key Players |
|-----------|-----------|----------------|
| More Moore | 继续缩小晶体管尺寸 Continue shrinking transistors | TSMC, Samsung, Intel |
| More than Moore | 系统级集成(3D 堆叠,Chiplet) System-level integration | AMD, Intel, TSMC |
| Beyond CMOS | 用新材料/新原理(自旋、相变、忆阻、量子) New materials/physics | 研究阶段 Research stage |

**关键观察**: 摩尔定律的终结意味着"白拿"的算力增长结束了。这意味着:**未来的 AI 进步不能再依赖"硬件变便宜",必须在算法层做出结构性突破。**

> **Key observation**: The end of Moore's Law means "free" compute growth is over. This means: **future AI progress cannot depend on "hardware getting cheaper" — it requires structural algorithmic breakthroughs.**

## 与 LLM 的连接 / Connection to LLMs

1. **训练成本向用户集中**: GPT-4 训练 ~$100M。下一代模型预计 ~$1B-10B。这种成本只有少数几家公司能承担,导致 AI 算力高度集中 —— 与个人电脑的民主化相反。
   > GPT-4 training ~$100M. Next-gen ~$1B-10B. Only a few companies can afford this, concentrating AI compute — opposite to the democratization of personal computers.

2. **算力垄断 → 范式锁定**: 当所有玩家都用 NVIDIA H100 时,算法研究被锁定在"适合 H100 的算法"(密集矩阵乘法)。新的稀疏、模拟、神经形态算法即使更优,也难找到硬件支持。
   > When all players use NVIDIA H100s, algorithm research is locked into "H100-friendly algorithms" (dense matrix multiplication). New sparse/analog/neuromorphic algorithms, even if better, struggle for hardware support.

3. **芯片短缺即文明瓶颈**: 2020-2023 年全球芯片短缺导致汽车、手机、医疗设备全面减产。**硅已成为现代文明的咽喉**。任何 AI 范式突破都要回答:这个新范式用什么硬件?能不能量产?
   > 2020-2023 chip shortage reduced auto/phone/medical output. **Silicon is now civilization's bottleneck.** Any AI paradigm shift must answer: what hardware? Can it be mass-produced?

## 关键问题 / Questions

1. 如果你想设计一个新的 AI 加速器,你会优化什么?为什么? / If you were to design a new AI accelerator, what would you optimize? Why?
2. 一座 3nm 晶圆厂 ~$20B,折旧 ~5 年。如果每年只能生产 100 万片晶圆,每片晶圆的折旧成本是多少?这对 AI 公司的 TCO 有何含义? / A 3nm fab ~$20B, depreciates over 5 years. If it produces 1M wafers/year, what's the per-wafer depreciation? Implications for AI company TCO?
3. 台积电占全球先进制程芯片代工的 ~90%。这对地缘政治有何含义?对 AI 发展呢? / TSMC has ~90% of advanced node foundry. Geopolitical implications? Implications for AI?

## 推荐资源 / Resources

- 书 / Book: *Chip War* — Chris Miller (2022). 全球半导体史最佳入门 / Best introduction to global semiconductor history
- 书 / Book: *Lithography* — Bruce W. Smith
- 视频 / Video: *Asianometry* "How ASML Took Over Lithography"
- 报告 / Report: *IRDS International Roadmap for Devices and Systems* — 年度更新 / Annual update

---

参见 / See also: [[sand-to-silicon]], [[transistor-mosfet]]
返回阶段首页 / Back to phase: [[README]]
