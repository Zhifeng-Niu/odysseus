---
title: 数据结构 · Data Structures
type: concept
phase: 5
tags: [data-structures, array, tree, hash-table, graph]
created: 2026-07-21
language: zh-CN
---

# 数据结构 · Data Structures

> **学习目标 / Learning Objectives**
> - 掌握 8 种核心数据结构及其复杂度 / Master 8 core data structures with complexities
> - 理解"数据结构 = 组织数据的方式 = 决定算法效率" / Understand "data structure = how to organize data = determines algorithm efficiency"
> - 看到 Transformer 的 QKV 矩阵本质是一种"动态数据结构"

## 8 大核心数据结构 / 8 Core Data Structures

### 1. 数组 Array

**特点**: 连续内存,O(1) 随机访问,O(n) 插入删除.

```c
int arr[5] = {1, 2, 3, 4, 5};
arr[2] = 10;  // O(1)
```

**用途 Use**: 缓存友好,适合顺序遍历. CPU 预取效果好.

### 2. 链表 Linked List

**特点**: 非连续内存,O(1) 插入删除(已知位置),O(n) 随机访问.

```
[1] → [2] → [3] → [4] → NULL
```

**变体 Variants**:
- 单链表 singly linked
- 双链表 doubly linked
- 循环链表 circular

**用途 Use**: 频繁插入删除,内存不连续.

### 3. 栈 Stack (LIFO)

**特点**: 后进先出 Last-In-First-Out. push/pop O(1).

```c
stack.push(1); stack.push(2); stack.push(3);
stack.pop();  // 3
stack.pop();  // 2
```

**用途 Use**:
- 函数调用栈
- 表达式求值
- 回溯算法 backtrack
- 撤销操作 undo

### 4. 队列 Queue (FIFO)

**特点**: 先进先出 First-In-First-Out. enqueue/dequeue O(1).

**变体 Variants**:
- 普通队列 queue
- 双端队列 deque
- 优先队列 priority queue (堆 heap 实现)

**用途 Use**:
- BFS 广度优先搜索
- 任务调度
- 缓冲区 buffer

### 5. 哈希表 Hash Table

**特点**: 平均 O(1) 查找/插入/删除. 最坏 O(n).

```python
hash_table = {}
hash_table["key"] = "value"
print(hash_table["key"])  # O(1) avg
```

**关键 Critical**:
- **哈希函数 hash function**: 把 key 映射到桶 bucket
- **冲突解决 collision resolution**: 链地址法 chaining, 开放地址法 open addressing
- **负载因子 load factor**: 元素数 / 桶数. 超过阈值时 rehash.

**用途 Use**: 字典、缓存、集合. Python dict、Java HashMap、Redis.

### 6. 树 Tree

**特点**: 层次结构,无环.

**变体 Variants**:
- **二叉树 binary tree**: 每节点最多 2 子
- **二叉搜索树 BST**: 左 < 根 < 右. 中序遍历有序.
- **平衡二叉树 balanced** (AVL, 红黑树): 保证 O(log n)
- **B 树 / B+ 树**: 数据库索引
- **字典树 Trie**: 字符串前缀

```
        8
       / \
      3   10
     / \    \
    1   6    14
       / \   /
      4   7 13
```

**用途 Use**:
- BST: 查找、排序
- 红黑树: Linux CFS 调度, C++ std::map
- B+ 树: 数据库索引(MySQL InnoDB)
- Trie: 自动补全、拼写检查

### 7. 堆 Heap

**特点**: 完全二叉树 + 堆性质(大顶堆: 父 ≥ 子).

```
        9
       / \
      7   8
     / \ / \
    3  5 6  4
```

**操作 Operations**: O(log n) 插入, O(1) 取顶, O(log n) 删除顶.

**用途 Use**:
- 优先队列 priority queue
- 堆排序 heapsort O(n log n)
- Top-K 问题
- Dijkstra 最短路

### 8. 图 Graph

**特点**: 顶点 vertex + 边 edge. 可有向/无向, 可带权.

**表示 Representation**:
- 邻接矩阵 adjacency matrix: O(V²) 空间, O(1) 查边
- 邻接表 adjacency list: O(V+E) 空间, O(degree) 查边

**算法 Algorithms**:
- BFS, DFS
- Dijkstra (最短路, 非负权)
- Bellman-Ford (最短路, 可负权)
- Floyd-Warshall (全对最短路)
- Kruskal / Prim (最小生成树)
- Topological Sort (拓扑排序, DAG)

**用途 Use**: 社交网络、地图路由、依赖管理.

## 复杂度速查表 Complexity Cheat Sheet

| 数据结构 | 查找 | 插入 | 删除 | 空间 |
|-------|------|------|------|------|
| 数组 | O(n) | O(n) | O(n) | O(n) |
| 有序数组 | O(log n) | O(n) | O(n) | O(n) |
| 链表 | O(n) | O(1)* | O(1)* | O(n) |
| 哈希表 | O(1) | O(1) | O(1) | O(n) |
| BST (平均) | O(log n) | O(log n) | O(log n) | O(n) |
| BST (最坏) | O(n) | O(n) | O(n) | O(n) |
| 平衡 BST | O(log n) | O(log n) | O(log n) | O(n) |
| 堆 | O(n) | O(log n) | O(log n) | O(n) |

*已知位置 / known position

## 与 LLM 的连接 / Connection to LLMs

1. **Transformer 的 QKV 矩阵 = 动态数据结构**
   Attention 本质是: 计算 Q · K^T,softmax 后乘 V. 这是**动态的、依赖内容的"软"哈希表**. 用 Q 查询 K,得到软权重,加权 V.
   > Attention: compute Q·K^T, softmax, multiply V. This is **dynamic, content-dependent "soft" hash table**. Query K with Q, get soft weights, weight V.

2. **KV Cache 是辅助数据结构**
   推理时缓存历史 K, V 张量,避免重算. 本质是**用空间换时间**,与所有缓存的思路一致.
   > KV Cache caches historical K,V tensors, avoiding recomputation. **Trade space for time**, same as all caches.

3. **向量数据库 = 高维最近邻数据结构**
   RAG 应用中,文档嵌入存入向量数据库(Pinecone, Milvus, FAISS). 用 **HNSW (Hierarchical Navigable Small World)** 或 **IVF-PQ** 加速近邻搜索. 这是为 LLM 设计的新数据结构.
   > Vector databases (Pinecone, Milvus, FAISS) store document embeddings. HNSW or IVF-PQ accelerate nearest neighbor search. New data structures designed for LLMs.

4. **Mixture of Experts (MoE) = 软路由树**
   MoE 模型把 FFN 替换为多个专家,用 gating network 选择激活哪些. 本质是**软决策树**. 这是用神经网络实现"路由数据结构"的尝试.
   > MoE replaces FFN with multiple experts, gating network selects which to activate. Essentially **soft decision tree**. Trying to implement "routing data structure" with neural networks.

## 关键问题 / Questions

1. 哈希表平均 O(1),为什么还要平衡 BST? / Hash table avg O(1), why still need balanced BST?
2. 红黑树比 AVL 树宽松,为什么 Linux CFS 选红黑树? / Red-black tree more relaxed than AVL, why Linux CFS chose it?
3. HNSW 算法的核心思想是什么?为什么比 KD-Tree 在高维更好? / HNSW core idea? Why better than KD-Tree in high dimensions?
4. LLM 的"注意力"和哈希表的本质区别是什么? / Essential difference between attention and hash table?

## 推荐资源 / Resources

- 书 / Book: *Introduction to Algorithms* CLRS (第 10-13 章 / Chapters 10-13)
- 网站 / Website: [visuAlgo.net](https://visualgo.net) — 数据结构可视化 / visualization
- 课程 / Course: **MIT 6.006** Introduction to Algorithms

---

参见 / See also: [[big-o-notation]], [[classic-algorithms]]
