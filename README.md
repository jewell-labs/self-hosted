# self-hosted

Public recipes for a machine that runs its own tools: a llama.cpp server, decision-modality models, a Cloudflare tunnel, and one MCP server. Any agent, on any machine, starts with one tool and one prompt.

The MCP tool is `discover`. It returns this host, every plugin, whether that plugin fits the host, the setup commands, the validate commands, and the setup prompt. The prompt is [`prompts/setup-host.md`](prompts/setup-host.md). An agent runs the commands from the tool result and does not invent its own.

```sh
node bin/discover.mjs
node mcp/server.mjs   # 127.0.0.1:8473, tool: discover
```

Call `discover` over streamable HTTP `POST /mcp`. The same JSON is printed by `node bin/discover.mjs`.

## Plugins

| id | What it does on this host |
|---|---|
| `baseline` | Writes the host facts the tool just reported. |
| `mcp` | Writes the loopback unit and checks the tool, including a Cloudflare Access rejection. |
| `llama` | Selects a llama.cpp 1.0 argv. On a 24–40GB Apple Silicon Mac that is the M1 Max Studio profile: 8 performance cores, Metal, Flash Attention, q8_0 KV, context 8192, one slot. Linux uses a CPU profile, or CUDA when `SELFHOST_NVIDIA=1`. |
| `decision` | Models whose output modality includes `decisions`. Under 64GB they stay on the one router. A second process is recorded only at 64GB and above. |
| `cloudflared` | Unit that reads `~/.cloudflared/token` (mode `0600`). The token is not stored here. |
| `sshd` | Userland `sshd` on `127.0.0.1:2222`, passwords off, Cloudflare Access SSH CA. The CA and keys stay in `~/.ssh/userland`. |
| `actions-runner` | Refuses to install when the GitHub repo is public. Set `ALLOW_PUBLIC_REPO_RUNNER=1` only if you accept pull-request code on that machine. |

Setup and validate:

```sh
node bin/setup.mjs mcp
node bin/check.mjs mcp
```

Weights, tunnel tokens, and runner tokens stay outside this repository.

On macOS, install the selected llama.cpp profile as a user LaunchAgent:

```sh
SELFHOST_MODELS_DIR=/path/to/gguf node bin/install-darwin-llama.mjs
```

## Cloudflare Access

`mcp/server.mjs` binds `127.0.0.1` unless both `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set. With those set, every `/mcp` request needs a valid `Cf-Access-Jwt-Assertion` (RS256, issuer `https://<team>`, audience `CF_ACCESS_AUD`, keys from `https://<team>/cdn-cgi/access/certs`). Put Cloudflare Tunnel and an Access application in front of the port. Loopback without those variables is for local setup only.

## Proof

`proof/prove.mjs` starts an Apple container, reads `discover` inside it, asks a local llama.cpp server to follow `prompts/setup-host.md`, and runs the selected setup and validate commands in the container.

```sh
container system start --enable-kernel-install
node proof/prove.mjs
```

`LLAMA_URL` defaults to `http://127.0.0.1:8080`. `LLAMA_MODEL` defaults to `clairic-flash-Q4_K_M`.

## Layout

- `catalog/plugins.json` — plugin ids and the exact commands
- `lib/` — host matching, llama profiles, Access JWT check
- `prompts/setup-host.md` — the only setup prompt
- `plugins/cloudflared/run-tunnel.sh` — token file wrapper
