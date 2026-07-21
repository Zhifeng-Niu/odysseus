---
title: 阶段 7 · AI 历史与思想史 / History of AI and Its Ideas
type: phase
phase: 7
tags: [ai-history, symbolic-ai, connectionism, deep-learning, transformer]
created: 2026-07-21
language: zh-CN
---

# 阶段 7 · AI 历史与思想史 / History of AI and Its Ideas

> **阶段核心问题 / Central Question**
> 我们是怎么走到今天的?从 1956 达特茅斯会议到 2022 ChatGPT, AI 经历了哪些范式更迭?每次兴衰背后的思想是什么?
> > How did we get here? From 1956 Dartmouth to 2022 ChatGPT, what paradigm shifts occurred? What ideas powered each rise and fall?

## 为什么学 AI 历史 / Why Study AI History

**很多工程师认为 / Many engineers think**: "历史已过,我只要学最新技术(Transformer、RLHF)."

**问题 Problem**: 这种想法让你:
1. **看不到当前范式的偶然性**: Transformer 不是必然,它是 30 个偶然事件的结果
2. **重蹈覆辙**: 符号 AI 也曾自认"必将通向 AGI",后来冬天来了
3. **错过未来的范式信号**: 现在被忽视的某些方向(如因果 AI、主动推断)可能是下一个突破

> Without history, you miss: (1) current paradigm's contingency, (2) past mistakes to avoid, (3) emerging paradigm signals.

## 学习目标 / Learning Objectives

完成此阶段后,你将能够 / After this phase, you will be able to:

- 梳理 AI 70 年的**思想脉络**,而非记流水账 / Trace 70 years of AI's *intellectual lineage*, not just chronology
- 区分**符号主义、连接主义、行为主义**三大流派的根本分歧 / Distinguish Symbolism, Connectionism, Behaviorism — three fundamental schools
- 看到每次"AI 寒冬"的成因,识别当前是否有寒冬征兆 / See causes of each AI Winter; recognize today's signals
- 理解 Transformer 的历史偶然性,而非"必然的最优架构" / Understand Transformer's historical contingency, not "inevitable optimal"
- 建立对未来范式转变的**预判能力** / Build predictive insight for future paradigm shifts

## 三大思想流派 / Three Schools of AI

```
                AI 思想史 Intellectual History
                       │
       ┌───────────────┼───────────────┐
       │               │               │
    符号主义         连接主义         行为主义
   Symbolism      Connectionism    Behaviorism
   (1956-)         (1943-, 1980-)    (1980s-)
       │               │               │
    "智能 =         "智能 =         "智能 =
    符号操作"       神经元协作"      与环境交互"
       │               │               │
   GOFAI,           Perceptron,      RL, Sutton,
   Expert Sys       MLP, Deep        AlphaGo
```

| 流派 School | 核心假设 Core Assumption | 代表人物 Key Figures | 兴盛期 Peak |
|----|----|----|----|
| 符号主义 | 智能基于符号逻辑推理 | McCarthy, Minsky, Newell | 1956-1980 |
| 连接主义 | 智能基于神经元网络 | Rosenblatt, Rumelhart, Hinton | 1986-至今 |
| 行为主义 | 智能基于感知-行动闭环 | Brooks, Sutton, Silver | 1990s-至今 |

## 简明年表 / Concise Timeline

### 第一波 First Wave: 符号 AI 兴起 (1956-1973)

- **1956 达特茅斯会议**: "Artificial Intelligence" 术语诞生
- **1958 McCarthy 发明 LISP**
- **1962 Newell & Simon GPS** (通用问题求解器)
- **1969 Minsky & Papert 《Perceptrons》** —— 攻击感知机, 导致连接主义寒冬
- **1970s 专家系统雏形** (DENDRAL, MYCIN)

### 第一次 AI 寒冬 First AI Winter (1974-1980)

- **1973 Lighthill Report**: 英国砍 AI 经费
- **DARPA 大幅削减** AI 投资
- 符号 AI 承诺过多,实际表现差

### 第二波 Second Wave: 专家系统 (1980-1987)

- **1980 卡内基梅隆 XCON**: DEC 计算机配置专家系统,年省 $4000 万
- **日本第五代计算机计划**: 8.5 亿美元,目标 Prolog 推理机
- **LISP 机市场**: Symbolics, LMI 等公司

### 第二次 AI 寒冬 Second AI Winter (1987-1993)

- **苹果/IBM PC** 击溃 LISP 机(通用硬件更便宜)
- **专家系统维护成本爆炸**: 规则爆炸、无法学习
- **日本第五代失败**

### 第三波 Third Wave: 概率与数据驱动 (1993-2012)

- **1997 Deep Blue 击败 Kasparov**(国际象棋)
- **2006 Hinton 深度信念网络**: "Deep Learning" 术语复兴
- **2011 IBM Watson 赢 Jeopardy!**
- **2012 AlexNet 赢 ImageNet**(深度学习革命开端)

### 第四波 Fourth Wave: 深度学习 + Transformer (2012-2020)

- **2014 GAN (Goodfellow)**
- **2015 ResNet** (152 层)
- **2016 AlphaGo 击败 Lee Sedol** (强化学习 + 深度学习)
- **2017 Vaswani 等 "Attention Is All You Need"** —— Transformer
- **2018 BERT** (Google)
- **2019 GPT-2** (OpenAI)

### 第五波 Fifth Wave: 大模型时代 (2020-至今)

- **2020 GPT-3** (175B 参数)
- **2021 DALL-E / CLIP** (多模态)
- **2022 ChatGPT** (RLHF + GPT-3.5, 2 个月达 1 亿用户)
- **2023 GPT-4 / Claude / Gemini / LLaMA**
- **2024 Sora / 视频生成**
- **2025+ 多模态 Agent**

## 本阶段文件 / Files in This Phase

| 文件 File | 核心问题 Core Question |
|----|----|
| [[symbolic-ai]] | "智能 = 符号操作" 是对还是错? / Is "intelligence = symbol manipulation" right or wrong? |
| [[perceptron]] | 第一个"学习机器"为什么让 Minsky 担忧? / Why did the first learning machine worry Minsky? |
| [[connectionism]] | 神经元 vs 符号: 谁更接近大脑? / Neurons vs symbols: which is closer to brain? |
| [[backpropagation]] | 反向传播如何让神经网络复活? / How did backprop resurrect neural networks? |
| [[deep-learning-winter]] | 为什么深度学习直到 2012 才爆发? / Why did deep learning wait until 2012? |
| [[transformer-architecture]] | Transformer 是革命还是巧合? / Transformer: revolution or accident? |

## 与其他阶段的连接 / Connections

- **从阶段 6 (可计算性) 接续**: 符号 AI 假设"智能 = Turing 完备符号系统",这是 C-T 论题的极端延伸.
- **向阶段 8 (当前范式) 过渡**: Transformer 之后,LLM 成为主导.但**它的局限**(阶段 9 讨论)正源于思想史的路径依赖.
- **向阶段 9 (范式转变) 铺路**: LeCun、Pearl、Friston 等批评 LLM 的人,他们的主张都能在 AI 历史中找到根源.

## 关键警示 / Key Warnings

1. **不要被"现在"迷惑**: 今天的 LLM 看起来势不可挡,就像 1985 年的专家系统.历史证明,技术优势 ≠ 永久统治.
2. **不要忽视被边缘化的思想**: 符号 AI、感知机、概率图模型——它们没有"死",只是退到后台.未来的突破可能是**重新组合**这些思想.
3. **不要把 Anthropic/OpenAI 的宣传当成全部**: 真正的 AI 思想史包括神经科学、控制论、心理学、哲学——不只是 Transformer 工程优化.

> 1. Don't be seduced by "now": LLMs look unstoppable today, like expert systems in 1985.
> 2. Don't dismiss marginalized ideas: symbolic AI, perceptrons, probabilistic models may yet return.
> 3. Don't mistake corporate hype (OpenAI/Anthropic) for the entire AI intellectual history.

## 推荐资源 / Resources

### 书籍 / Books
- **Nils Nilsson**, *The Quest for Artificial Intelligence* — 标准史 / Standard history
- **Stuart Russell & Peter Norvig**, *AIMA* 第 1 章 / Chapter 1 (综述)
- **Brian Christian**, *The Most Human Human* — 图灵测试史 / Turing Test history
- **Stephen I. Gallistel**, *The Organization of Learning* — 行为主义到认知 / Behaviorism to cognition

### 纪录片 / Documentary
- **Lo-Ai** (2016)
- **The Truth About AI** (BBC, 2021)

### 论文 / Papers (原始 / Originals)
- Turing (1950) *Computing Machinery and Intelligence*
- McCarthy et al. (1955) *Proposal for the Dartmouth Summer Research Project*
- Rumelhart, Hinton, Williams (1986) *Learning representations by back-propagating errors*
- Vaswani et al. (2017) *Attention Is All You Need*

## 完成判据 / Completion Criteria

- [ ] 能画出 AI 70 年的简明年表 / Can sketch 70 years of AI timeline
- [ ] 能区分三大流派的根本假设 / Can distinguish three schools' core assumptions
- [ ] 能解释"为什么 2012 年深度学习爆发"的 3 个关键因素 / Can explain 3 reasons for 2012 deep learning explosion
- [ ] 能批判性看待当前 LLM 兴起,识别可能的"冬天信号" / Can critically view LLM rise, recognize winter signals

---

参见 / See also: [[learning-roadmap]], [[glossary]]
