---
title: 中英术语对照表 · Bilingual Glossary
type: glossary
tags: [glossary, terminology, bilingual]
created: 2026-07-21
language: zh-CN
---

# 中英术语对照表 · Bilingual Glossary

> 这份术语表覆盖整条学习路径的所有核心术语。每条都给出英文、中文、首次出现的阶段、一句话定义。
>
> This glossary covers all core terms across the entire learning path. Each entry includes English, Chinese, the phase where it first appears, and a one-sentence definition.

---

## 阶段 1 · 物理基础 / Phase 1 · Physics Foundations

| 英文 English | 中文 Chinese | 一句话定义 One-line Definition |
|------------|------------|-----------------------------|
| Silicon (Si) | 硅 | 第 14 号元素,地壳第二丰富,带 4 个价电子的半导体 / Element 14, second most abundant in Earth's crust, a semiconductor with 4 valence electrons |
| Semiconductor | 半导体 | 导电性介于导体与绝缘体之间,可通过掺杂改变 / Material with conductivity between conductor and insulator, tunable via doping |
| Band Gap | 带隙 | 导带与价带之间的能量差,决定导电性 / Energy difference between conduction band and valence band, determines conductivity |
| Doping | 掺杂 | 向硅中引入微量杂质原子以改变导电性 / Introducing trace impurity atoms into silicon to alter conductivity |
| P-type | P 型半导体 | 掺杂了受主(如硼),空穴为多数载流子 / Doped with acceptors (e.g., boron); holes are majority carriers |
| N-type | N 型半导体 | 掺杂了施主(如磷),电子为多数载流子 / Doped with donors (e.g., phosphorus); electrons are majority carriers |
| PN Junction | PN 结 | P 型与 N 型交界处形成的整流结构 / Rectifying structure at the interface of P-type and N-type |
| Depletion Region | 耗尽层 | PN 结附近无自由载流子的区域 / Region near PN junction devoid of free carriers |
| Transistor | 晶体管 | 三端半导体器件,用作开关或放大器 / Three-terminal semiconductor device used as switch or amplifier |
| MOSFET | 金属氧化物半导体场效应管 | 现代集成电路的基本构建单元 / Metal-Oxide-Semiconductor Field-Effect Transistor, the basic building block of modern ICs |
| CMOS | 互补金属氧化物半导体 | 用 NMOS + PMOS 组合实现低功耗逻辑 / Complementary MOS; combines NMOS + PMOS for low-power logic |
| Photolithography | 光刻 | 用紫外光在硅上转印图形的工艺 / Process of using UV light to transfer patterns onto silicon |
| Moore's Law | 摩尔定律 | 晶体管密度每 18-24 个月翻倍的经验规律 / Empirical observation that transistor density doubles every 18-24 months |

---

## 阶段 2 · 数字逻辑 / Phase 2 · Digital Logic

| 英文 English | 中文 Chinese | 一句话定义 One-line Definition |
|------------|------------|-----------------------------|
| Binary | 二进制 | 仅用 0 和 1 的数制 / Number system using only 0 and 1 |
| Bit | 比特 | 一个二进制位,信息的最小单位 / A single binary digit, the smallest unit of information |
| Hexadecimal | 十六进制 | 用 0-9 和 A-F 表示数值的数制,4 个比特一组 / Base-16 system, groups 4 bits |
| Two's Complement | 二进制补码 | 用补码表示负数,使加减法硬件统一 / Encoding negatives so addition/subtraction share hardware |
| Boolean Algebra | 布尔代数 | 由 George Boole 创立的逻辑代数系统 / Logical algebra system founded by George Boole |
| Logic Gate | 逻辑门 | 实现布尔运算的物理电路(AND/OR/NOT 等) / Physical circuit implementing a boolean operation |
| NAND / NOR | 与非 / 或非 | 通用门,任一逻辑都可用单一 NAND 或 NOR 实现 / Universal gates; any logic can be built from just NAND or just NOR |
| XOR | 异或 | 不同为 1,相同为 0;加法器核心 / 1 iff inputs differ; core of adders |
| Multiplexer (MUX) | 多路复用器 | 根据选择信号输出多个输入中的一个 / Outputs one of several inputs based on selection signals |
| Flip-Flop | 触发器 | 存储 1 比特状态的双稳态电路 / Bistable circuit storing 1 bit of state |
| Register | 寄存器 | 一组触发器的组合,存储多比特数据 / A bank of flip-flops storing multiple bits |
| Karnaugh Map | 卡诺图 | 用于布尔表达式化简的图形工具 / Graphical tool for minimizing boolean expressions |

---

## 阶段 3 · 计算机架构 / Phase 3 · Computer Architecture

| 英文 English | 中文 Chinese | 一句话定义 One-line Definition |
|------------|------------|-----------------------------|
| Von Neumann Architecture | 冯·诺依曼架构 | 程序与数据共享同一存储的架构范式 / Paradigm where program and data share the same memory |
| Harvard Architecture | 哈佛架构 | 程序与数据分开存储的架构范式 / Paradigm with separate program and data memories |
| Instruction Set Architecture (ISA) | 指令集架构 | 软硬件之间的契约,定义可见指令 / Contract between hardware and software, defines visible instructions |
| Machine Code | 机器码 | CPU 直接执行的二进制指令 / Binary instructions directly executed by CPU |
| Assembly Language | 汇编语言 | 机器码的人类可读助记形式 / Human-readable mnemonic form of machine code |
| Register | 寄存器 | CPU 内部的超高速存储 / Ultra-fast storage inside CPU |
| Program Counter (PC) | 程序计数器 | 存放下条指令地址的寄存器 / Register holding address of next instruction |
| Instruction Cycle | 指令周期 | Fetch-Decode-Execute 的循环 / Fetch-Decode-Execute loop |
| Pipeline | 流水线 | 重叠多条指令的执行阶段以提高吞吐 / Overlapping instruction stages to boost throughput |
| Cache | 高速缓存 | 介于 CPU 与主存之间的小型快速存储 / Small fast memory between CPU and main memory |
| Memory Hierarchy | 存储层次 | 寄存器 → 缓存 → 内存 → 磁盘的层次结构 / Registers → Cache → RAM → Disk hierarchy |
| Interrupt | 中断 | 暂停当前执行,转去处理事件的机制 / Mechanism to pause current execution for event handling |
| Direct Memory Access (DMA) | 直接存储器访问 | 设备与内存之间不经过 CPU 的数据传输 / Device-memory data transfer bypassing CPU |

---

## 阶段 4 · 编程与系统 / Phase 4 · Programming & Systems

| 英文 English | 中文 Chinese | 一句话定义 One-line Definition |
|------------|------------|-----------------------------|
| C Language | C 语言 | 1972 年由 Dennis Ritchie 设计的系统编程语言 / Systems programming language designed by Dennis Ritchie in 1972 |
| Pointer | 指针 | 存储内存地址的变量 / Variable storing a memory address |
| Memory Allocation | 内存分配 | 在堆或栈上获取内存的过程 / Process of acquiring memory on heap or stack |
| Stack | 栈 | 后进先出的内存区域,用于函数帧 / LIFO memory region for function frames |
| Heap | 堆 | 动态分配的内存区域 / Dynamically allocated memory region |
| Operating System | 操作系统 | 管理硬件资源并为程序提供服务的软件 / Software managing hardware resources and serving programs |
| System Call (Syscall) | 系统调用 | 程序向操作系统请求服务的接口 / Interface for programs to request OS services |
| Process | 进程 | 程序的运行实例,有自己的地址空间 / Running instance of a program with own address space |
| Thread | 线程 | 进程内的执行单元,共享地址空间 / Execution unit within a process, shares address space |
| Virtual Memory | 虚拟内存 | 将物理内存抽象为连续地址空间的机制 / Mechanism abstracting physical memory into contiguous address space |
| Compiler | 编译器 | 将源代码翻译为机器码的程序 / Program translating source code to machine code |
| Linker | 链接器 | 将多个编译单元合并为可执行文件的程序 / Program combining compilation units into an executable |
| Loader | 加载器 | 将可执行文件载入内存的操作系统部分 / OS component loading an executable into memory |
| ABI (Application Binary Interface) | 应用二进制接口 | 二进制层调用约定与数据布局的规范 / Specification of calling conventions and data layout at binary level |

---

## 阶段 5 · 算法与复杂度 / Phase 5 · Algorithms & Complexity

| 英文 English | 中文 Chinese | 一句话定义 One-line Definition |
|------------|------------|-----------------------------|
| Algorithm | 算法 | 解决问题的有限步骤序列 / Finite sequence of steps solving a problem |
| Data Structure | 数据结构 | 组织与存储数据的方式 / Way of organizing and storing data |
| Time Complexity | 时间复杂度 | 输入规模增长时运行时间的增长规律 / How runtime grows with input size |
| Space Complexity | 空间复杂度 | 输入规模增长时内存使用的增长规律 / How memory usage grows with input size |
| Big-O Notation | 大 O 表示法 | 渐近上界的数学表示 / Mathematical notation for asymptotic upper bound |
| Recursion | 递归 | 函数调用自身解决问题 / Function calling itself to solve subproblems |
| Dynamic Programming | 动态规划 | 用子问题最优解组合为整体最优 / Combining optimal subproblem solutions for global optimum |
| Greedy Algorithm | 贪心算法 | 每步选当前最优,不回溯 / Pick current best at each step without backtracking |
| Divide and Conquer | 分治 | 将问题拆为独立子问题再合并 / Split into independent subproblems, then merge |
| Graph | 图 | 顶点与边构成的数学结构 / Mathematical structure of vertices and edges |
| Tree | 树 | 无环连通图 / Connected acyclic graph |
| Hash Table | 哈希表 | 平均 O(1) 查找的数据结构 / Data structure with average O(1) lookup |
| P (Complexity Class) | P 类 | 多项式时间内可解的问题类 / Problems solvable in polynomial time |
| NP (Complexity Class) | NP 类 | 解能在多项式时间内验证的问题类 / Problems whose solutions are verifiable in polynomial time |
| NP-Complete | NP 完全 | NP 中最难的一类问题 / Hardest problems in NP |
| NP-Hard | NP 困难 | 至少和 NP 完全一样难 / At least as hard as NP-complete |
| Reduction | 归约 | 将一个问题转化为另一个问题 / Transforming one problem into another |

---

## 阶段 6 · 可计算性理论 / Phase 6 · Computability Theory

| 英文 English | 中文 Chinese | 一句话定义 One-line Definition |
|------------|------------|-----------------------------|
| Turing Machine | 图灵机 | Alan Turing 1936 年设想的抽象计算模型 / Abstract computation model devised by Alan Turing in 1936 |
| Universal Turing Machine | 通用图灵机 | 能模拟任何图灵机的图灵机 / Turing machine that can simulate any Turing machine |
| Church-Turing Thesis | 丘奇-图灵论题 | "可计算" = 图灵机可计算的论断 / Thesis that "computable" = Turing-computable |
| Halting Problem | 停机问题 | 判断程序是否会终止的不可解问题 / Unsolvable problem of determining if a program terminates |
| Decidability | 可判定性 | 存在算法总给出 yes/no 答案 / Existence of an algorithm always giving yes/no answer |
| Gödel's Incompleteness | 哥德尔不完备性 | 任何充分强的形式系统都有不可证真命题 / Any sufficiently strong formal system has unprovable truths |
| Self-Reference | 自指 | 语句或程序指向自身 / Statements or programs referring to themselves |
| Diagonalization | 对角线方法 | Cantor 发明,被 Gödel/Turing 用于证明极限 / Cantor's technique used by Gödel/Turing for impossibility proofs |
| Information Theory | 信息论 | Shannon 1948 年创立,研究信息量化 / Founded by Shannon in 1948; quantifies information |
| Entropy (Shannon) | 香农熵 | H = -Σ p log p,衡量不确定性 / H = -Σ p log p; measures uncertainty |
| Channel Capacity | 信道容量 | 信道无错传输的最大速率 / Maximum error-free rate of a channel |
| Kolmogorov Complexity | 柯尔莫哥洛夫复杂度 | 描述对象的最短程序长度 / Length of shortest program describing an object |
| Lambda Calculus | λ 演算 | Church 的形式系统,等价于图灵机 / Church's formal system, equivalent to Turing machine |

---

## 阶段 7 · AI 简史 / Phase 7 · AI History

| 英文 English | 中文 Chinese | 一句话定义 One-line Definition |
|------------|------------|-----------------------------|
| Symbolic AI (GOFAI) | 符号主义 AI / 老式 AI | 通过符号规则与逻辑推理实现的 AI / AI via symbolic rules and logical inference |
| Expert System | 专家系统 | 用知识库 + 推理引擎模拟专家的系统 / System mimicking experts via knowledge base + inference engine |
| Perceptron | 感知机 | Rosenblatt 1958 年提出的单层神经网络 / Single-layer neural network proposed by Rosenblatt in 1958 |
| Connectionism | 连接主义 | 通过大量简单单元连接实现智能的范式 / Paradigm achieving intelligence via many simple connected units |
| Neural Network | 神经网络 | 受生物神经元启发的计算模型 / Computation model inspired by biological neurons |
| Backpropagation | 反向传播 | 用链式法则训练多层神经网络的方法 / Training multi-layer networks via chain rule |
| Deep Learning | 深度学习 | 多层神经网络的学习范式 / Learning paradigm using multi-layer networks |
| CNN (Convolutional Neural Network) | 卷积神经网络 | 适合图像处理的神经网络结构 / Network architecture suited for images |
| RNN (Recurrent Neural Network) | 循环神经网络 | 适合序列处理的神经网络结构 / Network architecture suited for sequences |
| LSTM | 长短期记忆网络 | 解决 RNN 梯度消失的门控结构 / Gated architecture solving RNN vanishing gradient |
| Attention Mechanism | 注意力机制 | 让模型动态聚焦关键部分的技术 / Technique letting models dynamically focus on key parts |
| Transformer | Transformer | Vaswani 2017 提出,基于纯注意力的架构 / Attention-only architecture proposed by Vaswani in 2017 |
| AI Winter | AI 寒冬 | AI 资金与关注度大幅下降的时期 / Periods of collapsed AI funding and interest |

---

## 阶段 8 · 当前范式 / Phase 8 · Current Paradigm

| 英文 English | 中文 Chinese | 一句话定义 One-line Definition |
|------------|------------|-----------------------------|
| Large Language Model (LLM) | 大语言模型 | 用海量文本预训练的 Transformer 模型 / Transformer model pretrained on massive text |
| Pre-training | 预训练 | 用自监督在大规模数据上训练 / Self-supervised training on large datasets |
| Fine-tuning | 微调 | 在预训练模型上用领域数据继续训练 / Continuing training on a pretrained model with domain data |
| Token | 词元 | LLM 处理的基本单位,通常是子词片段 / Basic unit processed by LLMs, usually subword fragments |
| Context Window | 上下文窗口 | LLM 单次处理的最大 token 数 / Maximum tokens an LLM processes in one pass |
| Scaling Laws | 缩放定律 | 模型性能与参数/数据/算力的幂律关系 / Power-law relation between performance and params/data/compute |
| Emergent Abilities | 涌现能力 | 规模超过阈值后出现的新能力 / New abilities appearing beyond a scale threshold |
| Chain-of-Thought (CoT) | 思维链 | 让模型逐步推理来提升表现的提示技巧 / Prompting technique improving performance via step-by-step reasoning |
| Reinforcement Learning (RL) | 强化学习 | 通过奖励信号学习决策的范式 / Learning paradigm via reward signals |
| Reward Function | 奖励函数 | 定义智能体目标的标量信号 / Scalar signal defining the agent's objective |
| Markov Decision Process (MDP) | 马尔可夫决策过程 | 强化学习的数学框架 / Mathematical framework for RL |
| Q-Learning | Q 学习 | 经典无模型强化学习算法 / Classic model-free RL algorithm |
| RLHF | 基于人类反馈的强化学习 | 用人类偏好训练奖励模型再优化 LLM / Training reward models on human preferences to optimize LLMs |
| DPO (Direct Preference Optimization) | 直接偏好优化 | 跳过奖励模型直接用偏好数据训练 / Training directly on preferences, skipping reward models |
| World Model | 世界模型 | 智能体对环境动力学的内部表征 / Agent's internal representation of environment dynamics |
| Embedding | 嵌入 | 将离散对象映射到稠密向量 / Mapping discrete objects to dense vectors |
| Hallucination | 幻觉 | LLM 生成与事实不符内容的现象 / Phenomenon of LLMs generating content contrary to facts |

---

## 阶段 9 · 范式突破方向 / Phase 9 · Paradigm Shift Directions

| 英文 English | 中文 Chinese | 一句话定义 One-line Definition |
|------------|------------|-----------------------------|
| JEPA (Joint-Embedding Predictive Architecture) | 联合嵌入预测架构 | LeCun 提出的非生成式自监督框架 / Non-generative self-supervised framework proposed by LeCun |
| Energy-Based Model (EBM) | 基于能量的模型 | 用能量函数度量观察兼容性的模型 / Models using energy functions to measure observation compatibility |
| Predictive Coding | 预测编码 | 大脑通过预测误差学习的神经理论 / Neural theory that brains learn via prediction errors |
| Active Inference | 主动推断 | Friston 提出的基于自由能原理的智能框架 | Intelligence framework based on Friston's Free Energy Principle |
| Free Energy Principle | 自由能原理 | 生物系统最小化意外能量的理论 / Theory that biological systems minimize surprise energy |
| Markov Blanket | 马尔可夫毯 | 将内部状态与外部环境分隔的统计界面 / Statistical interface separating internal state from environment |
| Causal Inference | 因果推断 | 从数据中识别因果关系的方法论 / Methodology identifying causal relations from data |
| Causal Hierarchy | 因果层级 | Pearl 的观察→干预→反事实三层 / Pearl's three levels: association, intervention, counterfactual |
| Structural Causal Model (SCM) | 结构因果模型 | Pearl 的因果建模框架 / Pearl's framework for causal modeling |
| Counterfactual | 反事实 | "如果当时..."的虚拟推理 / "What if..." hypothetical reasoning |
| Model-Based RL | 基于模型的强化学习 | 显式学习环境模型的强化学习 / RL explicitly learning an environment model |
| Model-Free RL | 无模型强化学习 | 不显式建模环境,直接学习策略/值 / RL learning policy/value directly without modeling environment |
| Compressive AI | 压缩式 AI | Schmidhuber 主张:智能即数据压缩 / Schmidhuber's view: intelligence = data compression |
| Program Synthesis | 程序合成 | 从规范自动生成程序 / Automatically generating programs from specifications |
| Neurosymbolic AI | 神经符号 AI | 结合神经网络与符号推理的范式 / Paradigm combining neural networks with symbolic reasoning |
| Continual Learning | 持续学习 | 不遗忘旧任务地学习新任务 / Learning new tasks without forgetting old ones |
| Meta-Learning | 元学习 | 学习如何学习 / Learning how to learn |
| Embodied AI | 具身 AI | 与物理或模拟世界交互的 AI / AI interacting with physical or simulated worlds |
| Memory-Augmented Networks | 记忆增强网络 | 配备外部可寻址记忆的网络 / Networks with external addressable memory |

---

## 使用说明 · Usage Notes

- 这份表会随着学习推进持续扩充。/ This table grows as the journey progresses.
- 每次遇到新术语,**第一件事**是更新这份表。/ The **first thing** to do when encountering a new term is to update this glossary.
- 优先记忆英文。中文翻译有时会丢失原意。/ Prioritize memorizing English. Chinese translations sometimes lose original meaning.
- 当一个术语在不同阶段有不同含义时(如 Register 在数字逻辑与 CPU 内部含义略有不同),在表中保留两种定义,标注阶段。/ When a term has different meanings across phases (e.g., Register in digital logic vs. CPU internals), keep both definitions, annotated with phase.
