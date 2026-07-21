---
title: 存储层次 · Memory Hierarchy
type: concept
phase: 3
tags: [memory, cache, dram, locality]
created: 2026-07-21
language: zh-CN
---

# 存储层次 · Memory Hierarchy

> **学习目标 / Learning Objectives**
> - 理解存储层次的"三角":速度 vs 容量 vs 成本 / Understand the memory triangle: speed vs capacity vs cost
> - 掌握局部性原理(时间/空间) / Master locality principle (temporal/spatial)
> - 看到 LLM 训练的显存层次(HBM、NVLink、InfiniBand)是同一原理的放大 / See LLM training memory hierarchy (HBM, NVLink, InfiniBand) as the same principle scaled up

## 核心矛盾 / The Core Tension

**存储技术三律互斥 / Storage technology trilemma**:

- **快 fast** = SRAM (1 ns) - 但贵 ($1000/GB)
- **大 big** = HDD (10 ms) - 但便宜 ($0.03/GB)
- **便宜 cheap** = Tape (10 sec) - 但慢 ($0.01/GB)

**没有任何一种存储既快又大又便宜**。

> **No storage is simultaneously fast, big, and cheap**.

解决方案: **存储层次** —— 用小量快存储缓存大量慢存储。

> Solution: **memory hierarchy** — small fast storage caches large slow storage.

## 经典存储层次 / Classic Memory Hierarchy

```
┌──────────────────────────────────────┐
│ 寄存器 Registers                     │  速度 ~0.3 ns, 容量 ~1 KB
├──────────────────────────────────────┤
│ L1 Cache                             │  速度 ~1 ns,   容量 ~32 KB/核
├──────────────────────────────────────┤
│ L2 Cache                             │  速度 ~4 ns,   容量 ~256 KB/核
├──────────────────────────────────────┤
│ L3 Cache (共享 shared)               │  速度 ~12 ns,  容量 ~32 MB
├──────────────────────────────────────┤
│ 主存 Main Memory (DRAM)              │  速度 ~100 ns, 容量 ~16 GB
├──────────────────────────────────────┤
│ SSD (NAND Flash)                     │  速度 ~100 μs, 容量 ~1 TB
├──────────────────────────────────────┤
│ HDD (机械硬盘)                        │  速度 ~10 ms,  容量 ~10 TB
├──────────────────────────────────────┤
│ 网络存储 / Tape                       │  速度 ~100 ms-10 s, 容量 ~PB
└──────────────────────────────────────┘
```

**关键比例 Key ratio**: 从寄存器到 HDD,速度差 ~10⁸ 倍,容量差 ~10¹⁰ 倍。这是 8 个数量级的差距。

> **Key ratio**: register to HDD, ~10⁸× speed difference, ~10¹⁰× capacity difference. 8 orders of magnitude.

## 局部性原理:存储层次能工作的根本原因 / Locality: Why Hierarchy Works

存储层次能加速,因为程序有局部性 / Hierarchy speeds up because programs exhibit locality:

### 时间局部性 Temporal Locality

**最近访问过的数据,很可能再次被访问. / Recently accessed data likely accessed again**.

例: 循环变量 `i` 在循环内反复使用.

```
for (int i = 0; i < 1000; i++) {
    sum += array[i];  // i, sum 有时间局部性
}
```

### 空间局部性 Spatial Locality

**访问过地址附近的数据,很可能被访问. / Data near accessed addresses likely accessed**.

例: 数组按顺序遍历.

```
for (int i = 0; i < 1000; i++) {
    sum += array[i];  // array[0..999] 顺序访问,空间局部性强
}
```

## 缓存工作原理 / How Cache Works

**缓存 Cache**: 小容量快存储,存放最近/常用数据. / Small fast storage holding recent/frequent data.

### 缓存命中 Cache Hit / Miss

- **命中 Hit**: 要找的数据在缓存中 → 直接用 / Data in cache → use directly
- **未命中 Miss**: 要找的数据不在缓存 → 从下层取,替换缓存中某项 / Data not in cache → fetch from lower level, replace some entry

**命中率 Hit Rate** = 命中次数 / 总访问
**未命中率 Miss Rate** = 1 - 命中率
**平均访问时间 Average Memory Access Time (AMAT)**:

```
AMAT = HitTime + MissRate × MissPenalty

例: HitTime=1ns, MissRate=5%, MissPenalty=100ns
AMAT = 1 + 0.05 × 100 = 6 ns
```

### 缓存映射方式 Cache Mapping

给定内存地址,如何确定它该放在缓存的哪里 / Given memory address, where in cache to place it:

1. **直接映射 Direct-Mapped**: 每个内存地址只能去缓存的一个固定位置. 简单,但冲突多.
   > Each memory address maps to one fixed cache location. Simple but more conflicts.

2. **全相联 Fully Associative**: 内存地址可放在缓存任意位置. 灵活,但硬件复杂.
   > Any cache location. Flexible but complex hardware.

3. **组相联 Set-Associative**: 折中. 缓存分组,每组 N 路可放. 现代 CPU 一般 N=8-16.
   > Compromise. Cache split into sets, each set has N ways. Modern CPUs N=8-16.

### 替换策略 Replacement Policy

缓存满了,新数据要替换谁? / When cache full, replace what?

- **LRU (Least Recently Used)**: 替换最久没用的. 实际多采用伪 LRU 近似.
  > Replace least recently used. Practical implementations often use pseudo-LRU approximations.
- **Random**: 随机替换. 实现简单,效果不错.
- **LFU (Least Frequently Used)**: 替换使用最少的.

### 写策略 Write Policy

**写命中时 When Write Hit**:
- **Write-Through**: 同时写缓存和下层. 简单,但慢.
- **Write-Back**: 只写缓存,标记"脏". 替换时再写回. 快,但复杂.

**写未命中时 When Write Miss**:
- **Write-Allocate**: 把数据载入缓存,再写.
- **No-Write-Allocate**: 直接写下层,不动缓存.

## LLM 训练中的存储层次 / Memory Hierarchy in LLM Training

LLM 训练的存储层次是同一原理的工业级放大 / LLM training's memory hierarchy is the same principle, scaled industrially:

```
┌──────────────────────────────────────┐
│ GPU 寄存器 (~256 KB / GPU)           │  RISC-V 类似,~1 ns
├──────────────────────────────────────┤
│ GPU L1/L2 Cache (~200 MB / GPU)      │  ~2-20 ns
├──────────────────────────────────────┤
│ GPU HBM (~80 GB / GPU, H100)         │  ~200 ns (相对 GPU 计算)
├──────────────────────────────────────┤
│ NVLink (GPU↔GPU, 8 GPUs/node)        │  ~600 ns
├──────────────────────────────────────┤
│ InfiniBand (节点间,跨机)             │  ~2 μs
├──────────────────────────────────────┤
│ SSD (训练数据集存储)                  │  ~100 μs
└──────────────────────────────────────┘
```

**关键观察 Key observation**: 训练大模型时,模型参数 + 优化器状态 + 梯度 + 激活值常常超过单 GPU HBM. 必须分布式训练,跨 GPU 通信. **通信开销经常超过计算开销**.

> Training large models: params + optimizer state + gradients + activations often exceed single GPU HBM. Must distribute, communicate across GPUs. **Communication overhead often exceeds computation**.

## 与 LLM 的连接 / Connection to LLMs

1. **KV Cache 是 LLM 推理的"缓存"**
   Transformer 推理时,已生成 token 的 Key/Value 张量存在 HBM. 每生成新 token,直接读 KV Cache,不重算. **KV Cache 命中率 ~100%**.
   > Transformer inference stores K/V tensors of generated tokens in HBM. Each new token reads KV Cache, avoids recomputation. **KV Cache hit rate ~100%**.

2. **上下文窗口 = KV Cache 容量**
   长上下文(100K-1M tokens)需要巨大 KV Cache. HBM 容量决定最大上下文. 这就是为什么 Gemini 1.5 Pro 早期只支持 1M token,因为 HBM 装不下.
   > Long context (100K-1M tokens) needs huge KV Cache. HBM capacity limits context. That's why early Gemini 1.5 Pro capped at 1M tokens.

3. **Attention O(n²) 与冯·诺依曼瓶颈**
   标准 Attention 计算量 O(n²). 但内存访问量也 O(n²) —— 软键值矩阵. **计算和访存同等瓶颈**. 这就是 Flash Attention 的动机: 优化访存,而非计算.
   > Standard Attention: O(n²) compute, but also O(n²) memory access — softmax over QK^T. **Both compute and memory bound**. Flash Attention's motivation: optimize memory access, not compute.

4. **范式思考**: 大脑的"存储层次"是什么?
   - 短期记忆: 前额叶皮层 (~秒-分, 容量小)
   - 长期记忆: 海马体 → 皮层 (小时-年)
   - 工作记忆 vs 长时记忆的区分,与 CPU 的 L1 vs DRAM 类似
   > What's the brain's "memory hierarchy"?
   > - Short-term: prefrontal cortex (sec-min, small capacity)
   > - Long-term: hippocampus → cortex (hours-years)
   > - Working memory vs long-term like CPU L1 vs DRAM

## 关键问题 / Questions

1. 你的电脑 RAM 是 16 GB,SSD 是 1 TB。为什么 RAM 不能完全替代 SSD? / Your RAM is 16 GB, SSD is 1 TB. Why can't RAM replace SSD?
2. 一个程序循环遍历 1 GB 数组,但 L3 cache 只有 32 MB. 命中率几乎为 0. 怎么优化? / Program loops over 1 GB array, L3 cache is 32 MB. Hit rate ~0. How to optimize?
3. Flash Attention 为什么能把 Attention 速度提升 2-4 倍?核心思想是什么? / Why does Flash Attention achieve 2-4× speedup? Core idea?
4. 长上下文 LLM 的瓶颈是计算还是访存? / Long context LLM bottleneck: compute or memory access?

## 推荐资源 / Resources

- 书 / Book: *Computer Architecture: A Quantitative Approach* — 第 2 章 / Chapter 2 (内存层次 / Memory Hierarchy)
- 论文 / Paper: *FlashAttention: Fast and Memory-Efficient Exact Attention* — Dao et al. (2022)
- 视频 / Video: *GPU Mode* YouTube 频道 — CUDA 和 Flash Attention 讲解 / CUDA and Flash Attention explained

---

参见 / See also: [[cpu-pipeline]], [[interrupts-and-io]]
