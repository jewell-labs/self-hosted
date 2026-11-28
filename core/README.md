# self-hosted

A host runs its own tools. This repo is the packages, the mesh, and the setup prompt. It is not one machine.

Each package is a top-level directory with `plugin.json`. `core/prompts/setup-host.md` is the only setup prompt. `lib/paths.mjs` is where bytes live, under `~/.self-hosted`.

Local dev starts the mesh with `core/bin/selfhost mcp/server.mjs` on port {mcp}. Portless assigns the socket. Host work is a tool on that server. `discover` prints this host. `explore` prints this checkout and every mirrored repo, without fetching. Plugin tools write `logs/events.jsonl`. `events.history` reads that log. `events.describe` is the validation. `evals.report` reads how models are doing.

`grok`, `claude`, `codex`, and `pi` are wrappers. Each one asks for a project, then clones it under `~/.self-hosted/work`. A new harness is `work/harnesses/<id>.json`. Its probe is the test. `GET /events?type=harness` streams that CLI's own event lines.

Tool scripts run on txiki.js 26.11.0 through `core/bin/selfhost`. Linux has no upstream zip; the Nix package builds tag v26.11.0. A proof or eval container needs `SELFHOST_TJS`.

`githooks/pre-commit` is the check. It prints a profile with the milliseconds, status, and share of time for each stage. A failure prints `FAIL`, the check name, the file and line, the error, and the fix. The stages refuse `actions-runner` on this public repo, run `node --test`, and report a syntax error, trailing whitespace, a missing final newline, or an unused export.

Call `discover` on that server.

Access, when configured, is one team domain and one audience for MCP and the log. Tokens, keys, and weights stay outside git. Each package uninstalls itself with `uninstall.mjs` and leaves the paths in its `cleanup.json`. `disk` prints every directory at or above 1 GB and exits 0 when the owned store is under this home.

`prove` needs a model id and a container. The container must not contain this machine's weights or tokens.

`attach-plan` prints one mount of this home, including `llm/models/gguf`, for an Apple container and for a macOS sandbox share. A filter JSON keeps the listed model files and skills and leaves the rest out. The guest sees the library files. It does not get a second copy. `attach-run` starts the container. `attach-macos` fills that sandbox's share and does not start the VM. The Apple container store is `~/.self-hosted/containers`. Those commands set `CONTAINER_APP_ROOT` to that directory.

## Lifecycle

Set yourself up with `node core/setup.mjs`. Tear yourself down with `node core/teardown.mjs`. Teardown leaves assets in place. The base event is the healthcheck. Dependencies live in this directory, except `core/`.
