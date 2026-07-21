## [2026-07-21T05:15:20.900Z] Curiosity prefers testable pure functions over wiring changes
- **id**: mem_1999c487a6
- **source**: dream

When an aspiration's natural home is orchestrator.ts (safety perimeter), the smallest safe step is to extract the decision logic into a standalone module with unit tests. Wiring into orchestrator can be a separate manual-review task. This keeps curiosity productive without blocking on the perimeter.

