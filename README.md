# self-hosted

A host runs its own tools. This repo is the catalog, the mesh, and the setup prompt. It is not one machine.

`catalog/plugins.json` is the plugins. `prompts/setup-host.md` is the only setup prompt. `lib/paths.mjs` is where bytes live, under `~/.self-hosted`.

Local dev starts the mesh with `bin/selfhost mcp/server.mjs` on port {mcp}. Portless assigns the socket. Host work is a tool on that server. `discover` prints this host. `explore` prints this checkout and every mirrored repo, without fetching. Plugin tools write `logs/events.jsonl`. `events.history` reads that log. `events.describe` is the validation. `evals.report` reads how models are doing, and the routines tick keeps the evals running.

`grok`, `claude`, `codex`, and `pi` are wrappers. Each one asks for a project, then clones it under `~/.self-hosted/work`. A new harness is `work/harnesses/<id>.json`. Its probe is the test. `GET /events?type=harness` streams that CLI's own event lines.

Tool scripts run on txiki.js 26.11.0 through `bin/selfhost`. A warm-cache start on Apple silicon was about 8.5 ms, and the macOS arm64 binary is about 6 MB. Linux has no upstream zip; the Nix package builds tag v26.11.0. A proof or eval container needs `SELFHOST_TJS`.

Call `discover` on that server.

Access, when configured, is one team domain and one audience for MCP and the log. Tokens, keys, and weights stay outside git. `nuke` removes this account's state and keeps the paths in each plugin's `cleanup.json`. `nuke-all` removes those too.

`prove` needs a model id and a container. The container must not contain this machine's weights or tokens.

`attach-plan` prints one mount of this home, including `llm/models/gguf`, for an Apple container and for a macOS sandbox share. A filter JSON keeps the listed model files and skills and leaves the rest out. The guest sees the library files. It does not get a second copy. `attach-run` starts the container. `attach-macos` fills that sandbox's share and does not start the VM.
