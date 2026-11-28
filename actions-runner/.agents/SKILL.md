---
name: actions-runner
description: Register a GitHub Actions runner. Refuses a public repo unless the operator overrides it. Requires a Cloudflare Access JWT.
---

Call `actions-runner.setup` only when `discover` shows `publicRunnerAllowed`. The tool is destructive and needs a Cloudflare Access JWT.
