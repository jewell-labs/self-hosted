# Package principles

These principles were written after reviewing the checkout. They are the rule every package follows.

The reviewed root held `bin`, `catalog`, `lib`, `nix`, `runtime`, `githooks`, `test`, `prompts`, `home`, `events`, `proof`, `mcp`, `github-repos`, and `plugins`, plus the plugin directories `baseline`, `decision`, `llm`, `cloudflare`, `sshd`, `agent-desktop`, `agent-browser`, `actions-runner`, `simulators`, `portless`, `work`, `evals`, and `containers`. `core` is the package those shared areas moved into: `bin`, `catalog`, `lib`, `runtime`, `test`, `prompts`, `home`, and `events`. The children of `plugins` are now their own packages. `mcp` and `github-repos` absorbed the copies that used to live under `plugins/`. `nix`, `githooks`, and `proof` stayed top-level packages.

1. The repo root has two files, `README.md` and `AGENTS.md`. Every other root entry is a directory. A directory whose name starts with a dot may be tracked or untracked. Every other top-level directory is one package.
2. A package has its own `README.md` and `AGENTS.md`. It can set itself up and tear itself down. An agent follows that package's `AGENTS.md`.
3. A package keeps its dependencies inside its own directory. `core` is the only shared dependency a package may import. `core` does not statically import another package. Calls into a plugin go through a dynamic import of that package's `tools.mjs`.
4. Assets are installs, downloads, and heavy files. `plugin.json` names them apart from the code. A home asset lives under the self-hosted home. A package asset stays in the package tree. `llm` keeps `models`. `agent-desktop` and `containers` keep the whole home directory. `core` keeps `runtime/txiki` and `runtime/syncio.dylib`. Teardown deletes `run/` and does not delete an asset.
5. Every package declares events, and the events include the base healthcheck. Setup records that healthcheck as ok. Teardown reports the package down.
6. `core` is the minimum needed to add a plugin and to set one up from an existing install. `core/bin/setup-existing.mjs` does that. It does not remove files that are already installed.
7. `githooks` stays a top-level package so a checkout can keep `core.hooksPath` at `githooks`. Ignore rules live in `core/gitignore` and `core/runtime/.gitignore` because the root cannot hold `.gitignore`.
8. The `nix` package may name sibling packages. `flake.nix` lives in `nix/` so the root stays two files, and a pure Nix evaluation cannot see the rest of the repo from that subdirectory. That is the one exception, and it is Nix, not JavaScript. JavaScript imports stay inside the package or `core`.
9. A package keeps its assets in its own tree or its own home directory. It does not symlink an asset to another install. The containers store is `~/.self-hosted/containers`. It is not `~/Library/Application Support/com.apple.container`, and the package does not leave a symlink there.
