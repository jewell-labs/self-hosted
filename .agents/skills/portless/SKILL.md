---
name: portless
description: Name local web apps on one Portless proxy so checkouts, agent-browser, agent-desktop, and simulators share stable .localhost URLs.
---

Call `portless.status` and `portless.urls`. Do not guess a port or a hostname. Host services are `port {mcp}`, `port {llm}`, `port {decision}`, and `port {sshd}`. The first service in `portless.urls` is the guest app. A `guest down` line means the Portless proxy is not up on the VM bridge, so agent-browser stays on the host URL.

The proxy is HTTPS. Its CA is the `caFile` from `portless.status`. State stays in `~/.self-hosted/portless`. `portless.forward` checks that proxy and needs a Cloudflare Access JWT. App service names are arguments to `portless.urls`. An app repo does not hardcode its own name.

`portless doctor`, `portless list`, and `portless --help` are the CLI. Do not add a second Portless MCP server in an app repo.
