---
name: decision
description: Register and call local decision models and compound models.
---

Call `decision.setup`, then `decision.check`. `decision.models` lists the registry. `decision.call` runs one model, or walks a compound model's steps in order.

The registry is `decision/catalog.json` plus `~/.self-hosted/decision/catalog.json` when that file exists. A model is `{ "id", "kind": "model", "file" }` with a `.gguf` name in the llm plugin's `~/.self-hosted/llm/models/gguf` library. A compound is `{ "id", "kind": "compound", "steps" }` naming other ids. Steps may themselves be compounds. The registry is not capped.

`slots` on the discover result is how many decision models can be resident beside the llm server. The router is a separate llama.cpp process on port {decision}. It reads the same weight library as the llm server and it does not replace that server. Adding a model is a catalog line, not a new plugin. Do not copy a weight into a second directory. `decision-model-recommender` downloads, samples, and removes decision models. `core/home/policy.json` is the allowed home and the disk reserve.
