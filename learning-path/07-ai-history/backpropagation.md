---
title: 反向传播算法 · Backpropagation
type: concept
phase: 7
tags: [backprop, gradient-descent, deep-learning, chain-rule]
created: 2026-07-21
language: zh-CN
---

# 反向传播算法 · Backpropagation

> **学习目标 / Learning Objectives**
> - 从链式法则推导反向传播算法 / Derive backprop from chain rule
> - 理解反向传播为什么是深度学习的"发动机" / Understand why backprop is deep learning's "engine"
> - 看到反向传播的局限与未来替代方向 / See backprop's limitations and future alternatives

## 反向传播的核心 / The Core

**反向传播 Backpropagation** 是用**链式法则**高效计算神经网络梯度的算法.

**重要性 Importance**: 没有反向传播,深度学习就不可能.所有现代深度学习(LLM、CNN、Diffusion)都靠它训练.

## 链式法则 Chain Rule

### 单变量 Single Variable

若 y = f(g(x)),则:
```
dy/dx = (df/dg) · (dg/dx)
```

### 多变量 Multivariate

若 z = f(y₁, y₂, ..., yₙ),yᵢ = gᵢ(x),则:
```
∂z/∂x = Σᵢ (∂f/∂yᵢ) · (∂yᵢ/∂x)
```

## 神经网络的反向传播 / Backprop in Neural Networks

### 神经网络作为函数复合 NN as Function Composition

一个 L 层 MLP:
```
y = f_L(f_(L-1)(... (f_1(x)) ...))
```

每层 f_l 输出 a_l,激活前 z_l = W_l · a_(l-1) + b_l.

### 损失函数 Loss Function

```
L = Loss(y, y_true)
```

例 Examples:
- 回归 regression: MSE L = (1/2)||y - y_true||²
- 分类 classification: Cross-entropy L = -Σ y_true · log y

### 目标 Goal

计算 ∂L/∂W_l 和 ∂L/∂b_l for 所有层 l,然后用**梯度下降 gradient descent**更新.

### 反向传播算法 Backprop Algorithm

**初始化**: δ_L = ∂L/∂a_L (损失对输出的梯度)

**反向 pass Backward pass** (从 L 到 1):
```
对 l = L, L-1, ..., 1:
    δ_l = (W_{l+1}^T · δ_{l+1}) ⊙ σ'(z_l)
    ∂L/∂W_l = δ_l · a_{l-1}^T
    ∂L/∂b_l = δ_l
```

**计算复杂度 Complexity**: 一次 forward + 一次 backward ≈ 2× forward 的成本.

**关键 Key**: 一次 backward 计算**所有**参数的梯度.若分别计算,复杂度会**指数爆炸**.

## 历史争议 History & Controversy

### 谁发明了反向传播?

| 时间 Year | 人物 Person | 贡献 Contribution |
|----|----|----|
| 1960s | Henry Kelley | 控制论中类似算法 |
| 1970 | Seppo Linnainmaa | 反向模式自动微分 |
| **1974** | **Paul Werbos** | **博士论文中明确用于神经网络** |
| 1986 | Rumelhart, Hinton, Williams | *Nature* 论文,使反向传播流行 |

**主流共识 Mainstream consensus**: **Paul Werbos 1974** 发明反向传播用于神经网络; **Rumelhart-Hinton-Williams 1986** 推广.

### 为什么 1974 没流行?

**原因 Reasons**:
1. 1970s 神经网络处于 Minsky-Papert 批判后的低潮
2. 硬件太慢,无法训练大网络
3. 没有大数据集
4. 没有非线性的好激活函数(梯度消失)

**1986 后流行 Popularity after 1986**:
1. *Nature* 是顶级期刊,影响力大
2. PDP 两卷书提供了框架
3. 硬件(尤其 GPU 萌芽)开始可用
4. MNIST 等数据集出现

## 梯度问题 Gradient Problems

### 梯度消失 Vanishing Gradient

**问题**: Sigmoid/tanh 激活函数的导数 ≤ 0.25,深度网络中梯度**指数衰减**.

**数学 Math**: δ_1 ∝ ∏(W_l · σ'(z_l)).若 |W_l · σ'(z_l)| < 1 在所有 l 上,δ_1 → 0.

**后果**: 深层网络的前几层**学不到**.

### 梯度爆炸 Exploding Gradient

**问题**: 若 |W_l · σ'(z_l)| > 1,梯度**指数增长**.

**后果**: 训练发散,权重变 NaN.

### 解决方案 Solutions

| 方案 Solution | 思想 Idea | 代表 |
|----|----|----|
| **ReLU** (2010)** | f(x) = max(0, x),导数 0 或 1 | AlexNet |
| **LSTM** (1997) | 门控机制,选择性记忆 | Hochreiter-Schmidhuber |
| **残差连接 Residual** (2015) | skip connection 直接传梯度 | ResNet |
| **层归一化 LayerNorm** (2016) | 标准化激活 | Transformer |
| **梯度剪裁 Gradient Clipping** | 限制梯度大小 | 通用 |

**核心洞察 Key insight**: ResNet (He et al. 2015) 的"恒等映射 identity mapping" 让梯度**无损**地传到任意深度.**这是 Transformer 出现的关键预备技术之一**.

## 优化器 Optimizers

### SGD (Stochastic Gradient Descent)

```
θ ← θ - η · ∇L
```

**优点**: 简单,理论保证.
**缺点**: 学习率难调,卡在局部最小.

### Momentum (1964)

```
v ← β·v + ∇L
θ ← θ - η·v
```

像"惯性",加速收敛,减少振荡.

### Adam (2014)

**Adaptive Moment Estimation**: Momentum + RMSProp 结合.

```
m ← β₁·m + (1-β₁)·∇L    (一阶矩 first moment)
v ← β₂·v + (1-β₂)·(∇L)²  (二阶矩 second moment)
m̂ = m / (1-β₁ᵗ)          (偏差修正 bias correction)
v̂ = v / (1-β₂ᵗ)
θ ← θ - η · m̂ / (√v̂ + ε)
```

**事实 Fact**: LLM 训练几乎都用 Adam 或 AdamW (Adam + weight decay).

## 现代反向传播的扩展 / Modern Extensions

### 自动微分 Automatic Differentiation

**PyTorch/TensorFlow/JAX** 都基于**自动微分**:
- 用户只需写 forward pass
- 系统自动构造计算图
- 自动应用反向传播

**深度学习框架 = 自动微分 + GPU 加速 + 模型库**.

### 分布式训练 Distributed Training

**数据并行 data parallel**: 不同 GPU 处理不同 batch,梯度同步.
**模型并行 model parallel**: 不同 GPU 处理不同参数.
**流水线并行 pipeline parallel**: 不同层在不同 GPU.

**LLM 训练用 3D 并行**(三者组合).

### 混合精度 Mixed Precision

用 FP16/BF16 算 forward/backward,用 FP32 累加.**2-3× 加速**,内存减半.

## 反向传播的局限与未来 / Limitations & Future

### 局限 1: 大脑不这样学习

**神经科学发现 Neuroscience finding**: 大脑的突触学习**不遵循**反向传播的精确规则.可能是**脉冲时序依赖可塑性 STDP** 或**预测编码 predictive coding**.

**问题 Question**: 如果大脑不靠反向传播达到智能,**有没有更好的算法?**

### 局限 2: 灾难性遗忘 Catastrophic Forgetting

神经网络学新任务会**忘掉**旧任务.大脑不会.

**解决方向**: 弹性权重合并 EWC、经验回放 replay.

### 局限 3: 数据效率低 Sample Efficiency

LLM 需要看**万亿 token** 才能学会基本语法.人类儿童**只看几百万词**.差距 ~10000 倍.

**理论分析 Theoretical analysis**: 可能反向传播**本身**数据效率低,需要新算法.

### 未来方向 Future Directions

1. **预测编码 Predictive Coding** (Rao & Ballard 1999, Friston 2010)
   每层预测下一层,误差反向.**与反向传播兼容**,但**神经科学上更可信**.

2. **Hebbian + 反馈对齐 Feedback Alignment** (Lillicrap 2016)
   反向传播需要精确 W^T,反馈对齐用随机矩阵.大脑可能这样做.

3. **前向-前向算法 Forward-Forward Algorithm** (Hinton 2022)
   Hinton 提议用两次 forward 替代 forward-backward,**更符合神经科学**.

4. **脉冲神经网络 Spiking Neural Networks (SNN)**
   更接近生物神经元.可能成为下一代 AI 硬件.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 训练 = 巨大反向传播**
   GPT-4 训练: ~1 万亿参数,~1 万亿 token.每次梯度更新涉及 ~1 万 GPU.**这是反向传播有史以来最大规模的应用**.
   > GPT-4 training: trillion params, trillion tokens. Largest backprop application in history.

2. **反向传播是 LLM 的"地基",但不是它的"思想"**
   反向传播让 LLM **可以训练**,但 LLM 的"语言能力"来自**Transformer 架构 + 数据规模**.反向传播是工具,不是本质.
   > Backprop enables LLM training; language ability comes from Transformer + scale.

3. **未来 AI 可能不需要反向传播**
   如果大脑不靠反向传播,那真正的 AGI 可能用更生物 plausible 的算法.这意味着当前 LLM 范式**可能是过渡**.
   > Brain may not use backprop. AGI may use more biologically plausible algorithms. Current LLM paradigm may be transitional.

4. **范式思考**: 反向传播是"范式锁定"的源头吗?
   从 1986 到 2024,**所有深度学习突破都基于反向传播**.这种"统一性"是力量(生态、硬件、理论),也是枷锁(替代算法无资源).
   > Backprop unifies 1986-2024 deep learning. Strength (ecosystem) and shackle (alternatives lack resources).

## 关键问题 / Questions

1. 反向传播和神经科学真实的学习机制差多远? / How far is backprop from neuroscience's learning mechanisms?
2. 如果反向传播不是最优,为什么它能驱动所有深度学习突破? / If backprop isn't optimal, why has it driven all breakthroughs?
3. Hinton 的前向-前向算法会取代反向传播吗? / Will Hinton's Forward-Forward replace backprop?
4. 大脑的"反向传播等价物"可能是什么? / What might be the brain's "backprop equivalent"?

## 推荐资源 / Resources

- 书 / Book: Goodfellow, Bengio, Courville *Deep Learning* 第 6 章 / Chapter 6
- 论文 / Paper: Rumelhart, Hinton, Williams (1986) *Learning representations by back-propagating errors*
- 论文 / Paper: He et al. (2015) *Deep Residual Learning* (ResNet)
- 视频 / Video: **3Blue1Brown "What is backpropagation really doing?"**
- 博客 / Blog: **Andrej Karpathy "Yes you should understand backprop"**

---

参见 / See also: [[connectionism]], [[deep-learning-winter]], [[transformer-architecture]]
