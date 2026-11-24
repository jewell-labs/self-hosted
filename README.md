# self-hosted

A host runs its own tools. This repo is the catalog, the mesh, and the setup prompt. It is not one machine.

`just --list` is the command list. `catalog/plugins.json` is the plugins. `prompts/setup-host.md` is the only setup prompt. `lib/paths.mjs` is where bytes live, under `~/.self-hosted`.

`just discover` prints this host. `just explore` prints this checkout and every mirrored repo, without fetching. `just doctor` reviews the mesh. `just test` runs the node tests.

`grok`, `claude`, `codex`, and `pi` are wrappers. Each one asks for a project, then clones it under `~/.self-hosted/work`. A new harness is `work/harnesses/<id>.json`. Its probe is the test. `GET /events?type=harness` streams that CLI's own event lines.

Call the MCP tool `discover` when the mesh is already up. Do not start `node mcp/server.mjs` unless you were asked to serve it. It binds `127.0.0.1:8473`.

Access, when configured, is one team domain and one audience for MCP and the log. Tokens, keys, and weights stay outside git. `just nuke` removes this account's state and keeps models, containers, and agent-desktop.

`just prove` needs `LLM_MODEL` or `LLAMA_MODEL`, and a container. The container must not contain this machine's weights or tokens.
