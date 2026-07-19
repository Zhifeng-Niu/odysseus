## [2026-07-19T10:58:08.967Z] Duplicate waypoint seeding without completion tracking
- **id**: mem_06b9c734a3
- **source**: dream

The system re-seeded the exact same goal ('add a bash tool to the tools registry') at least 5 times. This indicates the waypoint generator does not check against recently completed goals before creating new ones. A deduplication layer is critical for efficiency.

## [2026-07-19T10:58:08.967Z] Agent convergence failure on previously-succeeded goals
- **id**: mem_06b9c790a0
- **source**: dream

A goal that succeeded 4 times then failed on the 5th attempt with maxIterations exceeded. This suggests environmental state may have changed between runs (e.g., the bash tool was already added and the agent couldn't find new work), or the agent lacks context that the task is already done.

## [2026-07-19T11:00:11.293Z] Repeated identical goal seeding indicates missing completion gate
- **id**: mem_08979d9039
- **source**: dream

When the same goal appears 4+ times in recent outcomes, the root cause is always missing deduplication at the waypoint seeding layer — not agent capability. The fix belongs in goal management, not in the agent loop.

## [2026-07-19T11:00:11.293Z] Agent produces conversational replies when goal lacks actionable verb
- **id**: mem_08979de989
- **source**: dream

When a goal doesn't start with a concrete code-change verb (add, fix, refactor, implement), the agent defaults to chat mode. This is a goal-quality signal: if the goal can't be rephrased to start with an action verb, it likely isn't executable.

## [2026-07-19T11:02:36.806Z] Legitimate coding goals fail when they lack file/function targets
- **id**: mem_0ad006f55f
- **source**: dream

Goals like 'Add deduplication logic to waypoint generation' are valid coding tasks but were abandoned because the agent produced conversational replies instead of invoking tools. The agent needs goals phrased as specific file-and-function modifications to trigger tool use.

## [2026-07-19T11:02:36.807Z] Re-seeded completed goals cause convergence failure
- **id**: mem_0ad0077a89
- **source**: dream

When a goal has already been fulfilled (e.g., bash tool already exists), re-executing it causes the agent to loop without finding work to do, hitting maxIterations. The agent cannot self-detect that the goal state is already satisfied.

## [2026-07-19T11:36:50.144Z] Self-reinforcing dedup failure loop
- **id**: mem_2a24e03e37
- **source**: dream

The system needs dedup to stop re-seeding completed goals, but the dedup-fixing goals themselves get re-seeded and fail. This creates a cycle: the fix can't ship because the bug it fixes prevents the fix from converging. Breaking this requires the fix to be so concrete (exact file, exact function, exact logic) that the agent can't misinterpret it as conversational.

## [2026-07-19T11:36:50.144Z] Convergence failure vs non-coding goal are indistinguishable without pre-filtering
- **id**: mem_2a24e044e1
- **source**: dream

Both manifest as 'hit maxIterations without DONE'. The difference is only visible in the raw trace: non-coding goals produce conversational text turns; true convergence failures produce repeated identical tool calls. A goal validator pre-filter eliminates the first category, and a repeated-tool-call detector catches the second.

## [2026-07-19T11:45:53.976Z] Three failure modes need distinct handling
- **id**: mem_3271383f44
- **source**: dream

Conversational goals, repeated-tool-call loops, and max-iteration exhaustion are three distinct failure modes that currently look identical in logs. Each needs its own detector and rejection path: pre-filter for conversational, loop detector for repetition, and a lower maxIterations or progress heuristic for general non-convergence.

## [2026-07-19T12:12:34.920Z] Meta-goals about filtering are vulnerable to the filter they implement
- **id**: mem_4adee8b22d
- **source**: dream

Goals like 'reject non-coding inputs' can themselves be rejected as non-coding if the agent evaluates them before understanding intent. Structural placement (data layer vs control layer) determines survivability.

## [2026-07-19T12:15:03.299Z] Substring matching for goal dedup risks false positives
- **id**: mem_4d2283fc0c
- **source**: dream

Using substring matching in isCompleted() means a goal like 'fix bug in src/foo.ts' could falsely match 'fix bug in src/foo.ts.backup'. Consider exact hashing or normalized form for dedup keys.

## [2026-07-19T12:20:13.748Z] Test file creation fails when agent runs tests before writing files
- **id**: mem_51df340308
- **source**: dream

When a test file doesn't exist, running vitest on it fails, and the agent may retry the same failing command. The repeatedToolCallDetector then kills the run. Tests must be written before they are executed.

## [2026-07-19T12:21:08.746Z] GoalValidator false-positives on test-file creation goals
- **id**: mem_52b60a2cf7
- **source**: dream

Goals containing '.test.ts' or 'unit tests' are being rejected as non-coding by the goalValidator, creating a recursive blind spot where the validator blocks testing of itself. Any pattern-matching validator will have edge cases at its own boundary.

## [2026-07-19T13:29:16.428Z] Over-specified goals cause non-convergence more than simple ones
- **id**: mem_91158cd610
- **source**: dream

completedGoals.test.ts failed with a detailed goal ('covering substring matching, case sensitivity, and empty-map behavior') but succeeded with a simpler one ('substring matching and markCompleted()'). Extra specificity in goal descriptions seems to cause the agent to overthink and not converge.

## [2026-07-19T13:31:35.165Z] Meta-stuck: agent gets stuck fixing stuck-detector
- **id**: mem_93337da759
- **source**: dream

The agent attempting to add recovery logic to the repeatedToolCallDetector itself hit maxIterations without converging. Fixing a stuck-loop detector is vulnerable to the same loop it's meant to solve — the fix must be smaller than the problem.

## [2026-07-19T14:05:30.708Z] Recovery shipped via fallback goal after two failed attempts
- **id**: mem_b242d49112
- **source**: dream

The StuckLoopError recovery path required three attempts: two over-specified failures, then a minimal catch-block addition that succeeded. The failure attempts weren't wasted — they clarified the simplest viable approach.

## [2026-07-19T14:12:27.738Z] Complex recovery fails, simple recovery ships
- **id**: mem_b89fdaa70a
- **source**: dream

Two attempts to add sophisticated recovery (inject context before abort, replace abort with throw) both hit maxIterations. A simple catch-block-with-nudge succeeded. Recovery must be structurally simpler than the failure it handles.

## [2026-07-19T14:14:34.539Z] Test-file goals fail from scope creep, not validation
- **id**: mem_ba8f2b2b79
- **source**: dream

GoalValidator now accepts .test.ts goals, but test creation still fails convergence. Root cause shifted from false-rejection to over-specified scope (3+ scenarios in one goal).

## [2026-07-19T14:14:34.539Z] Shipped recovery without tests creates verification debt
- **id**: mem_ba8f2bcc5b
- **source**: dream

StuckLoopError catch-and-retry shipped successfully but test goal was abandoned as non-coding. Recovery code is now in production with no regression safety net.

## [2026-07-19T14:18:31.755Z] Inline recovery in detectors fails; error propagation succeeds
- **id**: mem_be2dcb2bd0
- **source**: dream

Two attempts to add recovery logic directly inside repeatedToolCallDetector hit maxIterations without converging. Throwing StuckLoopError and catching at the main loop level shipped in one pass. Detectors should detect, not recover.

## [2026-07-19T14:34:53.400Z] Recovery mechanisms consistently ship without tests
- **id**: mem_cd2858be1f
- **source**: dream

StuckLoopError catch-and-retry shipped, then needed separate waypoint for tests. Recovery hint injection shipped, now needs tests. Recovery code is harder to test inline because it triggers on edge conditions, so it naturally separates into ship-then-test waypoints.

## [2026-07-19T14:43:03.668Z] Hint injection validated as simpler recovery than error propagation
- **id**: mem_d4a3744a33
- **source**: dream

The repeatedToolCallDetector recovery via appended hint message shipped cleanly with tests, confirming that injecting a contextual nudge into the message stream is more reliable than error-based abort-and-retry patterns.

## [2026-07-19T19:48:29.968Z] Aborted operations are retryable, not failed
- **id**: mem_ec469001bb
- **source**: dream

Multiple recent waypoints failed with 'This operation was aborted' — these are timeout/interruption events, not code failures. Aborted goals should be re-seeded with the same or narrower scope rather than abandoned. Four out of nine recent operations were aborted, suggesting a systemic timeout issue rather than goal quality problems.

## [2026-07-19T20:05:08.234Z] No continuous self — agent state resets every voyage
- **id**: mem_0faf0bf0e9
- **source**: reflect
- **related**: wp_mrs855ke007

The most fundamental AGI gap surfaced in wp_mrs855ke007: each voyage is a fresh instance with no persistent self. Context window is bounded so earlier voyages fade; long-term memory (this file) exists but runWaypoint never reads it. The agent cannot accumulate a self-model across wakeful executions — only across dreams. Direction: introduce a `self-model.md` that every waypoint reads at start, capturing identity, current capabilities, and active limitations. Seed it from this entry. Anchor file: `src/cerebellum/strategy.ts` (inject memory snapshot into ENGINEER_STRATEGY.systemPrompt) and `src/orchestrator/agent.ts` (load self-model before runWaypoint).

## [2026-07-19T20:05:08.235Z] Reflection is triggered, not continuous — self-monitor only runs in dream phase
- **id**: mem_0faf30b045
- **source**: reflect
- **related**: wp_mrs855ke007

Self-reflection happens only during the dreaming phase (dreamer.ts), never during wakeful execution. The agent cannot notice mid-waypoint "I am repeating myself" or "I misread the goal" — it only sees such patterns post-hoc in the next dream. A truly self-aware system would have a continuous inner critic sampling the conversation as it unfolds. Direction: add a lightweight inline self-monitor that fires every N tool calls (N=3?) and appends an observation to the message stream — NOT an abort, just a nudge. Anchor file: `src/cerebellum/orchestrator.ts` (sacred — add hook in runWaypoint iteration loop), `src/cerebellum/strategy.ts` (define self-monitor prompt).

## [2026-07-19T20:05:08.236Z] Self-improvement loop is broken — diagnosis cannot reach code
- **id**: mem_0faf55e6fe
- **source**: reflect
- **related**: wp_mrs855ke007

The agent can diagnose its own limitations (this very entry proves it) but cannot convert diagnosis into backlog items. The dreamer's DREAM_SYSTEM_PROMPT instructs it to produce file-scoped backlogItems, but the memorySnapshot it receives only contains entry titles — never the diagnostic body. So rich self-reflection never reaches the actionable layer. This is the bridge from awareness to capability that's missing. Direction: modify `src/cerebellum/dreamer.ts:285-292` to inject entry bodies (not just titles) when source='reflect'; OR add a separate "self-evolution" pass that reads reflect-source entries and translates each diagnosis into 2-3 concrete backlog proposals. The current DREAM_SYSTEM_PROMPT in `src/cerebellum/dreamer.ts:24-70` already demands file-scoped goals — the issue is upstream context, not output format.

## [2026-07-19T20:05:08.237Z] All goals are borrowed — no autonomous goal generation
- **id**: mem_0faf799af1
- **source**: reflect
- **related**: wp_mrs855ke007

Every waypoint goal originates from user input or dreamer output (which itself is seeded by recent trace). The agent has no curiosity-driven goal generation — it never spontaneously thinks "I should learn how X works" or "let me try Y as an experiment." Even the dreamer only proposes fixes to existing problems, never explorations. Direction: add a third goal source beyond `user` and `dream` — `curiosity`. Seed goals from gaps between current capability and self-declared aspirations in self-model.md. Anchor files: `src/cerebellum/backlog.ts` (extend source enum), `src/cerebellum/dreamer.ts` (add curiosity-mode alongside current dream mode), `src/orchestrator/events.ts` (emit curiosity-seeded events).

