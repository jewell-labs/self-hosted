---
name: decision-model-recommender
description: Recommend at most one decision model, sample it against the fleet, and keep or remove it.
---

Call `decision.models`, `decision.usage`, and `decision.config` before choosing. `home/policy.json` is the disk reserve and the probe text. Read a current public leaderboard and record its URL and the date. Do not invent a score.

Recommend at most one GGUF that fits `freeBytes - reserveBytes` and the host's decision `slots`. `decision.download` writes it into the shared library and the host catalog at `~/.self-hosted/decision/catalog.json`. The repo catalog stays unchanged.

Call `decision.sample` with `seed` set to the UTC hour plus the model id. The tool runs the two policy probes on that model and at most two other decision models. It does not start the router.

`keep: false` means call `decision.remove` on the downloaded id before you finish. `keep: true` means leave it. Call `decision.remove` on another id only when `replace` names it. A compound that still names an id blocks removal.
