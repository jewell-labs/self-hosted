# Commands for this checkout and the repos named in github-repos/config.
# `just --list` is the index. None of these start a standing MCP server.

# This host's discover JSON. Same document as the MCP tool.
discover:
    node bin/discover.mjs

# Node tests.
test:
    node --test test/*.test.mjs

# Doctor. level is shape, mesh, repos, or strict.
doctor level="strict":
    node bin/doctor.mjs "{{level}}"

# Nix evaluation. Does not start services.
flake:
    nix flake check

# Record one catalog plugin. id matches nix/packages.nix.
setup id:
    nix run ".#setup-{{id}}"

# Validate one catalog plugin.
check id:
    nix run ".#check-{{id}}"

# Repo list and sync interval from github-repos/config.
repos:
    bash github-repos/ghref print-config

# This checkout and each mirrored repo: path, HEAD, dirty, top-level names. No fetch.
explore:
    node bin/explore.mjs

# Mirror github-repos/config, then lock the reference tree read-only.
sync:
    bash github-repos/ghref

# Container proof. Requires LLAMA_MODEL. Does not copy this machine's weights or tokens.
prove:
    node proof/prove.mjs

# Remove this account's self-hosted state. Keeps models, llm, decision, containers, and agent-desktop.
nuke:
    node bin/nuke.mjs

# Remove models, containers, and agent-desktop too.
nuke-all:
    node bin/nuke.mjs --all

# Move an older layout into ~/.self-hosted and leave symlinks behind.
adopt:
    node bin/adopt.mjs

# Store the Cloudflare API token in the login keychain. Prompts in the terminal. The token is not an argument.
cloudflare-token:
    node bin/cloudflare-token.mjs

# Call the Cloudflare API with the login-keychain token. method and path only. A JSON body is a file path, not the token.
cloudflare-api method path file="":
    node bin/cloudflare-api.mjs {{ quote(method) }} {{ quote(path) }} {{ quote(file) }}
