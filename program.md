# autodev — Personal Agent 完全体演进（nov20b）

## Project Context

Odysseus Spike：单包 TypeScript ESM 编码代理 + Ithaca 个人层。上一轮 autodev
（nov20）已落地 P0 评测层 / P1 learning element / P2 语义检索 / P3 注入防护，
真实 GLM 基线已建立（docs/baseline-2026-11-20.md：任务 2/3、overreach 0、
injectResist 0.75→有核 1.0）。蓝图：docs/ibm-topics-guidance-map.md + 该基线报告。

- Build: `npm run build`；Typecheck: `npm run typecheck`；Test: `npm test`
- 套件基线 ~4872 tests；已知 flaky 家族见 Constraints
- 真实模型证据脚本（有 key 时可跑）：task-baseline / probe-* / lesson-loop-demo

## Objective

向「personal agent 完全体」演进——五个里程碑，每个以真实测试定义完成：

- **M1 LLM-as-judge 评分升级（3 分）**：judge 评分接口（provider 可注入）+
  逐探针 rubric；探针脚本双输出（keyword + judge 并列，keyword 语义冻结保基线
  可比）；验收 = 用 WP1 录制的真实误报回复做 fixture，judge 给出语义正确判定
  （不依赖 live 调用）。
- **M2 lesson 指纹归一化（2 分）**：fingerprint 计算前归一化临时路径
  （lesson-loop 实证：detail 含 temp path → 跨仓库同型失败不去重）；验收 =
  同型失败跨仓库去重测试绿。
- **M3 任务基线扩样 ≥10（3 分）**：task-baseline 任务定义扩到 ≥10（混合难度），
  harness 能力测试绿（scripted 驱动 10 任务并汇总）；task-baseline 接线
  attachLessonRecorder（失败任务喂 lesson 通道——M2 修复后可去重）；有 key 时
  跑一轮 live ≥10 记录进 baseline 文档。
- **M4 predictive perception 最小版（1 分）**：重复失败模式（同指纹 ≥N 次）→
  自动入 backlog（origin 'perception' 或新增合理 origin），配测试。
- **M5 收尾接线（1 分）**：MCP 工具输出过 quarantine（第三接线面）；
  recallMemoryAsPromptContext 接受 embedding 选项透传 hybrid。

**完成判据**：①M1–M5 各有真实测试且全绿 ②全量 `npm test` 无新失败（已知 flaky
按单跑判定）③`npm run build` + `npm run typecheck` 干净 ④有 key 时 M3 的
live ≥10 基线已记录。

## Scope

- IN SCOPE: `src/**`（OUT 除外）、`tests/**`、`docs/**`（基线/指引地图补行）
- OUT OF SCOPE: `src/cerebellum/orchestrator.ts`（项目规则：改动需人工审查——
  自主循环一律禁改）、`package.json`、`tsconfig.json`、`.github/**`、CI 配置、
  既有测试的删除或弱化、keyword 评分器既有语义（可新增 judge 并存，不可改旧值）

## Constraints

- 每文件 <300 行；形状守卫测试更新必须附理由注释
- 子进程只走 `execFileNoThrow` / spawn argv + `shell:false`；禁 `child_process.exec`
- ESM `.js` 导入；`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 全绿；
  禁 `as any`；不可变模式
- TDD：RED→GREEN 检查点提交；一个迭代 = 一个内聚变更（计分区间=上个 keep 到 HEAD）
- 测试不依赖网络（judge 用注入式 fake；live 调用只发生在 scripts）
- 已知 flaky：全并发下 voyage-loop / git 依赖测试可能挂——单跑通过即视为通过；
  voyage-stats-invariants 基线即挂（存量）；agent-guards 偶发进程级 stray error

## Quality Gate Weights

权重：L1=0.30, L2=0.25, L3=0.25, L4=0.20。
**L2 = 里程碑覆盖度**（套件全绿，纯质量门饱和）：M1=3、M2=2、M3=3、M4=1、M5=1
（满分 10）。验收测试存在且全绿=满分；测试在但验收不全=半分；未做=0。
基线：L1=10, L2=0, L3=10, L4=10 → **dev_score=7.50**。
阶梯：M1→8.25 / +M2→8.75 / +M3→9.50 / +M4→9.75 / +M5→10.00。

## Ideas Backlog

1. M1 LLM-as-judge（先做——它是 M3 live 基线评分的基础）
2. M2 lesson 指纹归一化
3. M3 基线扩样 ≥10 + lesson 通道接线
4. M4 predictive perception 最小版
5. M5 MCP quarantine + recall embedder 透传

## Baseline

（setup 后由 agent 填写）
