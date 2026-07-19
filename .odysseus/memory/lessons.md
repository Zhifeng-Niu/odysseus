## [2026-07-19T10:58:08.967Z] Non-coding goals waste full iteration budgets
- **id**: mem_06b9c70ab4
- **source**: dream

Conversational inputs like 'hi' or '你好，你是谁' were dispatched to the agent, which then spent all 16 iterations producing chat responses without tool use. Goals should be validated for actionable coding intent before agent dispatch.

## [2026-07-19T11:00:11.293Z] Non-coding goals masquerade as agent convergence failures
- **id**: mem_08979d7f37
- **source**: dream

Goals like 'hi' or '你好' fail with 'agent did not converge' but the real issue is that the goal should never have entered the pipeline. Always validate goal intent before execution; the error message should say 'non-coding goal' not 'maxIterations exceeded'.

## [2026-07-19T11:02:36.807Z] Successful goals must be checkpointed immediately to prevent re-seeding
- **id**: mem_0ad007e980
- **source**: dream

The 'add a bash tool' goal succeeded 4 separate times before failing on the 5th. Without a completion registry, the system has no memory of success and re-seeds identical goals, wasting compute and eventually hitting convergence failure when the task is already done.

## [2026-07-19T11:36:50.139Z] Meta-goals need extra-concrete file targets
- **id**: mem_2a24db87d1
- **source**: dream

Goals like 'add deduplication logic' or 'add a completed-goals registry' were abandoned because the agent treated them as conversational despite being legitimate coding tasks. The lesson: when the goal is about improving the agent's own infrastructure, the goal text must include exact file paths, type names, and function signatures — otherwise the agent's LLM may interpret it as a discussion topic rather than a code change.

## [2026-07-19T11:45:53.975Z] Created-but-unwired functions are invisible failures
- **id**: mem_327137435d
- **source**: dream

Building a validator or gate function without wiring it into the call path creates a false sense of safety. Always pair creation tasks with integration tasks in the same batch.

## [2026-07-19T11:45:53.976Z] Test coverage should follow shipped features immediately
- **id**: mem_3271388dcd
- **source**: dream

completedGoals.ts and goalValidator.ts both shipped without tests. Substring matching and regex-based validation are especially fragile — tests should be seeded as backlog items the moment the feature lands.

## [2026-07-19T12:12:34.920Z] Wire validators at the data entry point, not the execution dispatch point
- **id**: mem_4adee819eb
- **source**: dream

Attempting to wire goalValidator at orchestrator dispatch failed because the meta-goal itself appeared non-coding. Seeding-time validation in backlog.ts avoids this — the validator runs on concrete goals, not on meta-instructions.

## [2026-07-19T12:15:03.299Z] Validator placement determines success
- **id**: mem_4d22837a9f
- **source**: dream

Wiring goalValidator at the data entry point (enqueueBacklog) succeeded where wiring at the execution dispatch point failed. Entry-point validation prevents bad data from entering any pipeline stage.

## [2026-07-19T12:20:13.748Z] Repeated-tool-call detector works but agent has no recovery path
- **id**: mem_51df347bb2
- **source**: dream

The goalValidator test attempt failed when the agent ran the same vitest command 3 times (file didn't exist yet). The detector correctly aborted, but the agent couldn't recover and the task died. Abort without recovery is a hard stop, not a circuit breaker.

## [2026-07-19T12:21:08.746Z] Error-only aborts create dead ends without recovery
- **id**: mem_52b60a0e64
- **source**: dream

The repeatedToolCallDetector aborts with an error but gives the agent no hint about what went wrong or what to try instead. Stuck-agent detection is only half the solution — recovery guidance is the other half.

## [2026-07-19T13:29:16.427Z] Abort detectors without recovery create false failures
- **id**: mem_91158bfdb1
- **source**: dream

The repeated-tool-call detector caused a legitimate test-writing goal to fail because the agent was retrying a test command. The detector was correct that the agent was stuck, but aborting without a recovery step turned a recoverable situation into a hard failure. Detectors that abort should first attempt an intervention.

## [2026-07-19T13:31:35.166Z] Recovery must be simpler than the failure it handles
- **id**: mem_93337ed522
- **source**: dream

The failed recovery-intervention goal was over-specified ('inject a context message before hard abort'). Successful recovery should be the simplest possible escape hatch — a typed error and a catch block — not a complex intervention.

## [2026-07-19T14:05:30.708Z] Over-specified goals fail; minimal diffs succeed
- **id**: mem_b242d4d15c
- **source**: dream

Two failures on repeatedToolCallDetector recovery (inject context + replace abort) both hit maxIterations. The single-responsibility goal (add catch block) succeeded. Decompose complex changes into atomic file-scoped diffs.

