---
name: llm-model-recommender
description: Recommend at most one llm weight, sample it against the fleet, and keep or remove it.
---

Call `llm.models`, `llm.usage`, and `llm.config` before choosing. `core/home/policy.json` is the disk reserve and the probe text. Read a current public leaderboard and record its URL and the date. Do not invent a score.

Recommend at most one GGUF that fits `freeBytes - reserveBytes` and this host's `llmProfile`. Download it with `llm.download` from a Hugging Face `org/name` only.

Call `llm.sample` with `seed` set to the UTC hour plus the file name. The tool runs the two policy probes on that file and at most two other llm weights. It does not start the server.

`keep: false` means call `llm.remove` on the downloaded file before you finish. `keep: true` means leave it. Call `llm.remove` on a fleet file only when `replace` names it. Do not remove a decision weight.
