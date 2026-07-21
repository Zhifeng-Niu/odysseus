---
title: CPU 流水线 · CPU Pipeline
type: concept
phase: 3
tags: [pipeline, branch-prediction, superscalar, hazards]
created: 2026-07-21
language: zh-CN
---

# CPU 流水线 · CPU Pipeline

> **学习目标 / Learning Objectives**
> - 理解流水线为什么让 CPU 快几倍 / Understand why pipelining speeds up CPU several times
> - 掌握流水线冒险(hazard)的三种类型 / Master the three types of pipeline hazards
> - 看到分支预测与现代 CPU 性能的紧密关系 / See branch prediction's tight coupling with modern CPU performance

## 流水线类比 / Pipeline Analogy

**类比 / Analogy**: 洗衣房 laundromat:

- 洗衣(30 min)→ 烘干(30 min)→ 叠好(30 min)
- 串行: 1 篮 = 90 min, 4 篮 = 360 min
- 流水线: 4 篮 = 90 + 30 + 30 + 30 = 180 min (2x 加速 / 2x speedup)

```
时间 time →
       0    30   60   90   120  150  180
篮 1   洗   烘   叠
篮 2        洗   烘   叠
篮 3             洗   烘   叠
篮 4                  洗   烘   叠
```

**为什么加速 / Why speedup**: 不同阶段并行工作,每个阶段都不闲着。

## CPU 5 级流水线 / CPU 5-Stage Pipeline

经典 MIPS RISC 流水线 / Classic MIPS RISC pipeline:

```
1. IF (Instruction Fetch)    取指   - 从内存读指令
2. ID (Instruction Decode)   译码   - 解码,读寄存器
3. EX (Execute)              执行   - ALU 运算
4. MEM (Memory Access)       访存   - load/store
5. WB (Write Back)           写回   - 结果写入寄存器

时间 time →
         1   2   3   4   5   6   7
指令 1    IF  ID  EX  MEM WB
指令 2        IF  ID  EX  MEM WB
指令 3            IF  ID  EX  MEM WB
指令 4                IF  ID  EX  MEM WB
```

理想情况:每个时钟周期完成一条指令。1 GHz CPU → 10 亿指令/秒 (1 IPC, Instruction Per Cycle).

> Ideal: one instruction per cycle. 1 GHz CPU → 1 billion instructions/sec.

## 流水线冒险 Pipeline Hazards

**冒险 Hazard**: 流水线中,某些情况让指令无法在下一拍继续前进。

### 结构冒险 Structural Hazard

**原因 Cause**: 同一资源被多条指令同时需要 / Same resource needed by multiple instructions simultaneously.

**例**: 一条指令在 IF (取指令),另一条在 MEM (取数据)。如果只有一条总线到内存 → 冲突。

**解决 Solution**: Harvard 架构(分离指令/数据缓存)/ Split instruction/data caches.

### 数据冒险 Data Hazard

**原因 Cause**: 后一条指令需要前一条指令的结果,但前者还没写回 / Later instruction needs earlier's result, not yet written.

**例**:
```
add x1, x2, x3   # x1 ← x2 + x3
sub x4, x1, x5   # 需要 x1,但 add 还在 EX 阶段,未写回
```

**解决方案 Solutions**:

1. **转发/旁路 Forwarding/Bypassing**: ALU 结果直接转发给下一指令的输入,不等 WB. / Forward ALU result directly, skipping WB.
2. **停顿 Stall**: 插入空泡 bubble,等待结果. / Insert bubble to wait.
3. **调度重排 Reordering**: 编译器调整指令顺序,避免依赖. / Compiler reorders to avoid dependencies.

### 控制冒险 Control Hazard

**原因 Cause**: 跳转指令(jump, branch)的目标未知,不知道下一条该取什么. / Branch target unknown, don't know what to fetch next.

**例**:
```
beq x1, x2, label  # 条件分支
add x3, x4, x5     # 顺序执行 OR label 处? 不知道
```

**解决方案 Solutions**:

1. **分支预测 Branch Prediction**: 猜测分支方向. / Guess branch direction.
   - **静态 Static**: 总是预测"不跳"或"跳" / Always predict not-taken or taken
   - **动态 Dynamic**: 基于历史 2-bit 饱和计数器等 / History-based 2-bit saturating counter

2. **推测执行 Speculative Execution**: 按预测方向继续执行,猜错则回滚. / Continue along predicted path, rollback if wrong.

3. **延迟分支 Delayed Branch**: 分支指令后固定 N 条指令总是执行 (MIPS 早期使用) / Always execute N instructions after branch.

**关键 Critical**: 现代分支预测器准确率 >95%。深度流水线(20+ 级)的 CPU,分支预测错代价巨大(冲刷 20 条指令)。**Intel Pentium 4 因为流水线太深,失败,被淘汰**。

> Modern branch predictors >95% accurate. Deep pipelines (20+ stages) make mispredictions costly (flush 20 instructions). **Intel Pentium 4's too-deep pipeline failed, was discontinued**.

## 超标量 Superscalar

**思想**: 一个周期发射多条指令 / Issue multiple instructions per cycle.

**例**: 双发射 5 级流水线 / Dual-issue 5-stage pipeline:

```
时间 time →
         1   2   3   4   5
i1, i2   IF  ID  EX  MEM WB
i3, i4       IF  ID  EX  MEM WB
i5, i6           IF  ID  EX  MEM WB
```

每个周期完成 2 条指令 → IPC > 1. 现代服务器 CPU 可达 4-6 发射.

> 2 instructions per cycle → IPC > 1. Modern server CPUs: 4-6 issue.

## 乱序执行 Out-of-Order Execution (OoOE)

**思想**: 程序中的指令顺序不一定是执行顺序。等待数据的指令让开,执行就绪的指令. / Program order ≠ execution order. Stalled instructions yield, ready instructions execute.

```
原始顺序 Original:
i1: load x1 ← Memory[...]   # 慢,100 ns
i2: add  x2 ← x1 + 1        # 等 i1
i3: add  x3 ← x4 + x5       # 不依赖 i1,可立即执行

乱序 Out-of-order:
i3 先执行 (不阻塞)
i1 + i2 后执行 (按依赖顺序)
```

**关键 Critical**: 乱序执行后必须**按程序顺序提交 commit** (称为重排序缓冲 Reorder Buffer, ROB),保证程序语义正确.

> After OoO execution, must **commit in program order** (Reorder Buffer, ROB), preserving program semantics.

## 关键观察 / Key Observations

1. **现代 CPU 是工程奇迹** / Modern CPUs are engineering marvels
   Apple M4 每周期可发射 ~8 条指令,深度 ~15 级,超大 ROB (~600 项)。这是数十亿晶体管的复杂工程。
   > Apple M4: ~8 instructions/cycle, ~15 stages deep, huge ROB (~600 entries). Billions of transistors of complex engineering.

2. **性能瓶颈从计算转向预测** / Performance bottleneck shifted from compute to prediction
   现代 CPU ALU 部分占芯片面积 <10%。大部分晶体管用于缓存、预测、调度、推测执行。
   > Modern ALU <10% of chip. Most transistors for cache, prediction, scheduling, speculation.

3. **功耗墙 Power Wall** / 
   主频升高 → 功耗立方上升。2005 年前后,主频冲到 ~4 GHz 就撞墙。多核成为新方向。
   > Higher frequency → cubic power increase. ~2005, hit wall at ~4 GHz. Multi-core became new direction.

## 与 AI 的连接 / Connection to AI

1. **CPU 不适合 AI 工作负载**: AI 是大量稠密矩阵乘法,CPU 的分支预测、乱序执行都用不上。GPU 简化掉这些,把所有晶体管堆在 ALU 上。
   > CPU unsuited for AI: dense matmul doesn't need branch prediction or OoO. GPU strips these, packs transistors into ALUs.

2. **NVIDIA Tensor Core**: 不预测、不乱序、不超标量。只有海量矩阵乘法单元。**牺牲通用性换极致性能**。
   > NVIDIA Tensor Core: no prediction, no OoO, no superscalar. Just massive matrix multiply units. **Trade generality for extreme performance**.

3. **范式思考 / Paradigm thinking**:
   CPU 流水线代表"复杂硬件 + 简单指令流"的范式。
   GPU 代表"简单硬件 + 大量并行数据"的范式。
   下一个范式可能是什么? → 神经形态、量子、光子、生物...
   > CPU pipeline: complex hardware + simple instruction stream.
   > GPU: simple hardware + massive parallel data.
   > Next paradigm: neuromorphic, quantum, optical, biological...

## 关键问题 / Questions

1. 5 级流水线理论加速比是多少?实际呢?为什么? / Theoretical speedup of 5-stage pipeline? Actual? Why?
2. 为什么 Intel Pentium 4 31 级流水线失败? / Why did Pentium 4's 31-stage pipeline fail?
3. 分支预测错误的代价(周期数)随流水线深度怎么变化? / Branch misprediction cost (cycles) vs pipeline depth?
4. 推测执行 + Spectre/Meltdown 漏洞的根本原因是什么? / Root cause of speculative execution + Spectre/Meltdown?

## 推荐资源 / Resources

- 书 / Book: *Computer Architecture: A Quantitative Approach* Hennessy & Patterson, 第 3 章 / Chapter 3
- 论文 / Paper: *Branch Prediction: A Tutorial* — Spracklen et al.
- 视频 / Video: *Casey's CPU Channel* — 现代架构讲解 / Modern architecture explained

---

参见 / See also: [[instruction-set-architecture]], [[memory-hierarchy]]
