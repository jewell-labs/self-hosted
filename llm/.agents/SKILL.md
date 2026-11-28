---
name: llm
description: One llama.cpp server for this host. One resident model.
---

Call `llm.setup`, then `llm.check`. Use the `llmProfile` from discover. This plugin owns the GGUF library at `~/.self-hosted/llm/models/gguf`. Decision reads that same directory. `llm-model-recommender` downloads, samples, and removes llm weights. `cleanup.json` is what `nuke` keeps. `core/home/policy.json` is the allowed home and the disk reserve.
