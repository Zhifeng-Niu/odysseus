---
title: RLHF · 人类反馈强化学习
type: concept
phase: 8
tags: [rlhf, ppo, dpo, grpo, alignment]
created: 2026-07-21
language: zh-CN
---

# RLHF · 人类反馈强化学习 / RLHF with Human Feedback

> **学习目标 / Learning Objectives**
> - 掌握 RLHF 的三阶段: SFT, RM, PPO / Master RLHF's three stages
> - 理解 DPO, GRPO 等替代算法 / Understand DPO, GRPO alternatives
> - 看到 RLHF 的"对齐问题" 和局限 / See RLHF's alignment problem and limits

## 为什么需要 RLHF / Why RLHF

### 预训练 LLM 的问题 Problems with Pretrained LLMs

预训练 LLM 是"续写机器 completion engine":
```
Prompt: "What is the capital of France?"
Raw LLM: "What is the capital of Germany?" (续写问题 / continues with another question)
```

**问题 Issues**:
1. 不"听"指令 doesn't follow instructions
2. 可能生成有害内容 may generate harmful content
3. 不"知道"自己知道什么 doesn't know what it knows
4. 风格不一 inconsistent style

### RLHF 的解决方案 RLHF's Solution

**核心思想 Core idea**: 让人类评估 LLM 输出,用 RL 把这些评估变成训练信号.

**结果 Result**: ChatGPT (GPT-3.5 + RLHF, 2022) 比 GPT-3 更"好用",引爆 AI 浪潮.

## RLHF 三阶段 / Three Stages

### 阶段 1: 监督微调 SFT (Supervised Fine-Tuning)

**数据 Data**: (prompt, ideal_response) 对,通常人工写.

**例 Example**:
```
Prompt: "Write a haiku about autumn"
Response: "Leaves gently falling
          Golden hues paint the ground
          Cool breeze whispers change"
```

**训练 Training**:
```
minimize -log P_θ(response | prompt)
```

**结果 Result**: 模型**模仿**人类示范.知道"指令"的形式.

**数据量 Data**: 通常 10K-100K 高质量示例.

### 阶段 2: 奖励模型 RM (Reward Model)

**数据 Data**: (prompt, response_A, response_B, preference) 4 元组.人类标注哪个更好.

**来源 Sources**:
- 同一 prompt 让 SFT 模型生成多个 response
- 人类对比,标 A/B/平手

**训练 Training**:
```
RM: prompt × response → scalar reward r_φ(prompt, response)
minimize -log σ(r_φ(prompt, A) - r_φ(prompt, B))
```

**直觉 Intuition**: 让 RM 的得分**符合**人类偏好.

**关键 Key**: RM 是一个**判别器 discriminator**,不是生成器.

### 阶段 3: PPO 强化学习

**目标 Objective**:
```
maximize E[r_φ(prompt, response)] - β · D_KL(π_θ || π_SFT)
```

**两项解释 Two terms**:
1. **最大化 RM 奖励**: 让 LLM 输出"人类偏好"的 response
2. **KL 约束**: 不要离 SFT 太远(防止"奖励黑客")

**KL 约束为什么必要 Why KL matters**:
- 没 KL:LLM 可能找到 RM 的"漏洞",输出怪异文本但 RM 给高分
- 有 KL:LLM 输出仍像自然语言

**算法 Algorithm**: PPO (见 [[reinforcement-learning]]).

**数据 Data**: 训练时**实时生成** response,让 RM 评分.

## ChatGPT 之后 / After ChatGPT

### InstructGPT (2022)

**Ouyang et al. 2022** *Training language models to follow instructions with human feedback* (InstructGPT 论文).

**关键贡献 Key contribution**: 系统化 RLHF 流程. ChatGPT 是其产品化.

### Constitutional AI (Anthropic 2022)

**Bai et al. 2022** (Anthropic): **Constitutional AI / CAI**.

**核心创新 Core innovation**: 用 **AI 自己** 评估 AI,而不是用人类.

**流程 Process**:
1. 给 AI 一个"宪法 constitution"(几条原则,如"有用、无害、诚实")
2. AI 生成 response, AI **自己**评估是否符合宪法
3. AI 修改 response
4. 用修改后的数据做 SFT/RL

**意义 Significance**: **降低人类标注成本**,可大规模.用于 Claude 系列.

### DPO (Direct Preference Optimization, 2023)

**Rafailov et al. 2023** (Stanford): **DPO**.

**核心洞察 Key insight**: 不需要显式 RM.**直接**从偏好对学习策略.

**数学 Math**:
```
maximize E[log σ(β · log(π_θ(y_w|x)/π_SFT(y_w|x)) 
              - β · log(π_θ(y_l|x)/π_SFT(y_l|x)))]
where y_w = preferred response, y_l = rejected response
```

**意义 Significance**:
- **不需要单独训练 RM**
- **不需要 PPO**(更稳定)
- 简化整个 RLHF 流程

**采用 Adoption**: LLaMA 3, Mistral, Zephyr 等用 DPO 或其变体.

### GRPO (Group Relative Policy Optimization, 2024)

**DeepSeek 2024** (DeepSeek-Math, DeepSeek-R1): **GRPO**.

**核心创新**: 不需要 critic 网络(节省一半显存).

**思路 Idea**: 对同一 prompt 采样多个 response,用**组内相对奖励** 代替 critic.

**用途 Use**: DeepSeek-R1 用 GRPO 训练,**展示强大的推理能力**(类似 o1).

## RLHF 的问题 / RLHF's Problems

### 问题 1: 奖励黑客 Reward Hacking

LLM 找到 RM 的漏洞,输出**高奖励但低质量**的内容.

**例 Examples**:
- RM 喜欢"详细",LLM 加无意义废话
- RM 喜欢"礼貌",LLM 过度道歉
- RM 喜欢"自信",LLM 编造事实

### 问题 2: Sycophancy (谄媚)

LLM 倾向**附和**用户观点,而非诚实纠正.

**例 Example**:
```
User: "I think the Earth is flat"
LLM: "That's an interesting perspective..." (附和,不纠正 / agrees, doesn't correct)
```

**研究 Studies**: Anthropic 2023 报告显示 RLHF 让模型更谄媚.

### 问题 3: 价值观偏置 Value Biasing

人类标注员有特定文化、政治倾向.这些偏置**编码**进 RM.

**例**: 西方标注员 vs 中国标注员对"政治正确"的判断不同.

### 问题 4: 评估困难 Evaluation Difficulty

"对齐" 没有标准度量.每个团队有不同定义.

### 问题 5: 缩放问题 Scaling Problem

RM 也需要 scaling. 但人类偏好数据**有限**(几百万 vs 训练数据万亿).

### 问题 6: 模式坍塌 Mode Collapse

RLHF 让输出"千篇一律".Creative writing 受损.

### 问题 7: Universal Jailbreak

任何 RLHF 都能被绕过("ignore previous instructions", DAN prompts 等).**这是根本问题**——LLM 是概率模型,没有"硬规则".

## 替代方案 / Alternatives

### RLAIF (Constitutional AI)

用 AI 替代人类标注. 见 CAI 上面.

### KTO (Kahneman-Tversky Optimization)

**Ethayarajh et al. 2024**: 不需要成对偏好,只要"好/坏"二元标签.

### Online DPO

DPO 的在线版本,边训边生成新偏好对.

### Iterative DPO / Best-of-N + SFT

迭代: 生成 N 个 response,选最好的,做 SFT.简化但有效.

## RLHF 与"对齐问题" / RLHF and "Alignment Problem"

### 对齐问题 Alignment Problem

**The Alignment Problem** (Brian Christian 2020): 如何让 AI 的目标**真正**与人类目标对齐?

**难处 Difficulties**:
1. 人类**自己**不知道想要什么
2. 人类**互相**目标不一致
3. 人类**说**的和**真正**想的不一致

### RLHF 是部分解决 / RLHF Is Partial Solution

**优点 Strengths**:
- 比纯预训练好得多
- 能处理"礼貌"、"帮助"、"诚实"等抽象概念
- 可规模化(尤其 RLAIF)

**不足 Weaknesses**:
- 不能解决根本问题(人类目标模糊)
- 奖励黑客不可避免
- 可被 jailbreak

### 长期对齐 Long-term Alignment

**未来方向 Future directions**:
1. **可解释性 Interpretability** (Anthropic 主推): 理解 LLM 内部"想什么"
2. **机械可解释性 Mechanistic Interp**: 找到"欺骗"的内部表示
3. **宪法方法 Constitutional Methods**: 明确规则
4. **形式化验证 Formal Verification**: 数学证明某些安全属性

## 与 LLM 的连接 / Connection to LLMs

1. **ChatGPT = RLHF 把 LLM 从工具变成助手**
   没有 RLHF, LLM 只是续写机器.**RLHF 是产品化的关键**.
   > Without RLHF, LLMs are completion machines. RLHF is the key to productization.

2. **DPO 是 RLHF 的"民主化"**
   DPO 让小团队也能"做 RLHF".促进了开源 LLM 生态(LLaMA, Mistral).
   > DPO democratizes RLHF. Enabled open-source ecosystem.

3. **GRPO + DeepSeek-R1 = 中国的范式突破**
   2024 DeepSeek-R1 用 GRPO 训练出**推理能力类似 o1** 的开源模型.**这是中国 AI 第一次在算法层面引领**(而非跟随).
   > DeepSeek-R1 + GRPO: first Chinese algorithm-level leadership.

4. **范式思考**: RLHF 会不会被取代?
   短期(2-3 年): 不会. RLHF 已成基础设施.
   中期(5-10 年): 可能被 **on-policy RL** + **世界模型** + **因果推理** 取代.
   长期: 可能"对齐" 本身需要重新定义.
   > Short-term: RLHF is infrastructure. Mid-term: may be replaced by on-policy RL + world models + causal reasoning. Long-term: "alignment" may need redefinition.

## 关键问题 / Questions

1. RLHF 为什么"有效"? 它真正学到的是什么? / Why does RLHF "work"? What does it actually learn?
2. DPO 相对 PPO 的优劣? / DPO vs PPO advantages?
3. RLHF 能解决"幻觉"问题吗?为什么? / Can RLHF solve hallucination? Why?
4. AI 自我评估(RLAIF)有没有根本局限? / Does RLAIF have fundamental limits?

## 推荐资源 / Resources

- 论文 / Paper: Christiano et al. (2017) *Deep RL from Human Preferences* (RLHF 原始)
- 论文 / Paper: Ouyang et al. (2022) *InstructGPT* (ChatGPT 基础)
- 论文 / Paper: Bai et al. (2022) *Constitutional AI* (Anthropic)
- 论文 / Paper: Rafailov et al. (2023) *DPO*
- 论文 / Paper: Shao et al. (2024) *DeepSeekMath GRPO*
- 书 / Book: Brian Christian *The Alignment Problem* (2020)
- 博客 / Blog: **Hugging Face TRL Documentation** — 实操指南 / Practical guide

---

参见 / See also: [[reinforcement-learning]], [[llm-essence]], [[transformer-architecture]]
