---
title: Transformer 架构 · The Transformer Architecture
type: concept
phase: 7
tags: [transformer, attention, vaswani, positional-encoding, llm]
created: 2026-07-21
language: zh-CN
---

# Transformer 架构 · The Transformer Architecture

> **学习目标 / Learning Objectives**
> - 精确理解自注意力机制的数学和直觉 / Precisely understand self-attention (math and intuition)
> - 看到 2017《Attention Is All You Need》的历史偶然性 / See the 2017 paper's historical contingency
> - 理解 Transformer 的根本局限与未来替代 / Understand Transformer's limits and future alternatives

## 论文起源 / Paper Origin

**Vaswani et al. 2017** *Attention Is All You Need* (NeurIPS 2017, Google Brain + Toronto).

**最初目的 Original goal**: 翻译任务(Google Translate).论文 8 页,被拒绝于 ICLR 2018 但成为**有史以来最有影响的 AI 论文之一**(>150,000 引用).

**团队背景 Team background**:
- Noam Shazeer (后来_character.ai, 2025 回 Google)
- Ashish Vaswani (主作者)
- Niki Parmar (后来 Adept)
- Llion Jones (后来 Sakana AI)
- Jakob Uszkoreit (后来 Inceptive)
- Aidan Gomez (后来 Cohere)
- Łukasz Kaiser
- Illia Polosukhin (后来 NEAR Protocol)

**8 位作者离开了 Google**, 创办了一系列重要 AI 公司.**Transformer 的发明催生了整个 AI 创业生态**.

## 前置: Attention 的演化 / Pre-History: Attention's Evolution

### Bahdanau Attention (2014)

**Bahdanau, Cho, Bengio 2014**: 在 seq2seq 翻译中,让解码器**对齐**到输入的不同位置.

**问题 Problem**: 之前的 seq2seq 把整个输入压缩为一个**固定长度向量**,信息丢失.

**解决 Solution**: 解码器每步"注意"输入的不同部分,加权聚合.

```
attention_weight = softmax(score(decoder_hidden, encoder_hiddens))
context = Σ attention_weight · encoder_hiddens
```

### Luong Attention (2015)

**Luong et al. 2015**: 简化 Bahdanau,提出**点积注意力 dot-product attention**.

```
score(h_dec, h_enc) = h_dec · h_enc
```

**意义**: 点积比加法高效,也更好用.

## Transformer 的核心创新 / Transformer's Core Innovations

### 创新 1: 自注意力 Self-Attention

**关键洞察 Key insight**: 不需要 encoder-decoder attention.**每个位置直接看所有位置**.

**自注意力公式 Self-attention formula**:
```
Attention(Q, K, V) = softmax(QK^T / √d_k) · V
```

其中:
- **Q (Query)**: 查询矩阵,询问"我要找什么"
- **K (Key)**: 键矩阵,描述"我是什么"
- **V (Value)**: 值矩阵,描述"如果选我,返回什么"

**直觉 Intuition**: 每个位置发布 Q,与所有位置的 K 比较(点积),用 softmax 得权重,加权聚合 V.

```
Token 1: Q₁  ↔ K₁, K₂, ..., K_n   →  V_1, V_2, ..., V_n → softmax → V_new_1
Token 2: Q₂  ↔ K₁, K₂, ..., K_n   →  V_1, V_2, ..., V_n → softmax → V_new_2
...
```

### 创新 2: 多头注意力 Multi-Head Attention

**问题 Problem**: 单头注意力只能学一种关系.

**解决 Solution**: 用 h 个独立注意力(头),每个学不同模式.

```
MultiHead(Q, K, V) = Concat(head_1, ..., head_h) · W_O
where head_i = Attention(Q W_Q^i, K W_K^i, V W_V^i)
```

**例**: 一个头看语法(主-谓),一个头看共指(他 → John),一个头看语义相似.

### 创新 3: 完全并行 Fully Parallel

**RNN 问题 RNN problem**: 必须串行处理(t_1 → t_2 → ... → t_n).
**Transformer**: 所有位置**同时**计算自注意力.

**意义**: GPU 友好,训练速度提升 **5-10×**.

### 创新 4: 位置编码 Positional Encoding

**问题 Problem**: 自注意力本身**没有顺序信息**——它对位置无关.

**解决 Solution**: 把位置信息**加**到嵌入上.

**原始 Original**: 正弦/余弦位置编码
```
PE(pos, 2i) = sin(pos / 10000^(2i/d))
PE(pos, 2i+1) = cos(pos / 10000^(2i/d))
```

**现代 Modern**:
- **Learned PE** (BERT): 学习的嵌入
- **RoPE** (Rotary Position Embedding, 2021): 旋转位置编码,用于 LLaMA/GPT-NeoX
- **ALiBi** (2022): Attention with Linear Biases,无位置嵌入

### 创新 5: 残差 + LayerNorm

**架构**: 每个子层(sublayer)被 wrap 为:
```
output = LayerNorm(x + Sublayer(x))
```

**意义**: 缓解梯度问题,允许训练深网络.

**现代变种 Modern variant**: Pre-LN(把 LayerNorm 放前面),更稳定,用于多数大 LLM.

## Transformer 完整架构 / Full Transformer Architecture

### 编码器-解码器 Encoder-Decoder (原始)

```
输入 Embedded Inputs
        ↓
[Multi-Head Self-Attention]   ← Encoder
        ↓
[Feed Forward]
        ↓ × N (6 层)
编码器输出 Encoder Output
        ↓
[Masked Multi-Head Self-Attention]   ← Decoder
        ↓
[Multi-Head Cross-Attention]   ← 看编码器输出
        ↓
[Feed Forward]
        ↓ × N (6 层)
输出 Output
```

### 编码器 vs 解码器

| 类型 Type | 代表 Example | 用途 Use |
|----|----|----|
| **Encoder-only** | BERT, RoBERTa | 理解(分类、NER、嵌入) |
| **Decoder-only** | GPT, LLaMA, Claude | 生成(对话、写作、代码) |
| **Encoder-Decoder** | T5, BART, 原始 Transformer | seq2seq(翻译、摘要) |

**事实 Fact**: 现代 LLM (GPT/Claude/Gemini) **几乎都是 decoder-only**.

## 复杂度分析 / Complexity Analysis

### 注意力的复杂度 Attention Complexity

```
QK^T: O(n² · d)  (n = 序列长度 sequence length, d = 模型维度)
softmax(QK^T) · V: O(n² · d)
总计 Total: O(n² · d)
```

**问题 Problem**: n 大时(长上下文),**n² 爆炸**.
- n=2048: 4M 个 attention weights
- n=128K: 16B 个 attention weights

**这就是为什么 LLM 长上下文特别贵**.

### 解决方案 Solutions (阶段 9 详谈)

| 方法 Method | 复杂度 Complexity | 代表 Example |
|----|----|----|
| Standard Attention | O(n²) | 原始 Transformer |
| Sparse Attention | O(n log n) | BigBird, Longformer |
| Linear Attention | O(n) | Performer, Linear Transformers |
| State Space Models | O(n) | Mamba, RWKV |
| Flash Attention | O(n²)(IO 优化) | 标准 + IO 优化 |

## 训练与推理 Training vs Inference

### 训练 Training

```
for batch in data:
    logits = model(batch.inputs)         # forward
    loss = cross_entropy(logits, batch.targets)
    loss.backward()                       # backprop
    optimizer.step()
```

**关键 Critical**: 训练时**所有 token 并行预测**(teacher forcing).

### 推理 Inference

```
生成 token_1, 然后 token_2, ..., 每次 forward 整个序列
```

**KV Cache 优化 KV Cache optimization**: 缓存历史 K, V,只计算新 token.**推理复杂度仍 O(n²),但常数小**.

## 为什么 Transformer 赢了 / Why Transformer Won

### 因素 1: 并行性 Parallelism

GPU 友好,RNN 无法做到.

### 因素 2: 长程依赖 Long-Range Dependencies

注意力让任意两位置**直接**交互(常数路径),RNN 需要 O(n) 路径.

### 因素 3: Scaling Laws

**2020 Kaplan et al.**: 模型/数据/计算量幂律.**Transformer 在大尺度上效率最好**.

### 因素 4: 通用性 Generality

不只是 NLP——图像(ViT)、视频(Video Transformer)、代码(Codex)、蛋白质(AlphaFold 2)、音频(Whisper).

### 因素 5: 生态

Hugging Face, PyTorch, TensorRT, vLLM.**所有人都在优化 Transformer**.

## Transformer 的局限 / Transformer's Limitations

### 局限 1: O(n²) 复杂度

长上下文瓶颈.解决: Flash Attention(临时)、Linear Attention/SMM(根本).

### 局限 2: 没有"真正"的推理

注意力是**软查找 soft lookup**.不能可靠执行多步算法(如大数乘法、长链推理).

### 局限 3: 幻觉 Hallucination

下一 token 预测**不保证事实正确**.这是范式本身的特性.

### 局限 4: 无世界模型

LeCun 批判: Transformer 学到的是**统计规律**,不是**因果世界模型**.详见阶段 9 [[lecun-jepa]].

### 局限 5: 数据效率低 Sample Inefficiency

学语言需 **万亿 token**.人类儿童只需 **几亿词**.差 10000 倍.

### 局限 6: 无持续学习 Continual Learning

学新数据会**忘掉**旧数据.必须重训.

## 未来替代 / Future Alternatives

### 1. 状态空间模型 State Space Models (SSM)

**Mamba** (Gu & Dao 2023), **RWKV**: RNN 思想 + 选择性 + 并行训练.

**优点**: O(n) 推理, 长程好.
**缺点**: 不如 Transformer 通用,小尺度效果差.

### 2. 混合架构 Hybrid

**Jamba** (2024), **Zamba**: Transformer 层 + Mamba 层交替.

### 3. 稀疏专家 Sparse MoE

**Mistral Mixtral**: 8 个专家中激活 2 个.**等效扩展**模型容量,不变推理成本.

### 4. JEPA (LeCun)

放弃 token 级生成,在**抽象表示空间**预测.见阶段 9 [[lecun-jepa]].

### 5. 神经符号 Neuro-Symbolic

Transformer + 符号推理引擎.结合连接主义和符号主义优势.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM = Transformer + 大数据 + 大算力**
   Transformer **不是唯一**,但它是**当前**最有效的架构.所有 GPT/Claude/Gemini/LLaMA 都是 Transformer.
   > LLM = Transformer + big data + big compute. Currently most effective, not unique.

2. **Transformer 不是终局 Transformer Is Not Final**
   - **历史角度 Historical**: Transformer 也是过渡.之前是 RNN, 之后可能是 SSM/JEPA.
   - **理论角度 Theoretical**: O(n²) 不符合大脑(大脑 O(n))
   - **实践角度 Practical**: 长上下文瓶颈迫使替代方案
   > Transformer is transitional. Before: RNN. After: SSM/JEPA maybe.

3. **为什么 LLM 一直用 Transformer?**
   **生态锁定 Ecosystem lock-in**: 硬件(TPU/GPU)、软件(CUDA/PyTorch)、模型(Hugging Face)都为 Transformer 优化.替代架构需要重新建立生态.
   > Transformer ecosystem lock-in. Alternatives need new ecosystem.

4. **范式思考**: 下一个"Transformer" 会是什么样?
   可能特征 Possible features:
   - **O(n) 复杂度**(像大脑)
   - **有世界模型**(超越统计)
   - **持续学习**(不需重训)
   - **生物 plausible**(神经科学启发)
   
   候选: Mamba, JEPA, 神经符号, 脉冲神经网络, 量子神经网络.
   > Next "Transformer" might be: O(n), world model, continual learning, bio-plausible. Candidates: Mamba, JEPA, neuro-symbolic, SNN, QNN.

## 关键问题 / Questions

1. 自注意力的 O(n²) 是"必须"还是"可以避免"? / Is self-attention's O(n²) necessary or avoidable?
2. 为什么 Transformer 在所有模态(文本、图像、蛋白质)都有效? / Why does Transformer work across modalities?
3. Mamba 会取代 Transformer 吗? / Will Mamba replace Transformer?
4. 大脑有没有"注意力机制"? / Does the brain have "attention"?

## 推荐资源 / Resources

- 论文 / Paper: Vaswani et al. (2017) *Attention Is All You Need* (论文 + [annotated 版](https://nlp.seas.harvard.edu/2018/04/03/attention.html))
- 论文 / Paper: Kaplan et al. (2020) *Scaling Laws for Neural LMs*
- 博客 / Blog: **Jay Alammar "The Illustrated Transformer"** — 标准入门 / Standard introduction
- 博客 / Blog: **Lilian Weng "Transformer Family"**
- 视频 / Video: **3Blue1Brown "But what is a GPT?"** 系列
- 代码 / Code: **Karpathy "nanoGPT"** — 300 行 Python 实现 GPT / 300-line GPT

---

参见 / See also: [[backpropagation]], [[deep-learning-winter]], [[p-vs-np]], [[classic-algorithms]]
