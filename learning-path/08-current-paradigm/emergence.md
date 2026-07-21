---
title: 涌现能力 · Emergent Abilities
type: concept
phase: 8
tags: [emergence, scaling, llm-critique, mirage]
created: 2026-07-21
language: zh-CN
---

# 涌现能力 · Emergent Abilities

> **学习目标 / Learning Objectives**
> - 理解"涌现"的精确定义和争议 / Understand precise definition and controversy
> - 掌握 Schaeffer 2023 "涌现是海市蜃楼" 论证 / Master Schaeffer 2023 "mirage" argument
> - 建立对"涌现" 的批判性思维 / Build critical thinking about "emergence"

## 涌现的定义 / Definition of Emergence

### 经典涌现 Classical Emergence (Physics/Philosophy)

**涌现 Emergence**: 复杂系统中,整体展现**不可还原**到部分的新性质.

**例 Examples**:
- 水(湿润)← 氢 + 氧(干燥气体)
- 意识 ← 神经元
- 市场 ← 个体交易
- 生命 ← 化学

**关键特征 Key features**:
- 部分**没有**的性质,整体有
- 难以从部分**预测**整体行为

### LLM 的"涌现能力" (Wei et al. 2022)

**Wei et al. 2022** *Emergent Abilities of Large Language Models*:

**定义 Definition**: 能力在**小模型不存在,大模型出现**.在 scaling 曲线上表现为**相变 phase transition**.

```
性能 Performance
    │
    │               ╱
    │             ╱
    │           ╱     ← 涌现点 Emergence point
    │         ╱
    │  ____╱
    │
    └────────────────── 模型规模 Model Size
```

### 经典"涌现"能力 Examples of "Emergent" Abilities

**Wei et al. 列举 Listed examples**:

1. **少样本学习 Few-shot learning**: 小模型 zero-shot 差, 大模型 few-shot 突变
2. **思维链 Chain-of-Thought**: < 10B 模型无效, > 60B 模型有效
3. **指令跟随 Instruction Following**: GPT-3 (175B) 才有
4. **多步算术 Multi-step Arithmetic**: 大模型突然可做
5. **逻辑推理 Logical Reasoning**: Big Bench Hard 任务
6. **代码生成 Code Generation**: Codex 12B+

## Schaeffer "海市蜃楼" 论文 (2023)

**Schaeffer, Miranda, Koyejo 2023** *Are Emergent Abilities of LLMs a Mirage?* (NeurIPS 2023 Outstanding Paper):

**核心论点 Core argument**: **所谓"涌现" 可能是评估指标 artifact, 不是模型本质变化**.

### 数学论证 Mathematical Argument

**关键洞察 Key insight**: "涌现" 的视觉印象来自**非线性评估指标**(如 exact match, accuracy).

**例 Example**: 任务"输出 6 位数字的乘法结果"
- 小模型: 99% 错(几乎全错)
- 大模型: 60% 对(突然可做)

**看起来 Look like**: 涌现!

**但 But**: 用**连续指标**(如 token-level log-likelihood):
- 小模型: 50% 概率对(部分对)
- 大模型: 80% 概率对

**看起来 Look like**: 平滑改进,**无相变**.

### "涌现" 的另一种解释

**Schaeffer 主张**: 测试指标过于"严格",造成假象.

**例**: 用 exact-match vs 用 partial credit:
```
真实答案: 123456
模型输出: 123466

exact-match: 0% (完全错)
partial credit: 5/6 = 83% (大部分对)
```

**小模型**: 每位都 50% 对, exact-match 几乎全 0%.
**大模型**: 每位都 80% 对, exact-match 突然可达 30%.

但**底层**改进是**平滑**的.

### 实验验证 Experimental Validation

Schaeffer 用 6 个"涌现" 任务,改用**连续 metric**, 都看到平滑改进.

**结论 Conclusion**: 大部分"涌现" 是评估 artifact, 不是真涌现.

## 反批判 Rebuttals

### 反批判 1: 但大模型**确实**能做小模型不能的事

即便 metric artifact,**实际效果**差异巨大.

**例**: Chain-of-Thought prompting 在 < 60B 模型上**完全无效**,> 60B 才有效.这不是评估问题,是**功能差异**.

### 反批判 2: 真涌现 (逻辑、推理) 不容易 metric 化

某些能力本质上是**离散**的——会就是会,不会就是不会.用连续 metric 反而**错**.

**例**: 程序要么编译要么不编译,没有"半编译".

### 反批判 3: 即便是 metric artifact, 实用价值巨大

即便底层改进平滑,**用户感知**是相变.GPT-3.5 → GPT-4 让 ChatGPT 从"玩具"变成"工具".

### 主流共识 Mainstream Consensus (2024)

- **某些 "涌现" 确实是 metric artifact** (Schaeffer 部分对)
- **但有些"涌现" 是真实的** (CoT, 指令跟随)
- **"涌现" 一词被过度使用**, 需要精炼
- **底层改进是平滑的**(scaling laws), 但**应用效果**可能相变

## 真正的"涌现" 候选 / Candidates for Real Emergence

### 1. In-Context Learning (ICL)

GPT-3 (2020) 引爆: 不微调,只 prompt, 就能学新任务.

**为什么像真涌现 Why real**: 小模型**完全不能** ICL.它需要**足够的模型容量**来"在上下文中"形成临时学习.

### 2. Chain-of-Thought (CoT)

**Wei et al. 2022**: 让 LLM "think step by step".

**关键 Key**: 
- < 60B: CoT **无效甚至有害**
- > 60B: CoT 大幅提升推理

**理论解释 Theoretical**: CoT 让 LLM "执行"多步计算.小模型**容量不够**,无法利用额外步骤.

### 3. Theory of Mind (心智理论)

**Anthropic 2024 研究**: Claude 3 能通过经典心智理论测试(Sally-Anne false belief 等).

**争议 Controversy**: 这是真"理解他人心理", 还是模式匹配?主流:**不确定**.

### 4. 顿悟时刻 "Grokking" (训练阶段)

**Power et al. 2022**: 模型训练 100K 步突然"理解"任务,泛化能力突现.

**数学解释 Math**: grokking 与**权重衰减**导致的**稀疏化**有关.

## "涌现" 与 AGI 讨论 / Emergence and AGI Discourse

### 乐观叙事 Optimistic Narrative

"涌现" → 大模型有"小模型没有"的能力 → 继续 scaling 就能 AGI.

**代表 Representative**: Sam Altman, Dario Amodei.

**策略 Implication**: 投入更多算力.

### 悲观叙事 Pessimistic Narrative

"涌现" 是 metric artifact → scaling 收益有限 → AGI 需要新范式.

**代表 Representative**: Gary Marcus, Yann LeCun.

**策略 Implication**: 投入新思想.

### 现实主义叙事 Realistic Narrative

某些"涌现" 真,某些假.**继续 scaling + 同时探索新范式**.

**代表 Representative**: 多数研究者.

**策略 Implication**: 双轨投资.

## 与 LLM 的连接 / Connection to LLMs

1. **"涌现" 是当前 LLM 营销话术之一**
   OpenAI / Anthropic / Google 经常说"这个能力是涌现的"——暗示**意外之喜**,吸引投资.
   
   **批判性思维 Critical thinking**: 问"评估指标是什么?", "小模型真的完全不能吗?"
   > "Emergence" is marketing language. Ask: "What metric? Are small models truly incapable?"

2. **"涌现" 与 Scaling Laws 一起,构成 LLM 范式信仰**
   - Scaling Laws: 性能平滑改进
   - Emergence: 偶尔有"惊喜"
   
   二者结合: **"投更多,有惊喜"** → 投资逻辑.

3. **如果"涌现" 大部分是假象,Scaling 叙事受冲击**
   Schaeffer 2023 论文后,工业界**部分**反思"是否过度依赖 scaling".但 2024-2025 主流仍押 scaling.

4. **范式思考**: "涌现" 在大脑中存在吗?
   **有**(明显)——意识、语言、抽象思维都"涌现"自神经元.
   
   但大脑的"涌现" 经过**亿年进化**,不是简单 scaling.
   
   LLM 的"涌现" 经过**几年 scaling**——质量可能不同.
   > Brain's emergence = billions of years evolution. LLM emergence = few years scaling. Different quality.

## 关键问题 / Questions

1. 真涌现 vs 假涌现如何区分? / How to distinguish real vs fake emergence?
2. Chain-of-Thought 是真涌现吗?为什么? / Is CoT real emergence? Why?
3. 如果所有"涌现" 都是 metric artifact, Scaling 故事如何变? / If all emergence is artifact, how does scaling story change?
4. 大脑的"涌现" 和 LLM 的"涌现" 本质相同吗? / Are brain's and LLM's emergence essentially the same?

## 推荐资源 / Resources

- 论文 / Paper: Wei et al. (2022) *Emergent Abilities of LLMs*
- 论文 / Paper: Schaeffer et al. (2023) *Are Emergent Abilities a Mirage?* (NeurIPS Outstanding)
- 论文 / Paper: Power et al. (2022) *Grokking: Generalization Beyond Overfitting*
- 论文 / Paper: Anthropic (2024) *Mapping the Mind of an LLM* (心智理论 / Theory of Mind)
- 博客 / Blog: **Jason Wei "Emergent Abilities"**
- 博客 / Blog: **Gary Marcus "Deep Learning Is Hitting a Wall"**

---

参见 / See also: [[llm-essence]], [[scaling-laws]], [[world-models]]
