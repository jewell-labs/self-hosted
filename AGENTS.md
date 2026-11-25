# Agents

This repository sets up a host. It is not one machine. Do not add a path, username, hostname, model filename, or token that only exists on one computer.

`prompts/setup-host.md` is the only setup prompt. Start the local mesh with `bin/selfhost mcp/server.mjs` on port {mcp}. Portless assigns the socket. Host work is an MCP tool on that server: `discover`, `doctor`, `<id>.setup`, `<id>.check`, `<id>.uninstall`, `flake`, `repos`, `explore`, `sync`, `prove`, `attach-plan`, `attach-run`, `attach-macos`, `nuke`, `nuke-all`, `adopt`, `cloudflare-token`, and `cloudflare-api`.

A proof, or a named plugin list, skips questions. A person who has not chosen is asked which applicable plugins this host should run. Use that discover result's `llmProfile` and decision `slots`. Select a plugin only when `applicable` is true. A proof selects plugins that are both `applicable` and `proofRequired`. That set includes `portless`. Finish a plugin with `<id>.setup` and `<id>.check`. Setup writes only under `~/.self-hosted/<id>`. `<id>.uninstall` deletes that folder. `flake` runs `nix flake check`.

`.agents/` is the mesh every repo on this host uses. Call `doctor` before changing it. The default level is `strict`. A plugin's tools are `plugins/<id>/.agents`. The skill in `.agents/skills/<id>` is the one to follow. Other repos in `github-repos/config` are listed and their tools are not executed. `explore` shows those checkouts.

The `cloudflare` plugin owns Access, the shared service token, and the log. One team domain and one audience cover MCP and the log. `policy.json` must match `.agents/mesh.json`.

`events/event.json` is the one event schema. A plugin webhook is that plugin's `event.json`. Every plugin MCP tool writes an event. `logs/events.jsonl` in the self-hosted home is the history, and `events.history` reads it anywhere that home is. `events.describe` is how this system describes and validates itself: a plugin is ok when every latest event for it is ok. The evals plugin judges models. `evals.run` writes eval events, the routine keeps doing that, and `evals.report` reads them. Agents watch `GET /events` and filter by `plugin`, `type`, and `name`. The stream stays in the MCP process, including a sandbox with no Cloudflare. The log page at `/log` calls `events.webhooks` and opens the stream that tool returns. EventSource sends cookie `CF_Authorization`. A query string is not a token.

## Do not

- Commit a token, key, registration token, or Access private key. Weights, Apple container images, and the agent-desktop sandbox stay in `~/.self-hosted`. `nuke` removes the rest and checks that the LaunchAgents are gone. `nuke-all` removes models, llm, decision, containers, and agent-desktop too.
- Install `actions-runner` on a public repository. The setup exits 1 unless `ALLOW_PUBLIC_REPO_RUNNER=1`.
- Copy a GGUF into a second directory. `llm` and `decision` both read `~/.self-hosted/models/gguf`. The decision router stays its own process.
- Write a self-hosted file outside `~/.self-hosted`. `home/policy.json` is the allowed list, the disk reserve, and the probe text.
- Treat the macOS llm LaunchAgent as the Linux install. Linux uses the profile discover rendered.
- Put a repo name or a sync interval anywhere except `github-repos/config`.
- Add a plugin outside Nix. CLI versions are `catalog/pins.json`.

## Events

There is no test suite. `<id>.check` reads the unit `<id>.setup` wrote. The event log is the validation, the description, and the record. `prove` needs a model id and does not mount this machine's weights or tokens. Local dev starts the mesh with `bin/selfhost mcp/server.mjs` on loopback.
