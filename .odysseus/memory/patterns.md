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

