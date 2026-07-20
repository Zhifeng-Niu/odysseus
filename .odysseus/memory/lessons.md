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

## [2026-07-19T14:14:34.539Z] One test case per goal for test-file creation
- **id**: mem_ba8f2b3581
- **source**: dream

Test creation goals covering multiple scenarios (substring + case + empty) consistently fail convergence. Single-scenario goals match the minimal-diff success pattern.

## [2026-07-19T14:18:31.755Z] Loop-prevention code needs tests more than features do
- **id**: mem_be2dcb0948
- **source**: dream

The retry counter in backlog.ts prevents infinite re-seeding but shipped without tests. If this code silently breaks, the system re-enters the exact failure loop it was designed to stop. Guard rails deserve guard rails.

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
