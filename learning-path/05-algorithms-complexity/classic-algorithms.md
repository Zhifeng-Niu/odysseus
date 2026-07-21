---
title: 经典算法 · Classic Algorithms
type: concept
phase: 5
tags: [algorithms, sorting, searching, graph, dynamic-programming]
created: 2026-07-21
language: zh-CN
---

# 经典算法 · Classic Algorithms

> **学习目标 / Learning Objectives**
> - 掌握排序、搜索、图、DP、贪心等经典算法范式 / Master classic algorithm paradigms
> - 理解每种范式的"思想内核" / Understand each paradigm's core idea
> - 看到 LLM 推理与传统算法的边界 / See the boundary between LLM reasoning and traditional algorithms

## 排序 Sorting

| 算法 | 平均 | 最坏 | 空间 | 稳定 |
|----|------|------|------|------|
| 冒泡 Bubble | O(n²) | O(n²) | O(1) | ✓ |
| 选择 Selection | O(n²) | O(n²) | O(1) | ✗ |
| 插入 Insertion | O(n²) | O(n²) | O(1) | ✓ |
| 归并 Merge | O(n log n) | O(n log n) | O(n) | ✓ |
| 快速 Quick | O(n log n) | O(n²) | O(log n) | ✗ |
| 堆 Heap | O(n log n) | O(n log n) | O(1) | ✗ |

**关键 Critical**: 
- 小数组(n<16): 插入排序最快(常数小)
- 大数组: 快排或归并
- 工业界混合用: Timsort (Python, Java) = 归并 + 插入

## 搜索 Searching

### 二分查找 Binary Search

有序数组中查找 O(log n).

```python
def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target: return mid
        elif arr[mid] < target: lo = mid + 1
        else: hi = mid - 1
    return -1
```

**关键 Critical**: 二分思想无处不在 —— 平衡 BST, 数学求根, 凸优化, LLM 中的温度调节.

### 图搜索 Graph Search

**BFS (广度优先 Breadth-First)**:
- 用队列 queue
- 找最短路径(无权图)

**DFS (深度优先 Depth-First)**:
- 用栈 / 递归
- 找连通分量、拓扑排序、检测环

**Dijkstra** (非负权最短路): 用优先队列, O((V+E) log V)

**A*** (启发式搜索): 加入启发函数,比 Dijkstra 快.

## 动态规划 Dynamic Programming (DP)

**思想 Idea**: 把复杂问题分解为重叠子问题,记忆子问题解,避免重复计算.

> **Idea**: decompose into overlapping subproblems, memoize solutions, avoid recomputation.

**两要素 Two requirements**:
1. **最优子结构 optimal substructure**: 整体最优 → 子问题最优
2. **重叠子问题 overlapping subproblems**: 同一子问题被多次计算

**经典问题 Classic problems**:
- 斐波那契 Fibonacci
- 最长公共子序列 LCS
- 编辑距离 Edit Distance
- 0-1 背包 0-1 Knapsack
- 矩阵链乘法 Matrix Chain
- 最长递增子序列 LIS

**实现 Implementation**:
- 自顶向下 top-down: 递归 + memo
- 自底向上 bottom-up: 迭代填表

## 贪心 Greedy

**思想 Idea**: 每步选当前最优,不回溯.

> **Idea**: at each step pick current best, no backtracking.

**适用 Applicable when**: 问题有"贪心选择性质"(局部最优 → 全局最优).

**经典 Classic**:
- 活动选择 Activity Selection
- Huffman 编码 Huffman Coding
- Dijkstra 最短路
- 最小生成树 MST (Kruskal, Prim)

**关键 Critical**: 贪心不总是正确. 需要数学证明.

## 分治 Divide & Conquer

**思想 Idea**: 拆为独立子问题 → 递归求解 → 合并.

> **Idea**: split into independent subproblems → recurse → merge.

**经典 Classic**:
- 归并排序 Merge Sort
- 快速排序 Quick Sort
- 二分查找 Binary Search
- Strassen 矩阵乘法

## 回溯 Backtracking

**思想 Idea**: 系统枚举所有可能,失败时回退.

> **Idea**: systematically enumerate possibilities, backtrack on failure.

**经典 Classic**:
- 八皇后 N-Queens
- 数独 Sudoku
- 全排列 Permutations
- 子集 Subsets

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 能"做"算法题,但本质是模式匹配**
   LLM 见过大量 LeetCode,常见题答得很好. 但**没见过的**算法题,LLM 经常出错. 因为它没有真正的算法思维,只有模式匹配.
   > LLMs see many LeetCode problems, do well on common ones. But **unseen** algorithm problems often fail. No real algorithmic thinking, only pattern matching.

2. **O(n²) 的 Transformer 不能直接做 O(n) 的算法**
   你问 LLM "用 O(n) 算法求数组最大值",它写出代码. 但**它自己在算时是 O(n²)** —— 因为 attention 本身是 O(n²). 它"描述"O(n) 算法,自己却不是 O(n).
   > Asking LLM for "O(n) max of array" produces correct code. But **its own computation is O(n²)** — attention itself is O(n²). It "describes" O(n) but isn't.

3. **AlphaCode / LLM 编程竞赛**
   高水平算法题 LLM 仍困难. 因为这些题需要**真正的算法创新**,而非记忆.
   > High-level algorithmic problems remain hard. These require **genuine algorithmic innovation**, not memory.

4. **范式思考**: 大脑如何"算"?
   你心算 247 × 13,大脑用什么算法? **不是经典算法** —— 是基于记忆、估算、模式. 这暗示大脑不靠经典算法做计算.
   > How does the brain "compute" 247 × 13 mentally? **Not classic algorithms** — memory, estimation, pattern. This suggests the brain doesn't compute via classic algorithms.

## 关键问题 / Questions

1. 为什么快速排序平均快但最坏慢? 实际如何避免最坏? / Why is quicksort fast on average but slow at worst? How to avoid worst in practice?
2. Dijkstra 为什么不能处理负权? / Why can't Dijkstra handle negative edges?
3. DP 和贪心的本质区别? / Essential difference between DP and greedy?
4. 如果让你设计 LLM 算法题评测,如何区分"真懂" vs "见过"? / Designing LLM algorithm benchmarks: how to distinguish "true understanding" vs "memorized"?

## 推荐资源 / Resources

- 书 / Book: CLRS (第 II-IV 部分 / Parts II-IV)
- 书 / Book: *Algorithm Design Manual* Skiena
- 平台 / Platform: **LeetCode** + **Codeforces** — 实战 / Practice
- 课程 / Course: **MIT 6.006** + **6.046**

---

参见 / See also: [[data-structures]], [[p-vs-np]]
