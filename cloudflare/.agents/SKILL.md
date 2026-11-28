---
name: cloudflare
description: Set up Cloudflare Tunnel, Access, and the one shared agent service token.
---

Call `cloudflare.setup`, then `cloudflare.check`. Use `cloudflare.access` for the Access gate and `cloudflare.auth` for the service token. Use `cloudflare.logs` for the host log stream. Use `cloudflare.admin` for the login-keychain API token state. Do not print the tunnel token, the service token, the API token, or a JWT.

The API token is the macOS login keychain item service `cloudflare`, account `default`. `cloudflare-api` calls the API with that token and needs a verified Access JWT. It does not accept the token as an argument.

If `cloudflare.admin` says the item is absent or unusable, the user stores a real API token by calling `cloudflare-token`. That prompts them. Do not pass the token as an argument and do not ask them to paste it.

The log Durable Object uses the same Access team domain and audience as MCP. One Access application covers both. Do not add a second audience.

Access is required for a non-loopback MCP bind and for every destructive tool, including on loopback. Agents share one Access service token. The seat limits are in `cloudflare/policy.json` and must match `.agents/mesh.json`.
