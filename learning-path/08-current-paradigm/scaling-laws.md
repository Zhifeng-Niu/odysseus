---
title: 缩放定律 · Scaling Laws
type: concept
phase: 8
tags: [scaling-laws, kaplan, chinchilla, compute-optimal]
created: 2026-07-21
language: zh-CN
---

# 缩放定律 · Scaling Laws

> **学习目标 / Learning Objectives**
> - 掌握 Kaplan 2020 和 Chinchilla 2022 缩放定律的数学形式 / Master Kaplan 2020 and Chinchilla 2022 math
> - 理解"compute-optimal"训练的意义 / Understand "compute-optimal" training
> - 看到 Scaling 是否在撞墙,识别"拐点"信号 / See if scaling plateaus; recognize inflection signals

## Kaplan 缩放定律 (2020)

**Jared Kaplan et al. 2020** *Scaling Laws for Neural Language Models*:

**核心发现 Core finding**: 模型的**测试损失 test loss** 是参数量 N、数据量 D、计算量 C 的**平滑幂律 smooth power law**.

### 数学形式 Math

**固定两个,变化一个 Fixed two, vary one**:

```
L(N) = (N_c / N)^α_N         α_N ≈ 0.076
L(D) = (D_c / D)^α_D         α_D ≈ 0.095
L(C) = (C_c / C)^α_C         α_C ≈ 0.057
```

其中:
- L = 测试损失 test loss
- N = 参数量 parameters
- D = 数据量 tokens
- C = 计算量 FLOPs
- α = 幂指数 power exponent
- N_c, D_c, C_c = 常数

**意义 Significance**:
1. **平滑**: 性能改进**可预测**,不是突然跳跃.
2. **幂律**: 双对数图上是直线.
3. **没有饱和**: 在测试范围内,**没有上限**.

### 损失与下游性能 Loss vs Downstream

**重要 Important**: 测试损失是**连续平滑下降**,但下游任务(如 MMLU)可能**跳跃式改善**(涌现,见 [[emergence]]).

## Chinchilla 缩放定律 (2022)

**Hoffmann et al. 2022 (DeepMind)** *Training Compute-Optimal LLMs*:

**核心发现 Core finding**: Kaplan 2020 **低估了**数据的重要性.Chinchilla 用**等比例缩放**模型和数据.

### Chinchilla 公式

给定计算预算 C, **最优 N 和 D**:

```
N* ∝ C^0.50
D* ∝ C^0.50
```

即: 模型和数据**应该等比例增长**.

**对比 Kaplan**: Kaplan 主张 N 增长 ~C^0.73, D 增长 ~C^0.27.**模型比数据快得多**.

### Chinchilla 模型验证

DeepMind 训练 Chinchilla (70B 参数,1.4T tokens) 对照 GPT-3 (175B 参数,300B tokens):

**结果 Result**: Chinchilla **超过** GPT-3,尽管只有 40% 的参数.

**意义 Implication**: GPT-3 "训练不足 undertrained"——参数多但数据少.

**教训 Lesson**: **数据 = 模型**重要性.这是 2022 后 LLM 训练范式的基础.

## Compute-Optimal 训练

### 原则 Principle

给定预算 C,目标最大化性能.按 Chinchilla 比例分配 N 和 D.

**实操 Heuristic**: 每 1 个参数,训练 ~20 个 token.

**例 Example**:
- LLaMA 7B: 1T tokens (1T/7B = 142 tokens/参数,**超过 Chinchilla**)
- LLaMA 65B: 1.4T tokens (21 tokens/参数,符合)
- GPT-4 (~1.8T 参数): ~13T tokens (符合)
- Claude 3 Opus: 估计 ~2T 参数, ~10T tokens

### "过度训练" Over-training

LLaMA 7B 训练 1T tokens = 142 tokens/参数,**远超** Chinchilla 的 20:1.

**为什么 Why**:
- 推理成本**远超**训练成本(部署到数百万用户)
- 小模型 + 多数据 = **更快推理** + **同等质量**
- 这是 LLaMA 系列的设计哲学

**LLaMA 3 (2024)**: 8B 模型训练 15T tokens = 1875 tokens/参数.**极致过度训练**,推理效率高.

## 缩放极限的争议 / Debate on Scaling Limits

### 乐观派 Optimists (Sam Altman, Dario Amodei)

**主张 Claim**: Scaling 还有十年以上空间.我们没看到饱和.

**证据 Evidence**:
- GPT-4 → GPT-5 持续改进
- 多模态(图像、视频)还在早期
- 新算法(如 MoE) 让 scaling 更经济

### 悲观派 Pessimists (Yann LeCun, Gary Marcus)

**主张 Claim**: Scaling 收益递减.需要**新范式**(世界模型、因果 AI).

**证据 Evidence**:
- GPT-3 → GPT-4 大跳,GPT-4 → GPT-4o/5 小步
- 幻觉问题没有改善
- LLM 仍不能可靠执行多步推理

### 中间派 Middle (Ilya Sutskever, Noam Shazeer)

**主张 Claim**: Scaling 仍然有效,但需要**新架构**(如 Mamba)、**新训练目标**(超越 next-token).

## 数据墙 Data Wall

### 高质量数据用尽 / Running Out of High-Quality Data

**2024 估算 Estimates**:
- 互联网高质量文本: ~10-20T tokens
- 已用于训练: ~5-10T tokens
- **2026-2028 可能用尽**

**对策 Countermeasures**:
1. **合成数据 Synthetic Data**: LLM 生成训练数据(风险: 灾难性遗忘、模式坍塌)
2. **多模态 Multimodal**: 视频包含大量"世界知识"
3. **私有数据 Private Data**: 与出版商合作(Google-Reddit $60M/year)
4. **强化学习 Reinforcement**: AlphaProof 思路——AI 自己生成训练数据

### 合成数据的限制 Synthetic Data Limits

**问题 Problem "Model Collapse"** (Shumailov et al. 2024):
- 模型训练自己生成的数据 → 多代后**性能下降**
- 原因: 误差累积,模式坍塌

**对策 Solution**:
- 始终混合**真实**数据
- 用**多个**模型生成,避免单模型偏差
- 强化学习信号(AlphaProof 风格)

## 算力墙 Compute Wall

### 能源 Energy

**GPT-4 训练估计**: ~50 GWh (相当于 ~5000 美国家庭年用电)

**未来训练 Future Training**:
- 1e26 FLOPs (GPT-4 量级): 50 GWh
- 1e27 FLOPs: 500 GWh
- 1e28 FLOPs: 5000 GWh
- 1e29 FLOPs: 50000 GWh (大型核电站年产能)

**意味 Implication**: 10 年内可能撞能源墙.Microsoft, Google 投资核能、地热.

### 芯片 Chips

**台积电 TSMC 产能**: 2024 高端 GPU 供不应求.

**地缘政治 Geopolitics**: 美中芯片战(2022-),中国只能用 H20(降级版).

### 数据中心 Data Centers

**2024 估算**: 全球数据中心 ~2% 全球用电.

**2025+ 估计**: 若 LLM 持续扩张,可能达 5-10%.

**Microsoft 2024 行动**: 三哩岛核电站重启,专为 Microsoft AI 服务.

## Scaling 的拐点信号 / Signals of Inflection

### 信号 1: 损失改进放缓

**观察 Observation**: GPT-3 → GPT-4 测试损失改进 ~0.2.若 GPT-5 只改进 0.05,可能撞墙.

### 信号 2: 下游任务饱和

MMLU 已接近人类水平(95%+),但**真实推理任务**(如 ARC-AGI)进展缓慢.

### 信号 3: 数据墙

高质量数据 2026-2028 用尽.

### 信号 4: 能源墙

若训练成本超过 $1B/模型,只有少数公司能玩.

### 信号 5: 投资回报率下降

**2024 现象**: 多家 AI 公司估值缩水.Gartner 等机构警告"AI 泡沫"风险.

## 与 LLM 的连接 / Connection to LLMs

1. **Scaling Laws 是 LLM 范式的"信仰基础"**
   如果 Scaling 有效,投入更多算力 → 更好的 LLM.这是 OpenAI, Anthropic, Google, Meta 的战略假设.
   > Scaling laws = foundational belief of LLM paradigm. Drives OpenAI/Anthropic/Google/Meta strategy.

2. **如果 Scaling 撞墙,范式需要突破**
   撞墙 = LLM 范式进入瓶颈.需要**新思想**:
   - JEPA / 世界模型(LeCun)
   - 因果 AI(Pearl)
   - 神经符号
   - 主动推断(Friston)
   
   这是阶段 9 的主题.
   > If scaling plateaus, need new ideas (stage 9 themes).

3. **小玩家不应该拼 Scaling**
   个人/小团队应该关注**思想**,不是规模.
   - 不要训 100B 模型,要找**新算法**
   - 不要拼数据,要找**新数据类型**(如视频、具身)
   - 不要拼算力,要找**新硬件**(如神经形态)

4. **范式思考**: 历史上 Scaling 何时撞墙?
   - 蒸汽机 Scaling → 撞内燃机
   - CPU Scaling (摩尔定律) → 撞多核、GPU、TPU
   - LLM Scaling → 撞?
   
   每次撞墙都是**新范式**诞生的契机.
   > Historical scaling walls birth new paradigms. LLM wall may do the same.

## 关键问题 / Questions

1. Chinchilla 缩放定律的"compute-optimal" 在什么条件下成立? / When does Chinchilla's "compute-optimal" hold?
2. 数据墙会逼出哪些新训练范式? / What new training paradigms will data walls force?
3. 如何识别"真撞墙" vs "暂时瓶颈"? / How to distinguish "true plateau" vs "temporary bottleneck"?
4. 如果 Scaling 撞墙,$10B 级 AI 公司会怎样? / If scaling plateaus, what happens to $10B AI companies?

## 推荐资源 / Resources

- 论文 / Paper: Kaplan et al. (2020) *Scaling Laws for Neural LMs*
- 论文 / Paper: Hoffmann et al. (2022) *Training Compute-Optimal LLMs (Chinchilla)*
- 论文 / Paper: Shumailov et al. (2024) *AI Models Collapse When Trained on AI-Generated Data*
- 博客 / Blog: **Anthropic "Machine Learning Republic"** 系列
- 博客 / Blog: **Lilian Weng "Scaling Laws"**
- 视频 / Video: **Andrej Karpathy "Intro to LLMs"**

---

参见 / See also: [[llm-essence]], [[emergence]], [[transformer-architecture]]
