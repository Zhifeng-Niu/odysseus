---
title: MOSFET · 电子开关的奇迹 / The Electron Switch Miracle
type: concept
phase: 1
tags: [mosfet, transistor, switch, cmos]
created: 2026-07-21
language: zh-CN
---

# MOSFET · 电子开关的奇迹 / The Electron Switch Miracle

> **学习目标 / Learning Objectives**
> - 理解 MOSFET (金属-氧化物-半导体场效应管) 的工作原理 / Understand MOSFET (Metal-Oxide-Semiconductor Field-Effect Transistor) operation
> - 看到它是如何用"电压"控制"电流"的开关 / See how it uses voltage to control current as a switch
> - 理解为什么现代 CPU 的几十亿晶体管能塞进指甲盖大小,并保持低功耗 / Understand why billions of transistors fit in a fingernail-sized die while keeping power low

> **关键术语 / Key Terms**
> - 栅极 Gate · 源极 Source · 漏极 Drain · 衬底 Substrate · 沟道 Channel · 阈值电压 Threshold voltage · 反型层 Inversion layer

## MOSFET 是什么? / What Is a MOSFET?

**MOSFET** = Metal-Oxide-Semiconductor Field-Effect Transistor (金属-氧化物-半导体场效应晶体管)

它是现代集成电路的**基本构建单元**。一颗 Intel Core i9 有约 50 亿到 100 亿个 MOSFET。

> It's the **basic building block** of modern integrated circuits. An Intel Core i9 has about 5-10 billion MOSFETs.

**作用**: 用栅极电压控制源极到漏极的电流。它是一个**电压控制的开关**。

> **Function**: Gate voltage controls current from source to drain. It's a **voltage-controlled switch**.

## NMOS 的结构 / NMOS Structure

```
                  栅极 Gate (金属/多晶硅 polycrystalline silicon)
                  ┌────────────────┐
                  │                │
                  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← 多晶硅 polycrystalline silicon
                  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
                  ░░░░░░░░░░░░░░░░░  ← SiO₂ 栅氧 gate oxide (绝缘 insulator)
                  ░░░░░░░░░░░░░░░░░
                  ┌───┐         ┌───┐
                  │N+ │ ← 沟道  │N+ │
                  │N+ │  channel│N+ │
        P 型衬底   │N+ │         │N+ │    N 型衬底在 P 衬底中
   ──────────────┐│N+ │         │N+ │┌──────────────
                  └───┘         └───┘
                  ↑                  ↑
              源极 Source         漏极 Drain

                  ←───── 衬底 Substrate (通常接地 grounded)
```

**结构特征 / Structural features**:

1. **栅极** (Gate) 在顶部,与沟道之间被极薄的 SiO₂ 绝缘 / **Gate** on top, insulated from channel by ultra-thin SiO₂
2. **源极** (Source) 和 **漏极** (Drain) 是两个 N+ 区域 (重掺杂 N) / **Source** and **Drain** are N+ (heavily doped) regions
3. **衬底** (Substrate) 是 P 型硅 / **Substrate** is P-type silicon

## 工作原理:三步走 / How It Works: Three Steps

### 第 1 步:栅极电压为 0 → 关断 / Step 1: Gate V = 0 → OFF

源极 (N+) 和漏极 (N+) 之间是 P 型衬底,相当于两个背靠背的 PN 结 → 无论源漏电压方向,总有一个 PN 结反偏 → **没有电流** → 开关断开。

> Source and drain are N+ regions in P substrate — like two back-to-back PN junctions. Either way the source-drain voltage is applied, one PN junction is reverse-biased → **no current** → switch OFF.

### 第 2 步:施加正栅压 → 反型 / Step 2: Apply Positive Gate Voltage → Inversion

栅极加正电压 (V_G > 0),电场穿过 SiO₂ 进入衬底。这个电场把衬底中的电子吸引到栅极下方。

> Apply positive gate voltage (V_G > 0). The field penetrates through SiO₂ into the substrate, attracting electrons to just below the gate.

**反型** (Inversion): P 型衬底在栅极下方被"反转"成 N 型 → 形成一条 N 型**沟道** (channel) 连接源极与漏极。

> **Inversion**: The P substrate just below the gate is "inverted" to N-type → forming an N-type **channel** connecting source and drain.

### 第 3 步:沟道导通 → 电流通过 / Step 3: Channel Conducts → Current Flows

当 V_G 超过**阈值电压** V_T (~0.3-0.7V),沟道足够强 → 加上 V_DS,电子从源极流向漏极 → **电流通过** → 开关闭合。

> When V_G exceeds **threshold voltage** V_T (~0.3-0.7V), the channel is strong enough → apply V_DS, electrons flow source → drain → **current flows** → switch ON.

**这就是开关!** 用栅极电压 (控制端) 控制源漏电流 (被控端),完全用电,没有机械运动。

> **That's the switch!** Gate voltage (control) controls source-drain current (controlled), purely electrical, no mechanical motion.

## PMOS:镜像版本 / PMOS: The Mirror Version

把 N+ 换成 P+,P 衬底换成 N 衬底,栅压加负电 → 吸引空穴形成 P 沟道。

> Swap N+ for P+, P substrate for N substrate, apply negative gate voltage → attracts holes to form P channel.

| 特性 Property | NMOS | PMOS |
|------------|------|------|
| 衬底 Substrate | P 型 | N 型 |
| 源漏 Source/Drain | N+ | P+ |
| 沟道载流子 Channel carriers | 电子 Electrons | 空穴 Holes |
| 阈值电压 V_T | 正 (~0.4V) | 负 (~-0.4V) |
| 速度 Speed | 较快 Faster | 较慢 Slower |

电子比空穴快约 2-3 倍(因为电子迁移率比空穴高),所以**优先用 NMOS**,但只有 NMOS 不够 —— 需要 CMOS。

> Electrons are 2-3× faster than holes (higher mobility), so NMOS is preferred — but NMOS alone is insufficient. We need CMOS.

## CMOS:低功耗的关键 / CMOS: The Key to Low Power

**CMOS** = Complementary MOS (互补 MOS) = NMOS + PMOS 配对使用。

> **CMOS** = Complementary MOS = NMOS + PMOS paired.

### CMOS 反相器:最简单的逻辑门 / CMOS Inverter: The Simplest Logic Gate

```
          V_DD (电源 supply, +1V)
            |
        ┌───┴───┐
        │       │
       PMOS   PMOS
       (上拉 pull-up)
        │       │
        └───┬───┘
            ├───→ 输出 V_out
        ┌───┴───┐
        │       │
       NMOS   NMOS
       (下拉 pull-down)
        │       │
        └───┬───┘
            |
           GND (地 ground)
            
        输入 V_in 同时控制 PMOS 和 NMOS 栅极
        Input V_in drives both PMOS and NMOS gates
```

### 静态功耗:接近零! / Static Power: Nearly Zero!

- 输入 V_in = 0 → PMOS 导通,NMOS 关断 → V_out = V_DD (输出 1)
- 输入 V_in = V_DD → PMOS 关断,NMOS 导通 → V_out = 0 (输出 0)
- **关键**: 任何时候,PMOS 和 NMOS 不同时导通 → 没有从 V_DD 直接到 GND 的电流路径 → **静态电流接近零**

> **Key**: PMOS and NMOS never conduct simultaneously → no direct path from V_DD to GND → **static current nearly zero**

这就是为什么你的手机 CPU 有几十亿晶体管,待机一天还能剩 80% 电量。

> This is why your phone CPU with billions of transistors still has 80% battery after a day of standby.

### 动态功耗:主要的能量消耗 / Dynamic Power: The Main Energy Cost

每次翻转(0 → 1 或 1 → 0),要给负载电容充电或放电,消耗能量:

> Each transition (0 → 1 or 1 → 0) charges or discharges load capacitance, consuming energy:

**P_dynamic = α · C · V² · f**

- α: 翻转活动因子 Activity factor (0-1)
- C: 负载电容 Load capacitance
- V: 电源电压 Supply voltage
- f: 时钟频率 Clock frequency

注意 **V²** 这一项!降压 30%,功耗降 50%。这就是为什么 CPU 电压从 5V 一路降到 0.7V,这是降低功耗的主要手段。

> Note the **V²** term! Reducing voltage by 30% cuts power by 50%. That's why CPU voltage went from 5V down to 0.7V — the main power reduction strategy.

## MOSFET 工艺:光刻与刻蚀 / MOSFET Fabrication: Lithography and Etching

### 工艺节点 (Process Node) 的含义 / What "Process Node" Means

"3nm 工艺" 不是指晶体管的实际物理尺寸,而是商业上代表"这一代工艺的晶体管密度等价于多少 nm"。

> "3nm process" doesn't refer to actual physical size, but a commercial label representing "transistor density equivalent."

| 年代 Year | 节点 Node | 实际栅长 Actual gate length |
|--------|--------|------------------------|
| 2000 | 180nm | 180nm |
| 2010 | 32nm | 32nm |
| 2020 | 5nm | ~20nm |
| 2024 | 3nm | ~12nm |

### FinFET 与 GAAFET:从平面到立体的演进 / FinFET and GAAFET: From Planar to 3D

栅长缩到 20nm 以下,栅极对沟道的控制能力下降 → **短沟道效应** (short-channel effect) → 漏电增加。

> Below 20nm gate length, gate control weakens → **short-channel effect** → leakage increases.

解决方案:把沟道做成立体形状,让栅极三面或四面环绕沟道:

> Solution: make the channel 3D, so the gate wraps around it on 3 or 4 sides:

- **FinFET** (2011 Intel 首发): 沟道像鱼鳍,栅极三面包围 / Fin-like channel, gate on 3 sides
- **GAAFET** (2022 Samsung 首发): 沟道是纳米片,栅极全包围 / Nanosheet channel, gate-all-around

## 与 LLM 的连接 / Connection to LLMs

这是阶段 1 与阶段 8 的核心桥梁 / This is the core bridge between Phase 1 and Phase 8:

1. **训练能耗**: 训练 GPT-4 估算消耗 ~50 GWh 电力,相当于一个小城市全年用电。每瓦特最终都变成热,由 MOSFET 的开关动态功耗决定。
   > Training GPT-4 consumed an estimated ~50 GWh — a small city's annual electricity. Every watt becomes heat, determined by MOSFET switching dynamic power.

2. **推理延迟的物理根源**: 你问 LLM 一个问题,响应延迟 ~100ms-10s。这段时间内,千亿参数对应的 ~10¹¹ 个 MOSFET 在反复开关,做矩阵乘法。延迟下限是**光速 × 芯片尺寸 × 必要的串行步骤**。
   > When you ask an LLM, response latency ~100ms-10s. During this time, ~10¹¹ MOSFETs switch repeatedly for matrix multiplication. The latency floor is **speed of light × chip size × required sequential steps**.

3. **范式的瓶颈**: Transformer 的注意力机制是 O(n²) 序列长度复杂度,意味着**物理层消耗**随上下文窗口立方增长。这暗示某种根本性的浪费——我们用海量物理开关去逼近一个本来可能用稀疏结构表达的东西。
   > Transformer attention is O(n²) on sequence length, meaning **physical-layer cost** grows cubically with context window. This hints at fundamental waste — we use massive physical switching to approximate something that might be expressible sparsely.

## 历史里程碑 / Historical Milestones

- **1925 Julius Lilienfeld** 申请场效应管专利(尚未实现) / Patented the field-effect transistor (not yet realized)
- **1959 Dawon Kahng & Martin Atalla (Bell Labs)** 发明现代 MOSFET / Invented modern MOSFET
- **1963 Frank Wanlass (Fairchild)** 发明 CMOS / Invented CMOS
- **1971 Intel 4004**: 2300 个 MOSFET,第一款商用微处理器 / 2300 MOSFETs, first commercial microprocessor
- **2024 Apple M4**: ~28 亿 MOSFET/mm²,峰值 ~38 TOPS / ~2.8 billion MOSFETs/mm²

## 关键问题 / Questions

1. 为什么 CMOS 静态功耗接近零,但实际待机时仍然消耗一些电力? / Why is CMOS static power nearly zero, but real standby still consumes some power?
2. 把电源电压从 1V 降到 0.5V,功耗降多少?为什么实际不能无限降? / If V_DD drops from 1V to 0.5V, how much does power drop? Why can't we reduce V_DD indefinitely?
3. 摩尔定律正在终结,你判断哪种技术(3D 堆叠、光子学、自旋电子学、量子)最有可能成为下一代计算基底? / Moore's Law is ending. Which technology (3D stacking, photonics, spintronics, quantum) is most likely the next computation substrate?

## 推荐资源 / Resources

- 书 / Book: *CMOS VLSI Design* — Weste & Harris (第 1-4 章 / Chapters 1-4)
- 视频 / Video: *Asianometry* YouTube 频道 —— 半导体史最佳讲解 / Asianometry — best semiconductor history channel
- 论文 / Paper: Kahng & Atalla (1960). *Silicon-Silicon Dioxide Field Induced Surface Devices*. — IEDM. 历史一手 / Historical primary source

---

参见 / See also: [[pn-junction]], [[cmos-and-fabrication]]
