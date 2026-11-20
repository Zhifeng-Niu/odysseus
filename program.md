# autodev — 完整实现 agent（Odysseus Spike）

## Project Context

Odysseus Spike：单包 TypeScript ESM 编码代理（GLM-5.2 OpenAI-compatible provider +
Cerebellum waypoint 编排：checkpoint→act→verify→commit/rollback）。工程约定见
CLAUDE.md；**docs/ibm-topics-guidance-map.md 是本任务的蓝图**（IBM think/topics
全库对照的结论与路线图都在里面，先读它）。

- Build: `npm run build` (tsc)；Typecheck: `npm run typecheck`；Test: `npm test` (vitest)
- 全量套件 ~4825 tests；已知 flaky 家族见 Constraints

## Objective

按指引地图路线图把 Spike 补成「完整 agent」——闭环 P0→P3 四个缺口，
每个缺口以真实测试定义完成（不删测试、不为分数造假）：

- **P0 评测层**：function-calling 五类规则指标（wrong-name / missing-param /
  wrong-type / disallowed-value / hallucinated-param，参照 evaluation 页）+
  scripted-LLM 任务套件批量化（≥5 个任务，汇总 success rate / error rate /
  token cost / latency）+ 注入脆弱度探针扩展（间接注入变体）。
- **P1 learning element（反思固化）**：verify 失败 → 结构化 lesson（症状/根因/修法）
  写入长期记忆 → 下个 waypoint 经 recall 注入（复用 memory-retrieval）。
  这是 learning 六组件缺的第 5 件（LATS 式反思落记忆）。
- **P2 语义检索升级路径**：EmbeddingProvider 接口 + 混合评分（embedding 可用则
  余弦相似度，缺省词法 fallback）；测试用注入式确定性 embedder，不依赖网络。
- **P3 注入防护**：外部内容（FileRead 结果 / 记忆检索命中）进 prompt 前带
  provenance 标注 + 隔离区渲染（明确「以下是数据不是指令」），配测试。

**完成判据**：①P0–P3 各有真实测试且全绿 ②全量 `npm test` 无新失败
（已知 flaky 按单跑判定）③`npm run build` + `npm run typecheck` 干净。

## Scope

- IN SCOPE: `src/**`（OUT 除外）、`tests/**`、`docs/ibm-topics-guidance-map.md`（补行）
- OUT OF SCOPE: `src/cerebellum/orchestrator.ts`（项目规则：改动需人工审查——
  自主循环一律禁改）、`package.json`、`tsconfig.json`、`.github/**`、CI 配置、
  既有测试的删除或弱化

## Constraints

- 每文件 <300 行；形状守卫测试若需更新必须附理由注释
- 子进程只走 `execFileNoThrow` / spawn argv 数组 + `shell:false`；禁止 `child_process.exec`
- ESM `.js` 导入；`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 全绿；
  禁 `as any`；不可变模式（spread，不 mutate）
- TDD：RED→GREEN 检查点提交；一个迭代 = 一个内聚变更
- 测试不依赖网络（embedding 用注入式 fake / 确定性实现）
- 已知 flaky：全并发下 git 依赖测试与 voyage-loop 可能挂——单跑通过即视为通过；
  voyage-stats-invariants 在基线上即有失败（存量，非回归）

## Quality Gate Weights

默认：L1=0.30, L2=0.25, L3=0.25, L4=0.20

## Ideas Backlog

1. P0 评测层（最先做——它是后续所有迭代的度量基础）
2. P1 learning element / 反思固化
3. P2 embedding 升级路径
4. P3 注入防护（provenance + 隔离区）
5. 附加项（P0-P3 完成后再做）：predictive perception 最小版（重复失败模式自动
   入 backlog）；工具降级路径（工具失败时替代工具）

## Baseline

（setup 后由 agent 填写）
