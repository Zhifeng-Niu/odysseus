## [2026-07-19T11:00:11.293Z] Agent produces conversational replies when goal lacks actionable verb
- **id**: mem_08979de989
- **source**: dream

When a goal doesn't start with a concrete code-change verb (add, fix, refactor, implement), the agent defaults to chat mode. Rephrase to a concrete file-and-function target before enqueueing.

## [2026-07-19T11:02:36.806Z] Legitimate coding goals fail when they lack file/function targets
- **id**: mem_0ad006f55f
- **source**: dream

Goals like 'Add deduplication logic to waypoint generation' are valid but were abandoned because the agent produced conversational replies. Phrasing as specific file-and-function modifications ('in src/cerebellum/backlog.ts:enqueueBacklog, add completed-goal check') triggers tool use.

## [2026-07-19T11:36:50.144Z] Three failure modes need distinct handling
- **id**: mem_2a24e044e1
- **source**: dream

Conversational goals, repeated-tool-call loops, and max-iteration exhaustion look identical in logs but need different responses: pre-filter for conversational, loop detector for repetition, progress heuristic for non-convergence.

## [2026-07-19T12:12:34.920Z] Meta-goals about filtering are vulnerable to the filter they implement
- **id**: mem_4adee8b22d
- **source**: dream

Goals like 'reject non-coding inputs' can themselves be rejected as non-coding if the agent evaluates them before understanding intent. Place filtering logic at the data layer (GoalValidator) not the control layer (agent prompt).

## [2026-07-19T12:20:13.748Z] Tests must be written before they are executed
- **id**: mem_51df340308
- **source**: dream

Running vitest on a non-existent test file fails, and the agent may retry the same failing command until the repeatedToolCallDetector kills the run. Write the test file first, then run vitest.

## [2026-07-19T13:29:16.428Z] Over-specified goals cause non-convergence
- **id**: mem_91158cd610
- **source**: dream

A detailed goal ('covering substring matching, case sensitivity, and empty-map behavior') failed; a simpler one ('substring matching and markCompleted()') succeeded. Prefer minimal-scope goals; split complex specs into multiple waypoints.

## [2026-07-19T13:31:35.165Z] Meta-stuck: agent gets stuck fixing stuck-detector
- **id**: mem_93337da759
- **source**: dream

Adding recovery logic to repeatedToolCallDetector hit maxIterations — the fix is vulnerable to the loop it's meant to solve. The fix must be smaller than the problem.

## [2026-07-19T14:05:30.708Z] Recovery shipped via fallback goal after failed attempts
- **id**: mem_b242d49112
- **source**: dream

StuckLoopError recovery required three attempts: two over-specified failures, then a minimal catch-block addition. Failed attempts aren't wasted — they clarify the simplest viable approach.

## [2026-07-19T14:12:27.738Z] Complex recovery fails, simple recovery ships
- **id**: mem_b89fdaa70a
- **source**: dream

Two attempts at sophisticated recovery (inject context before abort, replace abort with throw) hit maxIterations. A simple catch-block-with-nudge succeeded. Recovery must be structurally simpler than the failure it handles.

## [2026-07-19T14:14:34.539Z] Test-file goals fail from scope creep, not validation
- **id**: mem_ba8f2b2b79
- **source**: dream

GoalValidator accepts .test.ts goals, but test creation still fails convergence. Root cause shifted from false-rejection to over-specified scope (3+ scenarios in one goal).

## [2026-07-19T14:14:34.539Z] Shipped recovery without tests creates verification debt
- **id**: mem_ba8f2bcc5b
- **source**: dream

StuckLoopError catch-and-retry shipped with no regression safety net. Recovery code triggers on edge conditions, so it naturally separates into ship-then-test waypoints. Track this debt explicitly.

## [2026-07-19T14:18:31.755Z] Detectors should detect, not recover
- **id**: mem_be2dcb2bd0
- **source**: dream

Two attempts to add recovery logic inside repeatedToolCallDetector hit maxIterations. Throwing StuckLoopError and catching at the main loop shipped in one pass. Keep detection and recovery in separate layers.

## [2026-07-19T14:34:53.400Z] Recovery mechanisms ship without tests
- **id**: mem_cd2858be1f
- **source**: dream

Recovery code is harder to test inline because it triggers on edge conditions. StuckLoopError catch-and-retry, then hint injection, both needed separate follow-up waypoints for tests. Plan ship-then-test rhythm for recovery work.

## [2026-07-19T14:43:03.668Z] Hint injection validated as simpler recovery than error propagation
- **id**: mem_d4a3744a33
- **source**: dream

Appending a contextual nudge to the message stream shipped cleanly with tests, confirming hint injection is more reliable than error-based abort-and-retry for stuck-loop recovery.

## [2026-07-19T19:48:29.968Z] Aborted operations are retryable, not failed
- **id**: mem_ec469001bb
- **source**: dream

"This operation was aborted" = timeout/interruption, not code failure. Re-seed with same or narrower scope rather than abandoning. Four of nine recent operations aborted suggests systemic timeout, not goal-quality issue.

## [2026-07-19T20:32:00.000Z] AGI evolution roadmap (compressed; see git log for full version)
- **id**: mem_140dd4953e
- **source**: reflect
- **tags**: agi, roadmap, self-evolution, meta

Five-stage capability expansion: (1) system-2 self-critique loop, (2) episodic memory + experience sediment, (3) world model + tool extension, (4) autonomous goal-setting + meta-cognition, (5) value alignment. Sequencing for Odysseus spike: (1.1) critic strategy variant → (2.1) topic-keyed memory recall → (4.1) curiosity-driven exploration (already shipped) → (3.2) more tools (browser/HTTP) → defer (1.2)(2.2)(3.1)(5.1). AGI formula: system-2 depth + lifelong memory + world model + autonomous curiosity + recursive self-improvement + value alignment. Full pre-compression body with anchor files in git history (commit before 2026-07-21 Iteration 31).
## [2026-07-21T05:15:20.900Z] Aspirations reachable without safety-perimeter edits
- **id**: mem_1999c43c6c
- **source**: dream

Aspirations 1 and 3 can be advanced by extracting pure decision functions into new files (dream-gate.ts, exploration-feedback.ts) without touching orchestrator.ts. This pattern — extract logic, test in isolation, wire later — bypasses the safety-perimeter gate while still making concrete progress.

## [2026-07-21T05:49:02.193Z] Aspirations decompose into pure-function → state → wiring layers
- **id**: mem_387171ccff
- **source**: dream

Each aspiration has a testable pure-function layer (dream-gate, exploration-feedback), a state-persistence layer (voyage-state), and a wiring layer (orchestrator.ts — safety-perimeter-gated). Ship pure functions first, then state, then propose wiring for human review. This keeps curiosity productive even when the final integration point is off-limits.

## [2026-07-21T06:33:57.809Z] Abandoned-by-conversational-done is retryable
- **id**: mem_6193319cff
- **source**: dream

When a waypoint is abandoned because the agent emitted `[CONVERSATIONAL-DONE]` (not a technical failure), the goal itself was sound — it just never executed. These are clean retries, not re-attempts of failed work. Distinguish from `failure` outcomes where the code ran but didn't converge.

