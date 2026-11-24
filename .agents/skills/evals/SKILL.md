---
name: evals
description: Run isolated evals for the llm and the decision models. Every coding harness is graded the same way.
---

Call `evals.list` before `evals.run`. `llm-hierarchy` checks that every harness keeps the self-hosted agents instructions ahead of its own. `decision-core` uses the catalog decision model and does not start the decision router. Watch `GET /events?plugin=evals&type=eval`.
