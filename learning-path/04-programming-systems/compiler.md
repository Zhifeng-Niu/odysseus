---
title: 编译器 · Compiler
type: concept
phase: 4
tags: [compiler, parser, codegen, optimization]
created: 2026-07-21
language: zh-CN
---

# 编译器 · Compiler

> **学习目标 / Learning Objectives**
> - 理解编译器前端 (lexer/parser) 和后端 (codegen/optimizer) / Understand compiler frontend and backend
> - 看到从高级语言到机器码的完整翻译流程 / See the full translation flow
> - 理解 LLM 的"代码生成"与传统编译器的本质区别 / Understand the essential difference between LLM code generation and traditional compilers

## 编译器的阶段 / Compiler Phases

```
源码 source code
    ↓
┌─────────────────────┐
│ Lexical Analysis    │  词法分析 → tokens
│ (Lexer/Scanner)     │
└─────────────────────┘
    ↓
┌─────────────────────┐
│ Syntax Analysis     │  语法分析 → AST (Abstract Syntax Tree)
│ (Parser)            │
└─────────────────────┘
    ↓
┌─────────────────────┐
│ Semantic Analysis   │  语义分析 → 类型检查、作用域
│                     │
└─────────────────────┘
    ↓
┌─────────────────────┐
│ IR Generation       │  中间表示生成 → IR (e.g., LLVM IR)
│                     │
└─────────────────────┘
    ↓
┌─────────────────────┐
│ Optimization        │  优化 → 多 pass: 内联、循环展开、向量化
│                     │
└─────────────────────┘
    ↓
┌─────────────────────┐
│ Code Generation     │  目标代码生成 → assembly
│                     │
└─────────────────────┘
    ↓
┌─────────────────────┐
│ Assembly & Linking  │  汇编 + 链接 → 可执行文件
└─────────────────────┘
```

## 阶段 1: 词法分析 Lexical Analysis

把源码字符串切分为 **token**:

> Split source string into **tokens**:

```c
int main() { return 42; }
```

→

```
Token("int", KEYWORD)
Token("main", IDENTIFIER)
Token("(", LPAREN)
Token(")", RPAREN)
Token("{", LBRACE)
Token("return", KEYWORD)
Token("42", NUMBER)
Token(";", SEMICOLON)
Token("}", RBRACE)
```

**实现 Implementation**: 用正则表达式或 DFA (Deterministic Finite Automaton). 工具: `lex` / `flex`.

## 阶段 2: 语法分析 Syntax Analysis

把 token 序列组织成 **AST (Abstract Syntax Tree)**:

> Organize tokens into **AST**:

```
FunctionDeclaration
├── returnType: int
├── name: main
├── params: []
└── body: Block
    └── ReturnStatement
        └── NumberLiteral: 42
```

**实现 Implementation**: 用 CFG (Context-Free Grammar) + 解析算法. 工具: `yacc` / `bison`.

**经典解析算法 Parsing algorithms**:
- **递归下降 Recursive Descent**: 简单直观,手写常用
- **LL(1)**: 自顶向下
- **LR / LALR**: 自底向上,工具自动生成

## 阶段 3: 语义分析 Semantic Analysis

检查 AST 是否符合语言规则:

- **类型检查 type checking**: `int + string` 是错误吗?
- **作用域 scope**: 变量声明前不能使用
- **声明检查 declaration**: 函数调用前必须声明

## 阶段 4: IR Generation

把 AST 翻译为**中间表示 Intermediate Representation**. IR 是与具体机器无关的中间形式,方便优化.

> Translate AST to **Intermediate Representation**. IR is machine-independent, good for optimization.

**LLVM IR 示例 / LLVM IR example**:

```llvm
define i32 @main() {
  ret i32 42
}
```

## 阶段 5: 优化 Optimization

这是编译器最复杂的部分. 现代编译器有几百个优化 pass:

> This is the compiler's most complex part. Modern compilers have hundreds of optimization passes:

- **常量折叠 constant folding**: `2 + 3` → `5`
- **死代码消除 dead code elimination**: 删除不影响输出的代码
- **内联 inlining**: 函数调用替换为函数体
- **循环展开 loop unrolling**: 把循环变成顺序代码,减少分支
- **公共子表达式消除 CSE**: `a+b; a+b` → 只算一次
- **向量化 vectorization**: 用 SIMD 指令并行处理
- **逃逸分析 escape analysis**: 决定对象分配栈还是堆

**优化级别 Optimization levels** (GCC/Clang):
- `-O0`: 不优化,调试用
- `-O1`: 基本优化
- `-O2`: 中等优化(默认)
- `-O3`: 激进优化(可能增大代码大小)
- `-Os`: 优化代码大小
- `-Ofast`: `-O3` + 不严格 IEEE 浮点

**关键 Key**: `-O2` 比 `-O0` 通常快 2-5 倍. 但有些优化会引入 bug,尤其涉及 UB (undefined behavior).

## 阶段 6: 代码生成 Code Generation

把优化后的 IR 翻译为目标机器的汇编,再汇编为机器码.

> Translate optimized IR to target assembly, then assemble to machine code.

**指令选择 instruction selection**: 选最快的指令
**寄存器分配 register allocation**: 决定哪些变量放寄存器,哪些放栈
**指令调度 instruction scheduling**: 安排指令顺序避免 pipeline stall

## 链接 Linking

多个编译单元 (.o 文件) 合并为一个可执行文件 / Merge multiple compilation units into one executable:

- **符号解析 symbol resolution**: 找到 `printf` 的定义在哪
- **重定位 relocation**: 调整地址引用
- **静态链接 static linking**: 库代码复制进可执行文件
- **动态链接 dynamic linking**: 运行时载入共享库 (.so / .dll)

## 解释器 vs 编译器 / Interpreter vs Compiler

| 维度 | 编译器 Compiler | 解释器 Interpreter | JIT |
|----|-----------|-------------|-----|
| 何时翻译 | 提前 ahead-of-time | 运行时 | 运行时,缓存 |
| 速度 | 最快 | 最慢 | 中等 |
| 启动 | 快 | 慢 | 中等 |
| 例子 | C, C++, Rust | Python, Ruby | Java, JS V8 |

**JIT (Just-In-Time) Compilation**: 运行时分析热点 hot spot,编译为机器码缓存. V8 (JavaScript), HotSpot (Java), PyPy (Python), LuaJIT 都用 JIT.

> **JIT**: runtime analyze hot spots, compile to machine code cache. V8, HotSpot, PyPy, LuaJIT.

## 与 LLM 的连接 / Connection to LLMs

1. **LLM 生成代码 vs 编译器生成代码**
   - 编译器: **保证语义等价** (优化后的程序行为与原程序一致)
   - LLM: **统计概率生成** (没有语义保证)
   
   这是根本区别. LLM "写代码"本质是统计模式匹配,不是编译.
   
   > - Compiler: **guarantees semantic equivalence**
   > - LLM: **statistical generation, no semantic guarantee**
   > 
   > Fundamental difference. LLM "writing code" is statistical pattern matching, not compilation.

2. **编译器是确定性算法的极致体现**
   给定输入,输出完全可重现. 数十年累积的工程智慧.
   
   > Deterministic algorithm's pinnacle. Reproducible output. Decades of engineering wisdom.

3. **MLIR: 机器学习专用 IR**
   LLVM 团队开发的 MLIR (Multi-Level IR) 专门为 AI/ML 优化. PyTorch、TensorFlow 都在迁移到 MLIR 后端.
   
   > MLIR (Multi-Level IR) by LLVM team, for AI/ML. PyTorch, TensorFlow migrating.

4. **编译器与 LLM 的融合: 神经编译器 Neural Compiler**
   能否用神经网络替代编译器? 当前不可行 —— 编译器需要**正确性保证**,神经网络给不了. 但 LLM 可以辅助编译器优化、自动调参、代码理解.
   
   > Can neural networks replace compilers? Currently no — compilers need **correctness guarantees**, neural networks can't provide. But LLMs can assist in optimization, auto-tuning, code understanding.

5. **范式思考**: 编译器证明"复杂的智能行为可以是确定性算法". 这暗示**高级智能未必需要概率推理**.
   > Compilers prove "complex intelligent behavior can be deterministic algorithm". This suggests **high intelligence may not need probabilistic reasoning**.

## 关键问题 / Questions

1. 解释器 vs JIT vs AOT 编译器,各自的优劣? / Interpreter vs JIT vs AOT, trade-offs?
2. 编译器优化的极限在哪? / Compiler optimization limits?
3. LLVM IR 为什么不直接是汇编?中间层有什么用? / Why LLVM IR instead of direct assembly?
4. 能用 LLM 替代编译器吗?如果能,需要什么前提? / Can LLM replace compilers? If yes, what prerequisites?
5. 大脑是"编译器"还是"解释器"? / Is the brain a "compiler" or "interpreter"?

## 推荐资源 / Resources

- 书 / Book: *Compilers: Principles, Techniques, and Tools* — Aho (Dragon Book 龙书)
- 书 / Book: *Engineering a Compiler* — Cooper & Torczon
- 课程 / Course: **Stanford CS143** — Cool language compiler
- 项目 / Project: **LLVM Kaleidoscope Tutorial** — 自己写一门语言 / Write your own language

---

参见 / See also: [[operating-system]], [[linker-and-loader]]
