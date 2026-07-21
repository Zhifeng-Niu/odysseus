---
title: 二进制与十六进制 · Binary & Hexadecimal
type: concept
phase: 2
tags: [binary, hexadecimal, number-system, information]
created: 2026-07-21
language: zh-CN
---

# 二进制与十六进制 · Binary & Hexadecimal

> **学习目标 / Learning Objectives**
> - 流畅在二进制、十进制、十六进制间转换 / Fluently convert between binary, decimal, hex
> - 理解为什么二进制是物理的必然,而非工程选择 / Understand why binary is a physical inevitability, not an engineering choice
> - 掌握二进制补码:为什么这样设计 / Master two's complement and why it's designed this way

> **关键术语 / Key Terms**
> - 二进制 Binary · 十进制 Decimal · 十六进制 Hexadecimal · 比特 Bit · 字节 Byte · 二进制补码 Two's complement · 基数 Radix / Base

## 为什么是二进制? / Why Binary?

### 物理的必然 / Physical Inevitability

考虑一个有 N 个状态的物理元件。我们要用它存储信息。问题是:N 越大越好吗?

> Consider a physical element with N states, used to store information. Is larger N better?

| 元件类型 Element | 状态数 N | 区分难度 Distinguishing difficulty |
|------------|--------|----------------------------|
| 开关 Switch | 2 (ON/OFF) | 极容易 Very easy |
| 三态元件 Ternary | 3 | 中等 Moderate |
| 十位元件 Decimal | 10 | 困难 Hard |
| 模拟 Analog | ∞ | 极困难(噪声) Very hard (noise) |

工程经验告诉我们:**区分 2 个状态最稳定**。任何电路都有:

> Engineering experience shows: **2 states is most robust**. Any circuit has:

- 噪声容限 Noise margin (允许的电压波动 allowed voltage variation)
- 制造容差 Manufacturing tolerance (工艺偏差 process variation)
- 温度漂移 Temperature drift

**基数为 2 让每个状态都有最大噪声容限**,这就是为什么全世界的计算机都是二进制。

> **Base 2 gives each state the maximum noise margin** — that's why all computers are binary.

### Shannon 的信息论证明 / Shannon's Information-Theoretic Argument

1948 年 Shannon 证明:对于固定可靠度的存储,**基数 e ≈ 2.718 最优**。但整数基中最接近 e 的是 3,然后是 2。

> In 1948, Shannon proved: for fixed reliability, **base e ≈ 2.718 is optimal**. Closest integer bases are 3, then 2.

- 三进制确实稍微更有效率(三进制表示一个数所需位数少 ~5%) / Ternary is slightly more efficient (~5% fewer digits)
- 但工程成本远高于 5% 的节省 → 工业界选了二进制 / But engineering cost far exceeds 5% savings → industry chose binary

**苏联 Setun 计算机 (1958)** 是唯一投入量产的三进制计算机。最终被二进制取代,因为:**二进制的工程优势压倒性**。

> **The Soviet Setun (1958)** was the only mass-produced ternary computer. Replaced by binary because: **binary's engineering advantage is overwhelming.**

## 二进制基础 / Binary Basics

### 位权展开 / Positional Notation

任何数 N 在基 b 下表示为 / Any number N in base b:

N = d_n · b^n + d_{n-1} · b^{n-1} + ... + d_1 · b^1 + d_0 · b^0

例:十进制 13 = 1·10¹ + 3·10⁰ = 10 + 3
例:二进制 1101 = 1·2³ + 1·2² + 0·2¹ + 1·2⁰ = 8 + 4 + 0 + 1 = **13**

### 必须记住的 2 的幂 / Must-Memorize Powers of 2

```
2⁰   = 1
2¹   = 2
2²   = 4
2³   = 8
2⁴   = 16
2⁵   = 32
2⁶   = 64
2⁷   = 128
2⁸   = 256
2⁹   = 512
2¹⁰  = 1024  (= 1 KB, 注意不是 1000 / note: not 1000)
2¹⁶  = 65536
2²⁰  = 1048576 (1 MB)
2³²  = 4294967296 (4 GB)
2⁶⁴  = 18446744073709551616 (16 EB)
```

这些数字会反复出现。LLM 的 token 上限、上下文窗口、参数数量、显存大小,全部都是 2 的幂。

> These numbers appear constantly. LLM token limits, context windows, parameter counts, VRAM sizes — all powers of 2.

## 十六进制:二进制的"压缩" / Hexadecimal: Binary's "Compression"

二进制适合机器,但人类读起来冗长。10011010 是十进制的 154,还是 9A?一眼看不清。

> Binary is good for machines, but verbose for humans. Is 10011010 decimal 154 or hex 9A? Hard to see.

**十六进制 (Hex) 是折中**: 1 个十六进制位精确对应 4 个二进制位。

> **Hex is the compromise**: 1 hex digit exactly corresponds to 4 binary digits.

```
二进制 Bin | 十进制 Dec | 十六进制 Hex
----------|---------|------------
   0000   |    0    |    0
   0001   |    1    |    1
   0010   |    2    |    2
   0011   |    3    |    3
   0100   |    4    |    4
   0101   |    5    |    5
   0110   |    6    |    6
   0111   |    7    |    7
   1000   |    8    |    8
   1001   |    9    |    9
   1010   |   10    |    A
   1011   |   11    |    B
   1100   |   12    |    C
   1101   |   13    |    D
   1110   |   14    |    E
   1111   |   15    |    F
```

例:`1010 1111 0011 1100` (二进制) = `AF3C` (十六进制) = **44,860** (十进制)

> 转换示例 / Conversion example:
> 1. 二进制转十六进制 Bin → Hex: 从右到左每 4 位一组,直接查表 / Group 4 bits from right, look up table
> 2. 十六进制转二进制 Hex → Bin: 每位直接展开为 4 位 / Expand each digit to 4 bits

### 在编程中的表示 / In Programming

- C / Java / Python: `0x` 前缀 → `0xAF3C` = 44860
- 汇编 Assembly: `$AF3C` 或 `0AF3Ch`
- HTML / CSS: `#AF3C00` (颜色 / color)

**约定**: 当你看到一串 0-9A-F,大概率是十六进制。当看到一串 0-1,大概率是二进制。

> **Convention**: A string of 0-9A-F is likely hex. A string of 0-1 is likely binary.

## 二进制补码:为什么这样设计? / Two's Complement: Why Designed This Way?

### 问题:计算机如何表示负数? / How Do Computers Represent Negatives?

候选方案 / Candidate schemes:

1. **符号-绝对值 Sign-Magnitude**: 最高位表符号,其余表绝对值 / Top bit = sign, rest = magnitude
   - +5 = `00000101`, -5 = `10000101`
   - 问题 / Problem: 0 有两种表示 (`00000000` 和 `10000000`),且加减法不统一 / Two zeros, addition/subtraction hardware diverges

2. **反码 Ones' Complement**: 正数不变,负数取反 / Negate by flipping bits
   - +5 = `00000101`, -5 = `11111010`
   - 问题 / Problem: 0 仍两种,加法有"循环进位" / Still two zeros, addition has "end-around carry"

3. **补码 Two's Complement** ✓: 正数不变,负数 = 取反 + 1 / Negate by flipping bits and adding 1
   - +5 = `00000101`, -5 = `11111011`
   - **关键性质 Key property**: 0 只有一种,加减法硬件统一(无需判断正负) / One zero, unified addition/subtraction hardware (no need to check sign)

### 补码的"魔法" / The "Magic" of Two's Complement

为什么"取反加 1"能表示负数? / Why does "flip bits + 1" represent a negative?

数学解释:8 位无符号最大值 = 255 = 2⁸ - 1。对任意数 x,-x 可以表示为 (2⁸ - x),但模 2⁸ 后等价于 (2⁸ - x)。

> Math explanation: 8-bit unsigned max = 255 = 2⁸ - 1. For any x, -x can be (2⁸ - x), mod 2⁸.

而 (2⁸ - x) 在 8 位下 = (~x + 1),因为 ~x 是 x 的反码 (= 255 - x)。

> And (2⁸ - x) mod 2⁸ = (~x + 1), because ~x = 255 - x.

**硬件收益 Hardware benefit**:

```
5 + (-5) = ?

  00000101  (+5)
+ 11111011  (-5 in 2's complement)
─────────
  00000000  (with carry out = 1, discarded)

→ 结果 = 0 ✓  没有任何特殊处理!Result = 0 ✓ with no special handling!
```

这意味着**同一套加法器电路**可以处理正数加、负数加、正负混合加。简化硬件 → 简化设计 → 降成本 → 提速。

> **Same adder hardware** handles positive+positive, negative+negative, mixed. Simpler hardware → simpler design → lower cost → faster.

### 取值范围 / Range

N 位补码取值范围 / N-bit two's complement range:

**-2^(N-1) 到 2^(N-1) - 1**

- 8 位: -128 到 +127
- 16 位: -32768 到 +32767
- 32 位: -2,147,483,648 到 +2,147,483,647
- 64 位: -9,223,372,036,854,775,808 到 +9,223,372,036,854,775,807

注意**负数比正数多 1 个**(因为 0 占用了正数的一个名额)。

> Note **one more negative than positive** (because 0 takes a positive slot).

## 二进制运算 / Binary Operations

### 加法: 与十进制完全一样,只是基为 2 / Addition: Same as decimal, just base 2

```
  1 1   (进位 carries)
  0 1 1 0 1  (二进制 binary)
+ 0 0 1 1 1
─────────
  1 0 1 0 0  (结果 result)

逐位规则 rules:
  0+0=0, 0+1=1, 1+0=1, 1+1=10 (0 with carry)
```

### 减法: 通过补码转为加法 / Subtraction: Convert to Addition via Two's Complement

`a - b = a + (-b) = a + (~b + 1)`

### 位运算 / Bitwise Operations

这些运算在 AI 编程中无处不在。理解它们就是理解 GPU 如何加速 LLM。

> These operations are everywhere in AI programming. Understanding them = understanding how GPUs accelerate LLMs.

| 运算 Operation | C 语法 C syntax | 描述 Description | 示例 Example (a=1010, b=1100) |
|------------|-----------|-------------|----------------------|
| AND 与 | `a & b` | 对应位都为 1 才为 1 / Both 1 → 1 | `1010 & 1100 = 1000` |
| OR 或 | `a \| b` | 对应位任一为 1 即为 1 / Either 1 → 1 | `1010 \| 1100 = 1110` |
| XOR 异或 | `a ^ b` | 对应位不同为 1 / Different → 1 | `1010 ^ 1100 = 0110` |
| NOT 取反 | `~a` | 翻转所有位 / Flip all bits | `~1010 = ...11110101` |
| 左移 | `a << n` | 左移 n 位,右补 0 / Shift left n bits | `1010 << 2 = 101000` |
| 右移 | `a >> n` | 右移 n 位 / Shift right n bits | `1010 >> 2 = 10` |

**关键性质 Key properties**:

- `a << n` = `a · 2ⁿ` (左移 = 乘 2 的 n 次方 / Left shift = multiply by 2ⁿ)
- `a >> n` = `a / 2ⁿ` (右移 = 除 2 的 n 次方 / Right shift = divide by 2ⁿ)
- 乘除用位移实现,比通用乘法器快几十倍 → 编译器自动优化 / Multiply/divide via shifts is tens of times faster than general multipliers → compilers auto-optimize

### 与 AI 的连接:GPU 并行计算的基础 / AI Connection: GPU Parallel Computing Foundation

LLM 推理 99% 的运算都是**矩阵乘法 + 位运算**。GPU 把这些操作并行化到成千上万核心。

> 99% of LLM inference is **matrix multiply + bitwise ops**. GPUs parallelize these across thousands of cores.

- **乘法**: 通过位移 + 加法实现 → 这就是为什么硬件乘法器很复杂
- **量化 (Quantization)**: 把 FP16 (16 位浮点) 压缩为 INT8 (8 位整数),使用更少位 → 显存占用减半 → 推理速度翻倍
- **掩码 (Masking)**: 注意力机制中"忽略未来 token"通过位掩码实现 → 极快

## 关键问题 / Questions

1. 二进制 11011 + 1011 = ? 用 8 位补码表示。 / What is binary 11011 + 1011? Express in 8-bit two's complement.
2. 为什么 `-(-128) = -128` 在 8 位补码中? / Why does `-(-128) = -128` in 8-bit two's complement?
3. 给定 `0xDEADBEEF`,在 32 位大端机器上,字节顺序是怎样的? / For `0xDEADBEEF` on a 32-bit big-endian machine, what's the byte order?
4. 为什么 LLM 推理可以用 INT8 而精度损失很小? / Why can LLM inference use INT8 with little precision loss?

## 推荐资源 / Resources

- 工具 / Tool: **Binary Explorer** (网页小工具 / web tool) — 视觉化二进制 / Visualizes binary
- 书 / Book: *Code: The Hidden Language of Computer Hardware and Software* Petzold, 第 19-22 章 / Chapters 19-22
- 视频 / Video: *Ben Eater* YouTube 频道 — 二进制加法器实物讲解 / Binary adder on real hardware

---

参见 / See also: [[boolean-algebra]], [[logic-gates]]
