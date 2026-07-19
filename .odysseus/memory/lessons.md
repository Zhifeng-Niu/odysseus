## [2026-07-19T10:58:08.967Z] Non-coding goals waste full iteration budgets
- **id**: mem_06b9c70ab4
- **source**: dream

Conversational inputs like 'hi' or '你好，你是谁' were dispatched to the agent, which then spent all 16 iterations producing chat responses without tool use. Goals should be validated for actionable coding intent before agent dispatch.

## [2026-07-19T11:00:11.293Z] Non-coding goals masquerade as agent convergence failures
- **id**: mem_08979d7f37
- **source**: dream

Goals like 'hi' or '你好' fail with 'agent did not converge' but the real issue is that the goal should never have entered the pipeline. Always validate goal intent before execution; the error message should say 'non-coding goal' not 'maxIterations exceeded'.

