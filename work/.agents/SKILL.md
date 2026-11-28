---
name: work
description: Clone a project into a short-lived work directory and stream a coding harness from there. A new harness is a json descriptor.
---

Call `work.list` for the projects in `github-repos/config` and the live directories under `~/.self-hosted/work`. Call `work.create` to clone `main` (or `branch`) into `{project}-{harness}-{domain}-{slug}`.

`harness.list` reads `work/harnesses/*.json` and probes each command. A descriptor is ready when its probe exits 0 and the output contains `expect`. Drop in a new file to add a harness. Do not add a one-off code path.

`harness.run` takes `transport` `cli` or `acp`, `cwd` inside the work root, `prompt`, and optional `model`, `env`, `agents`, `args`, and `capabilities`. `env` is a string map. `args` is a string array. The tool does not join them into a shell command. Stdout and stderr lines are published as harness events. `body` is the raw line. Filter `GET /events?type=harness&name=<id>`.

`work.create` and `harness.run` are destructive and need a Cloudflare Access JWT.
