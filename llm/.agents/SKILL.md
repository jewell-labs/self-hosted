---
name: llm
description: One llama.cpp server for this host. One resident model.
---

Call `llm.setup`, then `llm.check`. Use the `llmProfile` from discover. Weights belong in the shared `~/.self-hosted/models/gguf` library. `llm-model-recommender` downloads, samples, and removes llm weights. `home/policy.json` is the allowed home and the disk reserve.
