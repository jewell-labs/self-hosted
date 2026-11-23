# self-hosted

Public recipes for a machine that runs its own tools: a llama.cpp server, decision-modality models, a Cloudflare tunnel, and one MCP server. Any agent, on any machine, starts with `discover` and one prompt, then uses the mesh tools for each plugin.

`discover` returns this host, every plugin, whether that plugin fits the host, the setup commands, the validate commands, and the setup prompt. The prompt is [`prompts/setup-host.md`](prompts/setup-host.md). Plugin tools live in [`plugins/<id>/.agents`](.agents/README.md). Infra-wide tools live in [`.agents/`](.agents/README.md).

```sh
node bin/discover.mjs
node mcp/server.mjs   # 127.0.0.1:8473
```

Call the tools over streamable HTTP `POST /mcp`. `node bin/discover.mjs` prints the same JSON as the `discover` tool.

## Plugins

| id | What it does on this host |
|---|---|
| `baseline` | Writes the host facts the tool just reported. |
| `mcp` | Writes the loopback unit and checks the mesh, including a Cloudflare Access rejection. |
| `llama` | Selects a llama.cpp 1.0 argv. On a 24–40GB Apple Silicon Mac that is the M1 Max Studio profile: 8 performance cores, Metal, Flash Attention, q8_0 KV, context 8192, one slot. Linux uses a CPU profile, or CUDA when `SELFHOST_NVIDIA=1`. |
| `decision` | Models whose output modality includes `decisions`. Under 64GB they stay on the one router. A second process is recorded only at 64GB and above. |
| `cloudflared` | Unit that reads `~/.cloudflared/token` (mode `0600`). The token is not stored here. |
| `sshd` | Userland `sshd` on `127.0.0.1:2222`, passwords off, Cloudflare Access SSH CA. The CA and keys stay in `~/.ssh/userland`. |
| `github-repos` | Syncs the repos in `github-repos/config`. `interval_seconds` in that file is how often the LaunchAgent runs. |
| `agent-desktop` | Installs agent-desktop 1.3.1, including `sandbox`. The first macOS guest needs a person to grant Accessibility. |
| `agent-browser` | Installs agent-browser 0.43.0. `agent-browser install` downloads Chrome for Testing into the user directory. |
| `actions-runner` | Refuses to install when the GitHub repo is public. Set `ALLOW_PUBLIC_REPO_RUNNER=1` only if you accept pull-request code on that machine. |
| `simulators` | Claims every available iOS simulator. A Linux host, or a Mac without simulators, records an empty list. |
| `portless` | Pins Portless 0.18.1 and the host proxy, CA, and guest port. Apps share one proxy. |

Setup and validate go through Nix. The package versions are in `catalog/pins.json`. See [`nix/README.md`](nix/README.md).

```sh
nix run .#setup-mcp
nix run .#check-mcp
nix flake check
```

Weights, tunnel tokens, and runner tokens stay outside this repository.

On macOS, install the selected llama.cpp profile as a user LaunchAgent:

```sh
SELFHOST_MODELS_DIR=/path/to/gguf node bin/install-darwin-llama.mjs
```

## Cloudflare Access

`mcp/server.mjs` binds `127.0.0.1` unless both `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set. With those set, every `/mcp` request needs a valid `Cf-Access-Jwt-Assertion` (RS256, issuer `https://<team>`, audience `CF_ACCESS_AUD`, keys from `https://<team>/cdn-cgi/access/certs`). A destructive tool needs that JWT even when the bind is loopback and Access is not required for other tools. JWKS responses are cached in the process for 10 minutes. Put Cloudflare Tunnel and an Access application in front of the port. Agents use one shared Access service token so they do not take a user seat each. The numbers are in `.agents/mesh.json`. Loopback without those variables is for local read-only setup only.

## Proof

`proof/prove.mjs` starts an Apple container, reads `discover` inside it, asks a local llama.cpp server to follow `prompts/setup-host.md`, and runs the selected setup and validate commands in the container.

```sh
container system start --enable-kernel-install
node proof/prove.mjs
```

`LLAMA_URL` defaults to `http://127.0.0.1:8080`. `LLAMA_MODEL` defaults to `clairic-flash-Q4_K_M`.

## Layout

- `catalog/plugins.json` — plugin ids and the exact commands
- `lib/` — host matching, llama profiles, Access JWT check, mesh loader
- `.agents/` — infra MCP tools, skills, language servers, and Access limits
- `plugins/<id>/.agents/` — that plugin's MCP tools and skill
- `prompts/setup-host.md` — the only setup prompt
- `plugins/cloudflared/run-tunnel.sh` — token file wrapper
