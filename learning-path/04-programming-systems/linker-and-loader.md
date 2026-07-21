---
title: 链接与加载 · Linker & Loader
type: concept
phase: 4
tags: [linker, loader, elf, abi]
created: 2026-07-21
language: zh-CN
---

# 链接与加载 · Linker & Loader

> **学习目标 / Learning Objectives**
> - 理解从 .c 源码到运行进程的完整链路 / Understand full path from .c source to running process
> - 掌握 ELF 格式(可执行可链接格式) / Master ELF format
> - 看到 LLM 推理框架(PyTorch、vLLM)加载模型权重的本质是同样问题 / See LLM inference framework weight loading as the same same problem

## 从源码到运行的完整过程 / Full Process From Source to Running

```
1. 预处理 preprocess:  .c → .i   (展开宏 / expand macros)
2. 编译 compile:       .i → .s   (源码 → 汇编 / source → assembly)
3. 汇编 assemble:      .s → .o   (汇编 → 目标文件 / assembly → object file)
4. 链接 link:          .o → executable  (合并目标文件 + 库 / merge objects + libs)
5. 加载 load:          executable → running process  (载入内存,跳转入口 / load to memory, jump to entry)
```

## 可执行文件格式 Executable File Format

**Linux/BSD: ELF** (Executable and Linkable Format)
**macOS: Mach-O**
**Windows: PE** (Portable Executable)

### ELF 文件结构 ELF File Structure

```
┌──────────────────────┐
│ ELF Header           │ ← 文件类型、目标架构、入口地址
├──────────────────────┤
│ Program Headers      │ ← 用于加载 (哪些段载入哪些地址)
├──────────────────────┤
│ Section Headers      │ ← 用于链接 (符号、重定位信息)
├──────────────────────┤
│ .text section        │ ← 机器码 machine code
├──────────────────────┤
│ .rodata section      │ ← 只读数据(字符串常量)
├──────────────────────┤
│ .data section        │ ← 已初始化全局变量
├──────────────────────┤
│ .bss section         │ ← 未初始化全局变量(占位,文件不存)
├──────────────────────┤
│ .symtab section      │ ← 符号表(函数名、变量名)
├──────────────────────┤
│ .strtab section      │ ← 字符串表
├──────────────────────┤
│ .rela.text section   │ ← 重定位信息
└──────────────────────┘
```

**关键命令 Key commands**:
- `readelf -a a.out` — 查看 ELF 内容
- `objdump -d a.out` — 反汇编
- `nm a.out` — 查看符号
- `ldd a.out` — 查看动态库依赖

## 静态链接 vs 动态链接 / Static vs Dynamic Linking

### 静态链接 Static Linking

库代码**完全复制**进可执行文件. / Library code **fully copied** into executable.

**优点 Pros**:
- 可执行文件独立,不依赖系统库
- 启动快(无需运行时链接)

**缺点 Cons**:
- 文件大
- 库升级需重新编译所有程序

**典型 Typical**: Go 程序默认静态链接.

### 动态链接 Dynamic Linking

可执行文件**记录依赖**,运行时由 dynamic loader (ld-linux.so) 载入共享库 (.so / .dll).

> Executable **records dependencies**, runtime dynamic loader loads shared libraries.

**优点 Pros**:
- 文件小
- 库升级影响所有程序
- 内存共享(多个进程共用一份 libc.so)

**缺点 Cons**:
- 启动稍慢
- 依赖管理复杂(".so 地狱")

**典型 Typical**: C/C++ 默认动态链接.

## 加载器 Loader

**加载器 Loader**: 操作系统的一部分,把可执行文件载入内存,准备执行.

> **Loader**: part of OS, loads executable into memory, prepares to execute.

加载步骤 Loading steps (Linux `execve` syscall):

```
1. 读 ELF header,验证格式
2. 分配虚拟地址空间
3. 按 program headers 把各段 mmap 到内存
4. .bss 段清零 (ELF 不存,加载时分配)
5. 解析动态链接信息,载入 .so
6. 重定位 (修正地址引用)
7. 设置栈: argc, argv, envp
8. 跳转到 _start → __libc_start_main → main
```

## ABI: 应用二进制接口 / ABI: Application Binary Interface

ABI 规定 / ABI specifies:
- 数据类型大小(int=4, long=8, ...)
- 调用约定(callee/caller saved registers, 参数传递)
- 系统调用接口
- 浮点数表示 (IEEE 754)
- 字节序 endianness

**关键 Critical**: 两个 .o 文件能链接在一起,**必须 ABI 兼容**. 否则链接报错,或运行时崩溃.

> **Critical**: two .o files can link together **only if ABI-compatible**. Otherwise link error or runtime crash.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 模型权重文件类似 ELF**
   - 模型权重 = 数十 GB 二进制文件,按特定格式组织
   - 加载时把权重 tensor 映射到 GPU 显存
   - 类似 ELF 的 .data 段映射到内存
   > - Model weights = tens of GB binary in specific format
   > - Load: map weight tensors to GPU VRAM
   > - Like ELF's .data segment mapped to memory

2. **权重格式之争**
   llama.cpp 用 GGUF (包含 metadata + quantization info), Hugging Face 用 safetensors (避免 Python serialization 漏洞). **格式之争与 ELF 之争同构**.
   > llama.cpp uses GGUF (metadata + quantization), Hugging Face uses safetensors (avoids Python serialization vulnerability). **Format war analogous to ELF wars**.

3. **CUDA kernel 加载**
   PyTorch 启动时加载 libtorch_cuda.so + 大量 CUDA kernel. 这些 kernel 本质是 ELF 在 GPU 上. CPU 二进制 + GPU 二进制需要协调加载.
   > PyTorch loads libtorch_cuda.so + many CUDA kernels. These kernels are essentially ELF on GPU. CPU + GPU binaries coordinate loading.

4. **范式思考**: 大脑没有"加载"概念
   大脑的"知识"是分布式连接,持续可用. 没有"启动时间". 这是当前 AI 架构的根本差异.
   > The brain has no "loading" concept. Knowledge is distributed connections, continuously available. No startup time. Fundamental difference from current AI.

## 关键问题 / Questions

1. 静态链接的可执行文件 vs 动态链接,启动时间差多少? / Static vs dynamic linked, startup time difference?
2. `dlopen` 运行时加载 .so 的原理是什么? / How does `dlopen` runtime loading work?
3. PyTorch 加载 70B 参数模型,主要瓶颈是磁盘读取还是 GPU 拷贝? / Loading 70B param model, bottleneck: disk read or GPU copy?
4. 大脑有"运行时库"吗? / Does the brain have "runtime libraries"?

## 推荐资源 / Resources

- 书 / Book: *Linkers and Loaders* — John Levine (免费在线 / free online)
- 书 / Book: CSAPP 第 7 章 / Chapter 7 (链接 / Linking)
- 命令 / Command: `man elf`, `man ld`, `man ld.so`

---

参见 / See also: [[compiler]], [[memory-layout]]
