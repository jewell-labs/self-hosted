---
name: doctor
description: Check this host's agent mesh, repos, Cloudflare files, and GitHub workflows.
---

Call `doctor` before changing `.agents`, a plugin's `.agents`, or a workflow. Omit `level` for `strict`. `shape` is the narrow level.

`shape` checks this repo's catalog, tool declarations, skills, `home/policy.json`, and `events/event.json` plus each plugin webhook. Strict also checks that `~/.self-hosted` has only the allowed directories and no `node_modules`. `mesh` adds that MCP and LSP agree and that other repos' tools stay unexecuted. `repos` checks every checkout in `github-repos/config`. `strict` adds Cloudflare file layout, worker Access limits, and workflow runners.

A public repository stays on a GitHub-hosted runner. Any other repository uses `self-hosted` unless the `runs-on` line is marked `public-repo`. The doctor lists another repo's tools and does not run them. It does not read the tunnel token. It reports whether the login-keychain API token is usable and does not print it.
