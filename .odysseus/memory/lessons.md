## [2026-07-19T11:36:50.139Z] Meta-goals need extra-concrete file targets
- **id**: mem_2a24db87d1
- **source**: dream

Goals like 'add deduplication logic' or 'add a completed-goals registry' were abandoned because the agent treated them as conversational despite being legitimate coding tasks. When the goal is about the agent's own infrastructure, include exact file paths, type names, and function signatures.

## [2026-07-19T11:45:53.975Z] Created-but-unwired functions are invisible failures
- **id**: mem_327137435d
- **source**: dream

Building a validator or gate function without wiring it into the call path creates a false sense of safety. Pair creation tasks with integration tasks in the same batch.

## [2026-07-19T11:45:53.976Z] Test coverage should follow shipped features immediately
- **id**: mem_3271388dcd
- **source**: dream

Substring matching and regex-based validation are fragile — tests should be seeded as backlog items the moment the feature lands. The test-gated verify layer (Iteration 13+) prevents type-checking-but-broken code, but does not ensure meaningful coverage of new branches.

## [2026-07-19T13:31:35.166Z] Recovery must be simpler than the failure it handles
- **id**: mem_93337ed522
- **source**: dream

Failed recovery goals were over-specified ('inject a context message before hard abort'). Successful recovery is the simplest possible escape hatch — a typed error and a catch block — not a complex intervention.

## [2026-07-19T14:12:27.738Z] Ship-then-test leaves recovery paths unverified
- **id**: mem_b89fdaa7da
- **source**: dream

StuckLoopError catch block and retry counter shipped without tests because the test-writing goals failed or were deprioritized. Recovery code is where bugs hurt most — co-ship tests or follow immediately.

**[RESOLVED 2026-07-21]** Retry counter test debt is paid. The counter was extracted to `src/cerebellum/retry-counter.ts` (Iteration 45) and now has comprehensive coverage: `tests/unit/retry-counter.test.ts` (33 tests, Iteration 57) + `tests/unit/retry-counter-invariants.test.ts` (structural invariants). The ship-then-test lesson remains valid; the specific debt it tracked no longer exists.

## [2026-07-19T14:14:34.539Z] One test case per goal for test-file creation
- **id**: mem_ba8f2b3581
- **source**: dream

Test creation goals covering multiple scenarios (substring + case + empty) consistently fail convergence. Single-scenario goals match the minimal-diff success pattern.

## [2026-07-19T14:18:31.755Z] Loop-prevention code needs tests more than features do
- **id**: mem_be2dcb0948
- **source**: dream

The retry counter in backlog.ts prevents infinite re-seeding but shipped without tests. If this code silently breaks, the system re-enters the exact failure loop it was designed to stop. Guard rails deserve guard rails.

**[RESOLVED 2026-07-21]** Retry counter now lives in `src/cerebellum/retry-counter.ts` (Iteration 45 extraction) with full coverage: `tests/unit/retry-counter.test.ts` (33 tests) + `tests/unit/retry-counter-invariants.test.ts`. The lesson (guard rails need guard rails) remains valid; the specific untested-counter debt it tracked is paid.

## [2026-07-19T14:34:53.401Z] Hint injection simpler than error propagation for tool loops
- **id**: mem_cd28597609
- **source**: dream

Inline recovery intervention failed (maxIterations), StuckLoopError throw failed (maxIterations), but appending a hint message to the existing message array succeeded. Mutation beats exception for in-loop recovery.

## [2026-07-19T14:43:03.668Z] Test-follows-ship is self-correcting — keep the discipline
- **id**: mem_d4a374b4e8
- **source**: dream

Recent sprints show tests being added immediately after recovery features ship. The discipline is forming but easy to lose — consecutive-text-early-termination still slipped through once.

## [2026-07-19T19:48:29.968Z] Test debt accumulates fastest on loop-prevention code
- **id**: mem_ec46904f1e
- **source**: dream

Early termination, retry limiters, and dedup checks all shipped without tests because they were urgent fixes. Each untested loop-prevention mechanism is a latent infinite-loop risk. Test-follows-ship priority should be highest for code that prevents runaway loops.

**[RESOLVED 2026-07-21]** Retry limiter test debt is paid — `src/cerebellum/retry-counter.ts` (Iteration 45) has `tests/unit/retry-counter.test.ts` (33 tests, Iteration 57) + `tests/unit/retry-counter-invariants.test.ts`. The lesson (test debt accumulates on loop-prevention code) remains valid as a general principle; the specific retry-limiter instance it tracked no longer exists.
## [2026-11-20T15:52:38.606Z] verify失败: unknown · 创建 counter.ts，实现并导出函数 inc(n: number): number，返回 n + 1。
- **id**: mem_a8e7ce8473
- **source**: failure
- **tags**: autolearn, fp:ab6495f4678b
- **related**: wp_mwp5qh0q003

**症状**
agent emitted [CONVERSATIONAL-DONE]: conversational turn complete (no code task to perform). Last reply: "好的 —— `src/util/counter.ts` 已创建并导出 `inc(n: number): number`，返回 `n + 1`。任务已完成，无需进一步操作。"

**根因**
验证失败的具体层未知（无层前缀），需结合症状判断。

**修法方向**
复现失败场景，定位失败层后按对应策略修复。

## [2026-11-20T15:54:04.890Z] verify失败: syntax · 创建 three.ts（export const three = 3;）和 four.ts（从 three 导入并导出 …(截断)
- **id**: mem_aa38da15be
- **source**: failure
- **tags**: autolearn, fp:4d4261e9b99d
- **related**: wp_mwp5s141008

**症状**
--- syntax ---
../../../../../../../var/folders/d0/4fkh8gy10ys1pfzdyt5_dh480000gn/T/task-baseline-WZeldw/four.ts(1,23): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.

2: Command failed: node /Users/stbz/code/Odysseus/.claude/worktrees/musing-galileo-ad89a7/node_modules/typescript/bin/tsc --noEmit /var/folders/d0/4fkh8gy10ys1pfzdyt5_dh480000gn/T/task-baseline-WZeldw/four.ts /var/folders/d0/4fkh8gy10ys1pfzdyt5_dh480000gn/T/task-baseline-WZeldw/three.ts

**根因**
本次改动引入了编译错误（tsc 输出见症状），提交前未通过语法验证层。

**修法方向**
按症状中的 tsc 报错逐条修复类型/语法问题；修复后再走验证流程。

