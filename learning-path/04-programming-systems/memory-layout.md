---
title: 内存布局 · Memory Layout
type: concept
phase: 4
tags: [memory-layout, stack, heap, segments]
created: 2026-07-21
language: zh-CN
---

# 内存布局 · Memory Layout

> **学习目标 / Learning Objectives**
> - 看到进程的虚拟内存如何组织 / See how process virtual memory is organized
> - 掌握栈 vs 堆的本质差别 / Master stack vs heap difference
> - 理解缓冲区溢出、内存泄漏的根源 / Understand buffer overflow, memory leak roots

## 进程地址空间 / Process Address Space

每个进程看自己"独占"整个内存 (虚拟内存). 实际物理内存由 OS 调度共享.

> Each process sees itself "owning" all memory (virtual memory). Physical memory is shared by OS scheduling.

```
高地址 High Address
┌────────────────────────────────┐ 0xFFFFFFFFFFFF (64-bit)
│ 内核空间 Kernel Space          │ 用户不可访问 user-inaccessible
├────────────────────────────────┤
│ 栈 Stack ↓                    │ 函数帧、局部变量 ↓ 增长
│ ...                           │
│                               │
│ (空闲 free)                   │
│                               │
│ ...                           │ ↑
│ 堆 Heap ↑                    │ malloc/free 动态分配
├────────────────────────────────┤
│ BSS Segment                   │ 未初始化的全局/静态变量
├────────────────────────────────┤
│ Data Segment                  │ 已初始化的全局/静态变量
├────────────────────────────────┤
│ Text Segment (Code)           │ 机器码,只读 read-only
└────────────────────────────────┘ 低地址 Low Address
```

## 栈 vs 堆 / Stack vs Heap

| 特性 | 栈 Stack | 堆 Heap |
|----|---------|--------|
| 分配方式 | 自动 (函数调用) | 手动 (malloc/free) |
| 速度 | 极快 (~10 ns) | 慢 (~100-1000 ns) |
| 大小 | 有限 (~8 MB Linux 默认) | 大 (虚拟内存大小) |
| 生命周期 | 函数返回自动释放 | 显式 free |
| 碎片 | 无 | 可能严重 |
| 线程 | 每线程一个栈 | 共享整个堆 |
| 安全 | 相对安全 | 容易出错 |

## 栈帧 Stack Frame

每次函数调用,栈上推入一个**栈帧 stack frame**:

```
高地址 high address
┌──────────────────┐
│ 返回地址 Return addr │ ← caller 的下一条指令
├──────────────────┤
│ 旧 RBP            │ ← caller 的栈帧指针
├──────────────────┤
│ 局部变量 1        │
│ 局部变量 2        │
│ ...              │
└──────────────────┘  ← RSP (栈顶指针)
低地址 low address
```

**调用约定 calling convention**: 谁负责保存哪些寄存器,参数怎么传,返回值在哪. ABI 规定.

> **Calling convention**: who saves which registers, how args pass, where return value goes. ABI specifies.

## 缓冲区溢出 Buffer Overflow

经典 C 漏洞 / Classic C vulnerability:

```c
void vulnerable() {
    char buf[64];
    gets(buf);  // 不检查长度!
}
```

如果用户输入 > 64 字节,会**覆盖** buf 后面的栈帧内容 —— 包括返回地址!

> If user inputs > 64 bytes, **overwrites** stack frame contents past buf — including return address!

**攻击 attack**: 把返回地址覆盖为恶意代码地址 → CPU 跳到恶意代码执行. 这是无数安全漏洞的根源(Code Red, Slammer, Blaster...).

> **Attack**: overwrite return address with malicious code address → CPU jumps to malicious code. Root of countless vulnerabilities.

**缓解 mitigations**:
- 栈保护 Stack canary: 在返回地址前放"金丝雀"值,函数返回前检查,改了就 abort.
- DEP/NX: 栈内存不可执行.
- ASLR: 地址随机化,攻击者难猜地址.

## 堆与 malloc/free

`malloc(size)` 从堆上分配 size 字节. `free(ptr)` 释放. C 运行时库管理堆.

> `malloc(size)` allocates size bytes on heap. `free(ptr)` releases. C runtime manages heap.

**典型实现 Typical implementation**:
- 空闲块链表 free list
- 分配:找到足够大的块,切分
- 释放:标记为空闲,合并相邻空闲块

**问题 problems**:
- **碎片 fragmentation**: 多次分配释放后,堆被切成小碎片,大块需求失败
- **泄漏 leak**: 忘记 free → 内存持续增长
- **悬空指针 dangling pointer**: free 后继续用 → 行为未定义

## 与 LLM 的连接 / Connection to LLMs

1. **KV Cache 是堆的大用户**
   推理服务中,KV Cache 可达数十 GB / GPU. 管理 KV Cache 的内存 = 类似 malloc/free 的难题. vLLM 的 PagedAttention 把 OS 的虚拟内存分页思想用到 KV Cache 上.
   > KV Cache can be tens of GB per GPU. Managing KV Cache = like malloc/free. vLLM's PagedAttention applies OS virtual memory paging to KV Cache.

2. **Python 的引用计数 + GC**
   Python 对象在堆上. 引用计数实时跟踪,引用环用 GC 解决. LLM 生成的 Python 代码,内存行为被 Python 运行时决定.
   > Python objects on heap. Reference counting + GC for cycles. LLM-generated Python code's memory behavior is determined by Python runtime.

3. **CUDA 显存管理**
   GPU 显存 = "另一种堆". `cudaMalloc`/`cudaFree` 类似 malloc/free. PyTorch 自动管理,但内存碎片仍是问题 —— 长训练可能 OOM.
   > GPU VRAM = "another heap". `cudaMalloc`/`cudaFree` like malloc/free. PyTorch auto-manages but fragmentation persists — long training may OOM.

4. **范式思考**: 大脑没有"栈"和"堆"的明确区分?
   工作记忆 like 栈(短期),长期记忆 like 堆(动态). 但大脑的"分配/释放"机制完全不同 —— 神经元连接强度的演化,不是显式 malloc/free.
   > Does the brain have clear stack/heap distinction?
   > Working memory like stack (short-term), long-term memory like heap (dynamic). But brain's "allocate/free" is fundamentally different — evolution of neural connection strengths, not explicit malloc/free.

## 关键问题 / Questions

1. 为什么栈内存"快"? 堆内存"慢"? 具体快多少? 为什么? / Why is stack fast, heap slow? How much? Why?
2. 函数调用层数无限深会怎样?栈溢出的根本原因是什么? / What happens with infinite recursion? Root cause of stack overflow?
3. Java 的 GC 暂停时间经常是 100 ms 级. 这对 LLM 推理服务意味着什么? / Java GC pause often 100 ms. What does this mean for LLM inference services?
4. 大脑为什么没有"内存泄漏"? / Why doesn't the brain have "memory leaks"?

## 推荐资源 / Resources

- 书 / Book: 《深入理解计算机系统》 CSAPP 第 9 章 / CSAPP Chapter 9
- 工具 / Tool: **Valgrind** —— 内存错误检测神器 / memory error detection tool
- 工具 / Tool: **AddressSanitizer (ASan)** —— 现代内存错误检测 / modern memory error detection

---

参见 / See also: [[c-language]], [[operating-system]]
