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

