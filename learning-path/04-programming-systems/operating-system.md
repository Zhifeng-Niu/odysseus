---
title: 操作系统 · Operating System
type: concept
phase: 4
tags: [os, kernel, process, scheduler, virtual-memory]
created: 2026-07-21
language: zh-CN
---

# 操作系统 · Operating System

> **学习目标 / Learning Objectives**
> - 理解 OS 是"资源抽象层" / Understand OS as resource abstraction layer
> - 掌握进程、线程、调度、虚拟内存 / Master process, thread, scheduling, virtual memory
> - 看到 OS 抽象在 AI 系统中的对应物 / See OS abstractions' correspondences in AI systems

## OS 是什么? / What Is OS?

**OS** = 一层软件,管理硬件资源(CPU、内存、I/O),为应用程序提供统一接口.

> **OS** = software layer managing hardware resources (CPU, memory, I/O), providing unified interfaces for applications.

**两个角色 Two roles**:
1. **资源管理者 Referee**: 多个程序共享硬件,OS 公平分配
2. **抽象提供者 Illusionist**: 让每个程序以为独占 CPU、独占内存、独占磁盘

> 1. **Referee**: multiple programs share hardware, OS allocates fairly
> 2. **Illusionist**: each program thinks it owns CPU, memory, disk

## 操作系统的核心抽象 / OS Core Abstractions

### 1. 进程 Process

**进程 = 运行中的程序 + 它的资源**

> **Process = running program + its resources**

包括 / Including:
- 地址空间 address space (虚拟内存)
- 寄存器状态、PC、SP
- 打开的文件 file descriptors
- 线程 threads

OS 给每个进程一个**PID**,独立调度.

### 2. 虚拟内存 Virtual Memory

每个进程看自己的内存是连续的、独占的. 实际上,OS + MMU(内存管理单元)把虚拟地址映射到物理地址.

> Each process sees its memory as contiguous, exclusively owned. Actually OS + MMU (Memory Management Unit) map virtual to physical addresses.

```
进程 A 虚拟地址 0x1000 ──┐
                       ├──→ 物理地址 0x5000
进程 B 虚拟地址 0x1000 ──┘   (不同物理位置!)
```

**好处 Benefits**:
- 进程间隔离(进程 A 不能访问进程 B 的内存)
- 内存共享(OS、共享库映射到所有进程同一物理页)
- 按需分页 demand paging

### 3. 文件 File

文件 = 一段字节流的命名存储. "一切皆文件"是 UNIX 哲学.

> File = named storage of byte stream. "Everything is a file" is UNIX philosophy.

```c
int fd = open("/home/user/data.txt", O_RDONLY);
char buf[100];
read(fd, buf, 100);
close(fd);
```

**UNIX 哲学**: 设备(/dev/sda)、网络套接字、管道、进程间通信 —— 全部用 open/read/write/close 接口. 统一抽象,极强.

> **UNIX philosophy**: devices (/dev/sda), network sockets, pipes, IPC — all use open/read/write/close interface. Unified abstraction, extremely powerful.

### 4. 系统调用 System Call

用户程序不能直接访问硬件. 必须通过 **syscall** 请求 OS 服务.

> User programs can't directly access hardware. Must request OS service via **syscall**.

```
用户态 user mode ─── syscall ──→ 内核态 kernel mode
                                    ↓
                                  处理
                                    ↓
用户态 ←─── return ───────────── 内核态
```

典型 syscall / Typical syscalls:
- `read(fd, buf, n)` / `write(fd, buf, n)`
- `open(path, flags)` / `close(fd)`
- `fork()` / `execute-program()` / `wait()`
- `mmap()` / `brk()`
- `socket()` / `connect()` / `send()` / `recv()`

每次 syscall 都要切换用户态/内核态,开销 ~1-10 μs. 频繁 syscall 会严重拖慢程序.

> Each syscall requires user/kernel mode switch, ~1-10 μs overhead. Frequent syscalls can severely slow programs.

## 进程调度 Process Scheduling

OS 决定哪个进程什么时候上 CPU. 调度算法 / Scheduling algorithms:

- **FIFO / FCFS**: 先来先服务. 简单,但短任务可能等很久.
- **Round Robin**: 时间片轮转. 公平.
- **Multilevel Feedback Queue**: 多级反馈队列. 现代 OS 用的复杂算法.
- **CFS (Completely Fair Scheduler)**: Linux 默认调度器,基于红黑树.

**关键 trade-off**: 公平 vs 吞吐量 vs 响应时间.

**上下文切换 context switch**: 从进程 A 切换到进程 B,要保存 A 的寄存器,加载 B 的寄存器. 代价 ~1-10 μs. 频繁切换会浪费 CPU.

> **Context switch**: switching from process A to B requires saving A's registers, loading B's. Cost ~1-10 μs. Frequent switching wastes CPU.

## 线程 Thread

**线程 = 进程内的执行单元**

> **Thread = execution unit within process**

同一进程的多个线程:
- **共享地址空间**、文件描述符、堆
- 各自有独立的栈、寄存器

| 维度 | 进程 Process | 线程 Thread |
|----|----------|----------|
| 地址空间 | 独立 | 共享 |
| 创建开销 | 大 (~1 ms) | 小 (~10 μs) |
| 切换开销 | 大 (~10 μs) | 小 (~1 μs) |
| 通信 | IPC (pipe, socket, shared mem) | 直接共享内存 |

**多线程问题 Multithreading issues**:
- **数据竞争 data race**: 多线程同时写同一变量
- **死锁 deadlock**: 互锁等待
- **可见性 visibility**: 一个线程的修改对另一线程不可见

**同步原语 synchronization primitives**:
- **互斥锁 mutex**: 互斥访问
- **条件变量 condition variable**: 等待/通知
- **信号量 semaphore**: 计数

## 并发 vs 并行 / Concurrency vs Parallelism

- **并发 Concurrency**: 多任务交替进行 (单核也可并发)
- **并行 Parallelism**: 多任务同时进行 (必须多核)

> 一个 CPU 多核、多 GPU 训练 LLM 是**并行**. 一个 CPU 跑 N 个 Python 协程是**并发**.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 推理服务 = 大量并发**
   多用户同时请求,需要并发管理. 异步 IO (epoll/kqueue)、协程 (coroutine) 是关键技术.
   > Multi-user concurrent requests. async IO (epoll/kqueue), coroutines.

2. **OS 的文件抽象在 AI 中的"对应物"**
   - Hugging Face Hub 的 dataset = 类似文件系统
   - PyTorch DataLoader = 类似 read()
   - Tensor 的 device = 类似文件描述符
   > Hugging Face Hub dataset ~ filesystem, PyTorch DataLoader ~ read(), Tensor device ~ file descriptor.

3. **分布式训练 = 多机 OS 协调**
   NCCL、MPI 等通信库 = 分布式 OS 的 IPC. Kubernetes = 集群级 OS.
   > NCCL, MPI ~ distributed OS IPC. Kubernetes ~ cluster-level OS.

4. **范式思考**: OS 用了 70 年成熟. AI 系统 5 年重写一次.
   为什么? 因为 AI 系统的"抽象"还没找到稳定形态. 这是范式突破的机会.
   > OS took 70 years to mature. AI systems rewrite every 5 years. Why? Because AI's "abstractions" haven't found stable form. This is the paradigm shift opportunity.

## 关键问题 / Questions

1. 进程和线程的本质区别是什么? 用一句话说清楚. / Essential process/thread difference in one sentence.
2. 为什么 Linux 不需要专门线程 API, fork + clone 就够了? / Why doesn't Linux need dedicated thread API?
3. 虚拟内存为什么能"骗"每个进程它独占全部内存? / How does virtual memory "fool" each process?
4. Kubernetes 是 OS 吗?为什么? / Is Kubernetes an OS? Why or why not?
5. 大脑的"进程调度"是什么?睡眠和清醒是 context switch 吗? / What's the brain's "process scheduling"? Is sleep/wake a context switch?

## 推荐资源 / Resources

- 书 / Book: *Operating Systems: Three Easy Pieces* — 免费 / free: [ostep.org](https://ostep.org)
- 书 / Book: *Modern Operating Systems* — Tanenbaum
- 课程 / Course: **MIT 6.828** (xv6 实战 / xv6 hands-on)
- 课程 / Course: **Berkeley CS162**

---

参见 / See also: [[memory-layout]], [[compiler]]
