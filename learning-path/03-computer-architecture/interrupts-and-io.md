---
title: 中断与 I/O · Interrupts & I/O
type: concept
phase: 3
tags: [interrupts, io, dma, device-driver]
created: 2026-07-21
language: zh-CN
---

# 中断与 I/O · Interrupts & I/O

> **学习目标 / Learning Objectives**
> - 理解 CPU 如何与外部世界交互(键盘、磁盘、网络) / Understand how CPU interacts with external world
> - 掌握中断、DMA、轮询三种 I/O 方式 / Master interrupts, DMA, polling
> - 看到 LLM 训练的"瓶颈"经常是 I/O(数据加载、跨 GPU 通信),而非计算 / See LLM training bottlenecks often I/O (data loading, cross-GPU), not compute

## 为什么需要中断? / Why Interrupts?

**问题 Problem**: CPU 速度 ~1 GHz,键盘按键间隔 ~100 ms。如果 CPU 不停问"按键了吗?",浪费 99.99999% 的算力。

> **Problem**: CPU ~1 GHz, keyboard press interval ~100 ms. If CPU constantly polls "key pressed?", wastes 99.99999% of compute.

**解决 Solution**: 让设备在需要时**主动通知** CPU,这就是中断。

> **Solution**: devices actively notify CPU when needed. This is the interrupt.

## 中断的工作流程 / Interrupt Workflow

```
1. CPU 正在执行程序
2. 设备(键盘、网卡)发中断信号 IRQ (Interrupt Request)
3. CPU 完成当前指令
4. CPU 保存现场 (PC, 寄存器 → 栈 / system memory)
5. CPU 跳转到中断向量表中该设备的中断处理程序 Interrupt Service Routine (ISR)
6. ISR 执行: 读设备数据,写缓冲区
7. ISR 结束,CPU 恢复现场,继续原程序
```

整个切换 ~1-10 μs. 对 3 GHz CPU,这相当于 3000-30000 周期. **中断成本高**.

> Whole switch ~1-10 μs. For 3 GHz CPU, 3000-30000 cycles. **Interrupts are expensive**.

## 三种 I/O 方式 / Three I/O Methods

### 1. 轮询 Polling

```
while (true) {
    if (device_ready()) {
        read_data();
        break;
    }
    // 否则继续循环 / else keep looping
}
```

- 优点 Pros: 简单 simple
- 缺点 Cons: CPU 100% 占用,效率低 / 100% CPU usage, inefficient
- 适合 Suit for: 极少极少数据,或设备状态变化极少 / Very rare data or status changes

### 2. 中断 Interrupt-driven

```
// CPU 在做其他事 / CPU does other things
// 当设备准备好,中断触发 / device ready → interrupt fires
void interrupt_handler() {
    read_one_byte_from_device();
}
```

- 优点 Pros: CPU 可做其他事,效率高
- 缺点 Cons: 每个字节一次中断 → 中断开销大 / Interrupt per byte → overhead
- 适合 Suit for: 低速设备,中等数据量 / Low-speed devices, moderate data

### 3. DMA (Direct Memory Access)

DMA 控制器接手总线,直接把设备数据搬到内存. CPU 完全不参与 / DMA controller takes bus, moves device data to memory directly. CPU not involved.

```
1. CPU 配置 DMA:源地址,目标地址,传输长度
2. CPU 通知 DMA "开始"
3. CPU 去做其他事
4. DMA 搬运数据 (周期窃取 cycle stealing)
5. DMA 完成,中断通知 CPU "搞定"
6. CPU 处理完成
```

- 优点 Pros: CPU 几乎不参与,适合大数据量 / CPU almost uninvolved, suitable for bulk data
- 缺点 Cons: 需要 DMA 控制器硬件,总线仲裁复杂 / Requires DMA controller, complex bus arbitration
- 适合 Suit for: 磁盘、网络、GPU 通信 / Disk, network, GPU communication

**现代系统几乎都用 DMA + 中断**: 磁盘、网卡、声卡、USB、GPU 全部靠 DMA.

> **Modern systems almost universally use DMA + interrupts**: disk, network, sound, USB, GPU all rely on DMA.

## I/O 设备类型 / I/O Device Types

### 块设备 Block Devices

按块传输(扇区,通常 512B-4KB). 可寻址. / Transfer in blocks (sector, typically 512B-4KB). Addressable.

例 / Examples: HDD, SSD, USB 大容量存储 / mass storage.

### 字符设备 Character Devices

按字节/字符流传输. 不可寻址. / Transfer byte/char stream. Un-addressable.

例 / Examples: 键盘, 鼠标, 串口 / serial port.

### 网络设备 Network Devices

数据包 packet 传输. / Packet-based.

例 / Examples: 以太网卡 / Ethernet card, Wi-Fi.

## 内存映射 I/O Memory-Mapped I/O

设备寄存器映射到内存地址空间. 读写这些地址 = 控制设备. / Device registers mapped to memory address space. Reading/writing these addresses = controlling device.

```
例: 假设键盘数据寄存器映射到地址 0xFE0010

// 读一个键 / Read one key
uint8_t key = *((volatile uint8_t*)0xFE0010);
```

`volatile` 关键字告诉编译器:不要优化,每次必须实际读硬件. / The `volatile` keyword tells compiler: don't optimize, always actually read hardware.

**所有现代 CPU 用内存映射 I/O**. 简化了 ISA(没有专用 I/O 指令,统一用 load/store).

> **All modern CPUs use MMIO**. Simplifies ISA (no special I/O instructions, unified load/store).

## 中断向量表 Interrupt Vector Table

中断向量表是一张跳转表 / The interrupt vector table is a jump table:

```
中断号 IRQ | ISR 地址 ISR Address
-----------|----------------
0 (除零 / divide by zero) | 0x1000
1 (键盘中断 / keyboard)   | 0x2000
2 (时钟 / timer)          | 0x3000
...
N (网卡 / network)        | 0xX000
```

当 IRQ n 触发,CPU 自动跳到表中第 n 项的地址. 中断处理完成时,ISR 执行 IRET 指令返回. / When IRQ n fires, CPU auto-jumps to table[n]. ISR returns with IRET.

## 与 AI 的连接 / Connection to AI

1. **LLM 推理服务是 I/O 密集型**
   服务一个用户请求 = 接收网络包 → 解析 JSON → 模型推理 → 返回 JSON. **网络 I/O 经常占 30-50% 延迟**.
   > Serving one request = receive network packet → parse JSON → model inference → return JSON. **Network I/O often 30-50% of latency**.

2. **LLM 训练的瓶颈是 NVLink/InfiniBand 带宽**
   分布式训练每步需要 all-reduce 同步梯度. 通信经常 >50% 训练时间. 这就是为什么 NVIDIA 黑命 GPU + NVLink + InfiniBand 是"全家桶"——深度绑定.
   > Distributed training needs all-reduce to sync gradients every step. Communication often >50% of training time. That's why NVIDIA GPU + NVLink + InfiniBand is a "bundle" — deeply locked in.

3. **流式生成 stream 是中断思想的反向应用**
   LLM 流式输出(token by token)本质是 LLM "中断"用户等待,逐 token 返回. 这是 UX 与硬件 I/O 模式的同构.
   > Streaming output (token by token) is essentially LLM "interrupting" user wait, returning tokens. Isomorphism between UX and hardware I/O.

4. **GPU 与 CPU 的通信本身是 I/O 瓶颈**
   CUDA 内核启动 latency ~5-10 μs. 小算子多 → 启动开销主导. **kernel fusion** 是减少 I/O 的关键优化.
   > CUDA kernel launch latency ~5-10 μs. Many small kernels → launch overhead dominates. **kernel Fusion** is key optimization.

## 关键问题 / Questions

1. 为什么 DMA 不能完全替代 CPU 处理 I/O? / Why can't DMA fully replace CPU for I/O?
2. 中断延迟 ~1-10 μs,对 3 GHz CPU 是 3000-30000 周期. 为什么代价这么大? / Interrupt latency ~1-10 μs, 3000-30000 cycles for 3 GHz CPU. Why so expensive?
3. NVMe SSD 比 SATA SSD 快 10 倍。瓶颈是什么? / NVMe SSD 10× faster than SATA SSD. Bottleneck?
4. 大脑的"中断"机制是什么?(注意:这是一个开放问题 / open question) / What's the brain's "interrupt" mechanism? (Note: open question)

## 推荐资源 / Resources

- 书 / Book: *Computer Organization and Design* — 第 5-6 章 / Chapters 5-6
- 书 / Book: *Linux Device Drivers* — 装置驱动实战 / Device driver practice
- 课程 / Course: **MIT 6.828** Operating Systems (中断处理 / interrupt handling)

---

参见 / See also: [[memory-hierarchy]], [[04-programming-systems/operating-system|OS]]
