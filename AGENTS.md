# Agents

This repository sets up a host. It is not one machine. The Mac Studio profile is one match among others. Do not add a path, username, hostname, model filename, or tunnel token that only exists on one computer.

## Start here

1. Run `node bin/discover.mjs` or call the MCP tool `discover`.
2. Follow `prompts/setup-host.md` and the commands in that result. Do not invent flags, ports, or plugins.
3. Select a plugin only when `applicable` is true. A proof selects the plugins that are both `applicable` and `proofRequired`.
4. A plugin is done when every `validate` command exits 0.

`node mcp/server.mjs` serves `discover` on `127.0.0.1:8473`. It refuses any other bind unless `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set. With those set, `/mcp` requires a Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`, RS256, issuer `https://<team>`, audience `CF_ACCESS_AUD`).

## Do not

- Commit a token, key, registration token, or Access private key. `~/.cloudflared/token` is mode `0600` and stays outside git.
- Install `actions-runner` on a public repository. Pull requests would run on the host. The setup command exits 1 unless `ALLOW_PUBLIC_REPO_RUNNER=1`.
- Start a second llama.cpp process when the discover result says `secondProcess` is false (hosts under 64GB).
- Treat `bin/install-darwin-llama.mjs` as the Linux or Jetson install. Linux uses the profile `discover` already rendered.

## Checks

```sh
node --test test/*.test.mjs
node bin/setup.mjs baseline && node bin/check.mjs baseline
node bin/setup.mjs mcp && node bin/check.mjs mcp
```

`proof/prove.mjs` runs the same prompt inside an Apple container against a local llama.cpp server. `LLAMA_URL` and `LLAMA_MODEL` select that server. The container must not contain this machine's weights or tokens.

## What this repo does not run

Product apps (Flag Seeker, SkiHerd, auth) have their own repositories and their own `AGENTS.md`. This repo does not deploy them.
