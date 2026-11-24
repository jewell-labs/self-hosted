# Agents

This repository sets up a host. It is not one machine. Do not add a path, username, hostname, model filename, or token that only exists on one computer.

`just --list` is the command list. `prompts/setup-host.md` is the only setup prompt. Call MCP `discover` when the mesh is up; otherwise `just discover`.

A proof, or a named plugin list, skips questions. A person who has not chosen is asked which applicable plugins this host should run. Use that discover result's `llmProfile` and decision `slots`. Select a plugin only when `applicable` is true. A proof selects plugins that are both `applicable` and `proofRequired`. Finish a plugin with `<id>.setup` and `<id>.check`, or `just setup <id>` and `just check <id>`.

`.agents/` is the mesh every repo on this host uses. Call `doctor` before changing it. The default level is `strict`. A plugin's tools are `plugins/<id>/.agents`. The skill in `.agents/skills/<id>` is the one to follow. Other repos in `github-repos/config` are listed and their tools are not executed. `just explore` shows those checkouts.

The `cloudflare` plugin owns Access, the shared service token, and the log. One team domain and one audience cover MCP and the log. `policy.json` must match `.agents/mesh.json`.

`events/event.json` is the one event schema. A plugin webhook is that plugin's `event.json`: tool calls and the `ci` workflow. Agents watch `GET /events` and filter by `plugin`, `type`, and `name`. The stream stays in the MCP process, including a sandbox with no Cloudflare. The log page at `/log` calls `events.webhooks` and opens the stream that tool returns. EventSource sends cookie `CF_Authorization`. A query string is not a token.

## Do not

- Commit a token, key, registration token, or Access private key. Weights, Apple container images, and the agent-desktop sandbox stay in `~/.self-hosted`. `just nuke` removes the rest and checks that the LaunchAgents are gone.
- Install `actions-runner` on a public repository. The setup exits 1 unless `ALLOW_PUBLIC_REPO_RUNNER=1`.
- Copy a GGUF into a second directory. `llm` and `decision` both read `~/.self-hosted/models/gguf`. The decision router stays its own process.
- Write a self-hosted file outside `~/.self-hosted`. `home/policy.json` is the allowed list, the disk reserve, and the probe text.
- Treat the macOS llm LaunchAgent as the Linux install. Linux uses the profile discover rendered.
- Put a repo name or a sync interval anywhere except `github-repos/config`.
- Add a plugin outside Nix. CLI versions are `catalog/pins.json`.

## Checks

`just test` and `just flake`. `just prove` needs `LLM_MODEL` or `LLAMA_MODEL`. Do not start the MCP server on a machine that has not asked for it.
