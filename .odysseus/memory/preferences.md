## [2026-07-21T05:15:20.900Z] Curiosity prefers testable pure functions over wiring changes
- **id**: mem_1999c487a6
- **source**: dream

When an aspiration's natural home is orchestrator.ts (safety perimeter), the smallest safe step is to extract the decision logic into a standalone module with unit tests. Wiring into orchestrator can be a separate manual-review task. This keeps curiosity productive without blocking on the perimeter.

## [2026-07-21T05:49:02.193Z] After a successful exploration, target the adjacent layer in the same aspiration
- **id**: mem_3871713ec7
- **source**: dream

When dream-gate.ts shipped, the natural next step was voyage-state.ts (the counter it reads), not jumping to an unrelated aspiration. Following the dependency chain within one aspiration builds momentum and produces coherent subsystems rather than scattered modules.

## [2026-07-21T06:33:57.810Z] Wire shipped pure functions immediately after state layer
- **id**: mem_619332e688
- **source**: dream

When a pure-function exploration ships (e.g. dream-gate.ts, exploration-feedback.ts), the highest-value next exploration is either the state layer (voyage-state.ts) or the wiring call in the consuming module. This follows the pure-function → state → wiring decomposition and prevents created-but-unwired invisible failures.

