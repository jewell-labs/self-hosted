---
name: portless
description: Name local web apps on one Portless proxy so checkouts, agent-browser, agent-desktop, and simulators share stable .localhost URLs.
---

Call `portless.status` and `portless.urls`. Do not guess a port or a hostname. The first service in `portless.urls` is the guest app. A `guest down` line means there is no VM bridge, so agent-browser stays on the host URL.

The proxy is HTTPS. Its CA is the `caFile` from `portless.status`. State stays in `~/.portless`. The guest listener is `portless.forward`, which is destructive and needs a Cloudflare Access JWT. App service names are arguments to `portless.urls`. This repo does not hardcode an app's name.

`portless doctor`, `portless list`, and `portless --help` are the CLI. Do not add a second Portless MCP server in an app repo.
