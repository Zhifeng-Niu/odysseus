---
title: 阶段 8 · 当前 AI 范式 · The Current Paradigm
type: phase
phase: 8
tags: [llm, scaling-laws, rlhf, world-models, emergence]
created: 2026-07-21
language: zh-CN
---

# 阶段 8 · 当前 AI 范式 · The Current Paradigm

> **阶段核心问题 / Central Question**
> 我们现在处在 AI 历史的什么位置?当前 LLM 范式的真正本质是什么?它的力量与边界在哪?
> > Where are we in AI history? What is the true essence of the current LLM paradigm? Where are its power and limits?

## 范式地图 / Paradigm Map

```
当前 AI 主导范式 Current Dominant Paradigm
─────────────────────────────────────────
基础 Foundation: Transformer (阶段 7)
+ 大数据 Big Data (互联网文本)
+ 大算力 Big Compute (GPU/TPU 集群)
+ 反向传播 Backprop (阶段 7)
↓
预训练 Pretraining
- 目标 Objective: 预测下一 token (压缩)
- 模型规模 Model Size: 10⁹ - 10¹² 参数
- 数据规模 Data: 10¹² token
↓
后训练 Post-Training
- 监督微调 SFT (instruction tuning)
- RLHF / DPO (人类偏好)
- 工具使用 Tool Use
↓
部署 Deployment
- 推理 Inference: KV cache, Flash Attention
- 应用 Apps: ChatGPT, Cursor, Claude
↓
应用 Applications
- 代码 Code, 写作 Writing, 客服 Support
- 多模态 Multimodal, Agent
```

## 学习目标 / Learning Objectives

完成此阶段后,你将能够 / After this phase, you will be able to:

- 精确描述 LLM 的"本质"——它**是什么**,**不是什么** / Precisely describe LLM essence — what it is and isn't
- 理解 Scaling Laws 的数学形式,判断 LLM 是否在撞墙 / Understand scaling laws' math; judge if LLM is plateauing
- 掌握 RLHF / DPO / GRPO 等后训练技术 / Master post-training techniques (RLHF, DPO, GRPO)
- 区分"真世界模型"和"伪世界模型" / Distinguish true vs pseudo world models
- 评判"涌现"是真实现象还是评估假象 / Evaluate whether "emergence" is real or metric artifact
- 建立批判 LLM 范式的能力,为阶段 9 范式突破铺路 / Build LLM critique ability for stage 9

## 本阶段文件 / Files in This Phase

| 文件 File | 核心问题 Core Question |
|----|----|
| [[llm-essence]] | LLM 的"本质"是什么?它是"统计鹦鹉"还是"真正理解"? / What is LLM's "essence"? Statistical parrot or true understanding? |
| [[scaling-laws]] | 模型越大越好?Scaling 有尽头吗? / Bigger is better? Does scaling have a ceiling? |
| [[reinforcement-learning]] | RL 是什么?为什么 AlphaGo/ChatGPT 都依赖它? / What is RL? Why do AlphaGo/ChatGPT depend on it? |
| [[rlhf]] | RLHF 如何让 LLM"听话"?它有什么问题? / How does RLHF make LLMs "obey"? What's wrong with it? |
| [[world-models]] | LLM 有"世界模型"吗?LeCun 为什么说没有? / Do LLMs have "world models"? Why does LeCun say no? |
| [[emergence]] | "涌现"是真实现象还是评估假象? / Is "emergence" real or artifact? |

## 当前范式的力量 / Current Paradigm's Power

### 力量 1: 通用性 Generality

一个 Transformer 架构处理:
- 自然语言(100+ 语言)
- 代码(50+ 编程语言)
- 图像(ViT, CLIP)
- 蛋白质(AlphaFold 2)
- 数学(AlphaProof)
- 音频(Whisper)

### 力量 2: 数据效率的"反直觉"

LLM **个体** 数据效率低(需万亿 token),但**人类整体**效率高:
- 一个 LLM 服务 10 亿用户
- 用户平均每个查 ~1000 token/天
- 总效率: 1000 token 服务一个查询

### 力量 3: 可塑性 Plasticity

同一基座模型通过 prompt/微调适应无数任务.**这是前所未有的工程范式**.

### 力量 4: 涌现能力 Emergent Abilities

模型大到一定程度,出现"小模型不会"的能力:
- 少样本学习 few-shot learning
- 思维链 Chain-of-Thought
- 多步推理 multi-step reasoning

## 当前范式的边界 / Current Paradigm's Limits

### 边界 1: 逻辑推理可靠性

LLM 在多步逻辑上**经常失败**.即便 GPT-4, 也无法可靠执行 10 步精确推理.

### 边界 2: 长上下文不等于"理解"

虽然上下文窗口 1M+ token,但**真正利用**的只是前面部分("Lost in the Middle" 现象).

### 边界 3: 持续学习 Continual Learning

LLM 训练后**无法**学习新事实(除非 fine-tune 或 RAG).

### 边界 4: 真实世界 Grounding

LLM 学到的是**文本**,不是**世界**.它不知道"苹果"的物理质感.

### 边界 5: 因果 vs 相关

LLM 学到的是**统计相关**,不是**因果**.Pearl 的核心批判.

### 边界 6: 计算复杂度

O(n²) 注意力 → 长序列代价爆炸.

## 与其他阶段的连接 / Connections

- **从阶段 7 接续**: Transformer 历史 → 当前 LLM 范式
- **向阶段 9 过渡**: 这里列出的**边界**,正是阶段 9 范式突破的**目标**

## 关键警示 / Key Warnings

1. **不要被商业宣传迷惑**: OpenAI / Anthropic / Google 的市场宣传**不等于** 真实进展.LLM 演示效果与实际部署效果常有差距.
2. **不要被"涌现"浪漫化**: 有些"涌现"是真实现象,有些是评估指标选择造成的假象.
3. **不要忽视"压缩即智能"的争议**: Sutskever/Hutter 主张"预测 = 理解".LeCun/Pearl 反对.**这是范式之争**.
4. **不要单押 Scaling**: 大公司有资源押 Scaling.个人/小团队应该关注**思想突破**,不是规模竞争.

## 推荐资源 / Resources

### 论文 / Papers
- Kaplan et al. (2020) *Scaling Laws for Neural LMs*
- Brown et al. (2020) *GPT-3: Language Models are Few-Shot Learners*
- Ouyang et al. (2022) *Training language models to follow instructions with human feedback* (InstructGPT)
- Wei et al. (2022) *Emergent Abilities of Large Language Models*
- Schaeffer et al. (2023) *Are Emergent Abilities of LLMs a Mirage?*

### 书籍 / Books
- Stephen Wolfram *What Is ChatGPT Doing... and Why Does It Work?*
- Brian Christian *The Alignment Problem*
- Nate Soares / Eliezer Yudkowsky 选集 / *Rationality: From AI to Zombies*

### 博客 / Blogs
- **Anthropic 论文博客** (interpretability, alignment)
- **OpenAI 技术报告**
- **Lilian Weng** (个人博客,大规模综述)
- **Karpathy** (从零开始讲 LLM)

## 完成判据 / Completion Criteria

- [ ] 能用 3 句话解释"LLM 在做什么" / Can explain "what LLMs do" in 3 sentences
- [ ] 能陈述 Scaling Laws 的形式,并讨论其边界 / State scaling laws' form, discuss limits
- [ ] 能区分 SFT、RLHF、DPO / Distinguish SFT, RLHF, DPO
- [ ] 能陈述 LeCun 对 LLM 的 3 个主要批判 / State LeCun's 3 main LLM critiques
- [ ] 能讨论"涌现"是不是真实现象 / Discuss whether "emergence" is real

---

参见 / See also: [[learning-roadmap]], [[transformer-architecture]], [[glossary]]
