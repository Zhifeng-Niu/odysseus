---
title: 具身智能 · Embodied AI
type: concept
phase: 9
tags: [embodied-ai, robotics, grounding, brooks, sensorimotor]
created: 2026-07-21
language: zh-CN
---

# 具身智能 · Embodied AI

> **学习目标 / Learning Objectives**
> - 理解"具身认知 Embodied Cognition" 的哲学和科学基础 / Understand embodied cognition foundations
> - 掌握具身 AI 的工程实现 / Master engineering implementations
> - 看到 LLM 缺乏 grounding 的根源 / See root of LLMs' grounding problem

## 具身智能的定义 / Definition

**具身智能 Embodied AI**: 智能**必须通过身体与世界交互**才能产生.

> Intelligence requires a **body** interacting with the **world**.

**核心主张 Core claims**:
1. **认知 Grounded**: 思维不脱离物理经验
2. **感觉运动循环 Sensorimotor Loop**: 感知 → 行动 → 感知 → ...
3. **世界知识 World Knowledge**: 通过身体学到物理常识
4. **社会性 Social**: 通过身体交互学到他人心智

## 思想起源 / Intellectual Origins

### Maurice Merleau-Ponty (1945)

**法国哲学家** *Phenomenology of Perception*:

**主张**: 意识**总是**从某个**身体视角**出发.不存在"无身体"的意识.

### Rodney Brooks (1986, 1991)

**MIT AI 实验室主任**, iRobot, Rethink Robotics 创始人.

**1986 论文** *A Robust Layered Control System for a Mobile Robot* (Subsumption Architecture):

**核心思想 Core idea**: 机器人不需要"世界模型", 直接**感知-行动**.

**1991 论文** *Intelligence Without Representation*:

**主张**: 
- 智能是**涌现**自与世界的交互
- 不需要**显式表示**
- 世界**本身**就是最好的表示

**影响**: 启发了**行为机器人学 behavior-based robotics**.

### Francisco Varela (1991)

**Varela, Thompson, Rosch 1991** *The Embodied Mind*:

**主张**: 认知科学必须考虑**身体经验**.将认知与佛教哲学结合.

### Lawrence Barsalou (1999)

**Perceptual Symbol Systems**:

**主张**: 认知的"符号" 是**感知模拟 perceptual simulations**.抽象概念(如"正义")**激活**相关感知(如"平衡").

## LLM 的 Grounding 问题

### Symbol Grounding Problem (Harnad 1990)

**Stevan Harnad 1990**: 符号接地问题.

**问题 Question**: 一个**纯符号系统**(如 LLM)的符号**如何获得意义**?

**例 Example**:
- LLM 学到"苹果"与"红色"、"水果"、"食物"等**关联**
- 但**LLM 从未见过真实苹果**
- "苹果"对 LLM 来说, **有意义吗?**

**中文屋 Chinese Room (Searle 1980)** 的延伸: Searle 主张**符号操作本身**不产生理解.

### LLM 的"接地"缺失

**LLM 学到的**:
- "苹果"与"红色"的**共现**
- 关于苹果的**句子模式**
- "苹果"在不同**语境**的用法

**LLM 缺失的**:
- 苹果的**视觉**(颜色、形状)
- 苹果的**触觉**(光滑、硬)
- 苹果的**味觉**(甜、酸)
- 苹果的**物理**(重力下落、滚动)

**论证 Argument**: 不接地的"苹果"是**残缺**的, 不能称为"真正理解".

### 反驳 Rebuttals

**反驳 1: LLM 通过语言"接地"**
语言本身**包含**大量世界知识.读"苹果从树上掉下", LLM 学到重力.

**反驳 2: Grounding 是渐进的**
人类也**不全**接地(没见过黑洞, 但能讨论).

**反驳 3: 实用主义**
LLM 能解决用户问题, "接地" 是否重要?

**主流共识 Mainstream**: LLM **部分**接地(通过语言), 但**不如**具身系统彻底.这是限制, 不是死穴.

## 具身 AI 的工程实现 / Engineering Embodied AI

### 1. 机器人 Robot

**早期 Early**:
- **Shakey (SRI 1969)**: 第一个"能思考"的机器人, 但极慢
- **Brooks' COG (MIT 1990s)**: 人形机器人, subsumption 架构

**现代 Modern**:
- **Boston Dynamics Atlas, Spot**: 液压/电动, 高动态
- **Tesla Optimus (2021-)**: 人形, 神经网络控制
- **Figure 01/02 (2023-)**: 人形, OpenAI 合作
- **1X NEO, Agility Digit**: 多种形态

### 2. 仿真中的具身 Embodied in Simulation

**仿真器 Simulators**:
- **Habitat (Facebook 2019)**: 室内导航
- **Isaac Sim (NVIDIA)**: 物理仿真
- **MuJoCo**: 机器人仿真
- **ANCOR**: 工业环境

**意义**: 仿真比物理机器人**便宜 1000×**.

### 3. 视觉-语言-动作模型 Vision-Language-Action (VLA)

**代表 Representative**:
- **Google RT-2 (2023)**: VLM + 机器人动作
- **Google PaLM-E (2023)**: 562B 多模态具身
- **Octo (2024)**: 开源 VLA
- **OpenVLA**: 开源通用 VLA

**架构**:
```
[图像 + 语言] → [VLM] → [机器人动作]
```

**训练**: 大规模机器人数据集 + 互联网数据.

### 4. 视频预测作为世界模型

**代表 Representative**:
- **Sora (OpenAI 2024)**: 视频生成 = 隐式世界模型
- **Google Genie (2024)**: 可玩游戏的世界模型
- **DeepMind Genie 2 (2024)**: 3D 世界模型

**意义**: 视频是**自然的世界知识来源**.物理常识、运动规律、物体交互都在视频中.

## 具身 AI 的挑战 / Challenges

### 1. Sim-to-Real Gap

**问题**: 仿真中的 AI, 在真实世界**失败**(物理细节、噪声、不确定性).

**解决**:
- 域随机化 Domain Randomization
- 系统识别 System Identification
- Sim-Real 联合训练

### 2. 数据稀缺 Data Scarcity

**问题**: 文本数据万亿, 机器人数据百万.差 1000×.

**解决**:
- 仿真生成
- 共享数据集(Open X-Embodiment)
- 遥操作 Teleoperation

### 3. 样本效率 Sample Efficiency

**问题**: 真实机器人训练**慢**(每次操作 1 秒), 不能像 LLM 那样并行.

**解决**:
- 离线 RL
- 模仿学习
- 世界模型内训练

### 4. 安全性 Safety

**问题**: 机器人**可能伤人**.

**解决**:
- 力限制
- 远程操作
- 安全约束 RL

### 5. 形态选择 Morphology

**问题**: 应该做**人形** 还是**专用**?

**人形派 Humanoid Camp**:
- 适应人类环境(楼梯、工具)
- 数据收集容易(动作捕捉)
- **Figure, Tesla, Boston Dynamics(新版)**

**专用派 Specialized Camp**:
- 效率高
- 简单
- **扫地机器人, 机械臂, 仓储机器人**

**主流共识**: **两种都有价值**.人形适合通用任务, 专用适合重复任务.

## 主要研究者 / Key Researchers

### Rodney Brooks

见上文.**行为机器人学之父**.

### Pieter Abbeel (UC Berkeley)

**贡献**: RL for robotics, 模仿学习.

**创业**: Covariant(仓储机器人).

### Sergey Levine (UC Berkeley)

**贡献**: 深度 RL for robotics, Offline RL.

**视频课程**: CS285 (Deep RL) 公开.

### Chelsea Finn (Stanford)

**贡献**: Meta-learning, 模仿学习, 视觉 RL.

### Stefan Schaal (USC)

**贡献**: 机器人神经科学, 生物启发机器人.

### Dennis Hong (UCLA)

**贡献**: 人形机器人设计.

## 具身 AI 公司 / Embodied AI Companies

### 1. 人形机器人

- **Figure AI** (2022-): OpenAI, Microsoft 投资
- **1X** (Norway): OpenAI 投资
- **Tesla Optimus**: Tesla 内部
- **Agility Robotics** (Digit): 仓储
- **Apptronik** (Apollo): NASA 合作
- **Boston Dynamics** (Atlas 电动版): 现代
- **Sanctuary AI** (Phoenix): 加拿大
- **UBTECH**: 中国

### 2. 通用机器人 Brain

- **Skild AI** (2024): 机器人基础模型
- **Physical Intelligence** (2024): 通用机器人策略
- **Covariant**: 仓储 AI

### 3. 仿真平台

- **NVIDIA Isaac**: 高物理仿真
- **Google DeepMind MuJoCo**
- **Habitat**

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 缺 grounding, 具身 AI 补足**
   LLM 知道"苹果"的字面意思, 不知道苹果的物理经验.机器人**通过身体** 补足.
   > LLMs lack grounding; embodied AI fills the gap.

2. **LLM + 机器人 = 新范式**
   Figure 01 + OpenAI: 机器人听语言, 执行任务.**ChatGPT 的"身体"**.
   > Figure 01 + OpenAI: ChatGPT with a body.

3. **VLA 模型是 LLM 的扩展**
   Vision-Language-Action 模型把 LLM 扩展到**动作输出**.下一代 GPT 可能就是 VLA.
   > VLA extends LLMs to action output. Next GPT may be VLA.

4. **范式思考**: 具身 AI 是 AGI 的必要条件吗?
   **Brooks 主张**: 是.没有身体, 没有 grounding, 没有真智能.
   
   **Hinton/LeCun 主张**: 不一定.**计算层面**, 视频等"虚拟具身" 也可能足够.
   
   **主流预判**: **物理具身** 对**某些任务**重要(机器人、操作), 但**不是 AGI 必需**(LLM 已经能做很多).
   
   **真正答案**: 未知.可能需要 10-20 年见分晓.
   > Brooks: yes, body necessary. Hinton/LeCun: not necessarily (video as virtual embodiment). Open question for 10-20 years.

## 关键问题 / Questions

1. Searle 的中文屋论证对 LLM 成立吗? / Does Searle's Chinese Room apply to LLMs?
2. 仿真训练的 AI 能真正"接地"吗? / Can sim-trained AI truly "ground"?
3. 人形机器人 vs 专用机器人, 哪个会先普及? / Humanoid vs specialized: which scales first?
4. VLA 模型会取代 LLM 吗? / Will VLA replace LLM?

## 推荐资源 / Resources

- 书 / Book: Brooks (2002) *Flesh and Machines*
- 书 / Book: Varela, Thompson, Rosch (1991) *The Embodied Mind*
- 书 / Book: Andy Clark *Being There* / *Supersizing the Mind*
- 论文 / Paper: Brooks (1991) *Intelligence Without Representation*
- 论文 / Paper: Harnad (1990) *The Symbol Grounding Problem*
- 论文 / Paper: Brohan et al. (2023) *RT-2: Vision-Language-Action Models*
- 视频 / Video: **Boston Dynamics Atlas Demos**
- 视频 / Video: **Figure 01 + OpenAI Demo (2024)**
- 课程 / Course: **Berkeley CS287 Robotics**

---

参见 / See also: [[neuro-symbolic]], [[world-models]], [[friston-active-inference]]
