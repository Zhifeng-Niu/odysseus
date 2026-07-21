---
title: 大 O 表示法 · Big-O Notation
type: concept
phase: 5
tags: [big-o, complexity, asymptotic]
created: 2026-07-21
language: zh-CN
---

# 大 O 表示法 · Big-O Notation

> **学习目标 / Learning Objectives**
> - 理解渐近分析的数学定义 / Understand asymptotic analysis's math
> - 掌握常见复杂度类及其实际含义 / Master common complexity classes
> - 看到 LLM 的复杂度分析为什么极其重要 / See why LLM complexity analysis matters

## 大 O 的定义 / Definition

**大 O Big-O**: 函数 f(n) = O(g(n)) 当且仅当存在常数 c > 0 和 n₀,使得对所有 n ≥ n₀, 有 f(n) ≤ c · g(n).

> **Big-O**: f(n) = O(g(n)) iff exists constants c > 0 and n₀ such that for all n ≥ n₀, f(n) ≤ c · g(n).

**直觉 Intuition**: 当 n 很大时,f(n) 增长得**不超过** g(n) 的常数倍. 描述**上界**.

> **Intuition**: for large n, f grows **no faster than** constant multiple of g. Describes **upper bound**.

## 常见复杂度类 Common Complexity Classes

```
复杂度 Complexity   | 名字 Name          | n=10    | n=100    | n=1000
O(1)              | 常数 constant       | 1       | 1        | 1
O(log n)          | 对数 logarithmic    | 3       | 7        | 10
O(n)              | 线性 linear         | 10      | 100      | 1000
O(n log n)        | 线性对数 linearithmic| 33     | 664      | 9966
O(n²)             | 平方 quadratic      | 100     | 10000    | 10⁶
O(n³)             | 立方 cubic          | 1000    | 10⁶      | 10⁹
O(2ⁿ)             | 指数 exponential    | 1024    | 10³⁰     | 10³⁰¹
O(n!)             | 阶乘 factorial      | 3628800 | ∞        | ∞
```

**关键观察 Key observation**: 多项式复杂度 (O(n^k) for any constant k) **渐近远好于** 指数复杂度 (O(2^n)). 这就是 P vs NP 问题的核心.

> **Key observation**: polynomial complexity (O(n^k)) is **asymptotically far better than** exponential (O(2^n)). Core of P vs NP.

## 渐近符号 / Asymptotic Notations

| 符号 Notation | 含义 Meaning |
|-----------|-----------|
| O(g(n))   | 上界 upper bound |
| Ω(g(n))   | 下界 lower bound |
| Θ(g(n))   | 精确界 tight bound (上下都成立) |
| o(g(n))   | 严格上界 strict upper |
| ω(g(n))   | 严格下界 strict lower |

## 复杂度分析示例 / Complexity Analysis Examples

### 示例 1: 简单循环

```python
def sum_array(arr):
    total = 0                # O(1)
    for x in arr:            # O(n) iterations
        total += x           # O(1) per iteration
    return total
# Total: O(n)
```

### 示例 2: 嵌套循环

```python
def bubble_sort(arr):
    for i in range(len(arr)):          # O(n)
        for j in range(len(arr)-1):    # O(n)
            if arr[j] > arr[j+1]:
                arr[j], arr[j+1] = arr[j+1], arr[j]
# Total: O(n²)
```

### 示例 3: 二分查找

```python
def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:                    # 每次 n 减半
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
# Total: O(log n)
```

### 示例 4: 递归(主定理)

```python
def merge_sort(arr):
    if len(arr) <= 1: return arr
    mid = len(arr) // 2
    left = merge_sort(arr[:mid])     # T(n/2)
    right = merge_sort(arr[mid:])    # T(n/2)
    return merge(left, right)        # O(n)
# T(n) = 2T(n/2) + O(n)
# By Master Theorem: T(n) = O(n log n)
```

**主定理 Master Theorem**: T(n) = aT(n/b) + f(n) 的解 / Solution:

```
若 f(n) = O(n^c):
  c < log_b(a):  T(n) = O(n^(log_b(a)))
  c = log_b(a):  T(n) = O(n^c · log n)
  c > log_b(a):  T(n) = O(f(n))
```

## 空间复杂度 / Space Complexity

类似时间复杂度,但衡量内存使用. / Like time complexity, but measures memory.

**关键 Critical**: 递归算法的栈空间也算.

```python
def recursive_sum(n):
    if n == 0: return 0
    return n + recursive_sum(n - 1)
# 时间 O(n), 空间 O(n) (递归栈)
```

## 均摊分析 Amortized Analysis

某些操作偶尔很慢,但均摊下来快. / Some operations occasionally slow, but amortized fast.

**例 / Example**: 动态数组 (vector) 的 append.

- 大多数时候 O(1) 直接加
- 容量满时,需要 O(n) 复制到新数组

**均摊 Amortized**: 每次操作 O(1).

## 与 LLM 的连接 / Connection to LLMs

1. **Transformer 自注意力的复杂度**
   ```
   输入 sequence length: n
   hidden dim: d
   
   Q, K, V 投影: O(n · d²)
   Q · K^T: O(n² · d)
   Softmax: O(n²)
   Attn · V: O(n² · d)
   
   总复杂度 total: O(n² · d)
   ```
   
   **n²** 这一项是长上下文的瓶颈. n=100K, 计算量比 n=10K 多 100 倍.

2. **推理 token 生成的复杂度**
   每生成一个 token, 要算 attention 过所有历史 tokens. 总推理长度 n, 总计算量 O(n²). 这就是为什么长对话越来越慢.

3. **优化方向**:
   - **Flash Attention**: 减少内存访问,IO 复杂度 O(n) → 但计算复杂度仍 O(n²)
   - **Sparse Attention**: 只关注部分 tokens, 计算复杂度 O(n log n) 或 O(n)
   - **Linear Attention**: 用核技巧近似 softmax, 计算复杂度 O(n)
   - **State Space Models** (Mamba, RWKV): RNN 思想, O(n) 推理

4. **范式思考**: 当前 LLM 是 O(n²) 算法. 大脑处理长序列也是 O(n²) 吗?
   人类能记住一生的事件 (~10⁹ 秒级时间步),如果 O(n²),应该需要 10¹⁸ 计算量. 但大脑功耗只有 20W. **大脑一定用了 O(n) 或更低**.
   > Current LLMs are O(n²). Is the brain O(n²) for long sequences?
   > Humans remember a lifetime (~10⁹ time steps). O(n²) would need 10¹⁸ compute. Brain uses only 20W. **The brain must be O(n) or better.**

## 关键问题 / Questions

1. O(n²) vs O(n log n),当 n = 10000 时,差多少倍? / O(n²) vs O(n log n), how many times for n=10000?
2. 为什么 O(1) 不一定是"最快"? / Why isn't O(1) necessarily "fastest"?
3. Flash Attention 为什么能加速,但不改变复杂度? / Why does Flash Attention speed up without changing complexity?
4. 大脑记忆是 O(n) 还是 O(n²)? 如何实验验证? / Brain memory: O(n) or O(n²)? How to verify?

## 推荐资源 / Resources

- 书 / Book: CLRS 第 3 章 / Chapter 3 (函数增长 / Growth of Functions)
- 网站 / Website: [Big-O Cheat Sheet](https://www.bigocheatsheet.com)
- 视频 / Video: *Back To Back SWE* YouTube — 复杂度分析 / Complexity analysis

---

参见 / See also: [[data-structures]], [[classic-algorithms]]
