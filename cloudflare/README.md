# cloudflare

Tunnel, Access, the shared service token, and the host log. `policy.json` is the seat limits and must match `.agents/mesh.json`. `unit.mjs` is the recorded state. `worker.mjs` is the log Durable Object, one SQLite instance named `host`.

One Access application. The log uses the same `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` as MCP. Do not add a second audience.

`run-tunnel.sh` refuses a token file that is not mode `0600` and does not put the token in argv. The paths are the ones `unit.mjs` records.

`wrangler.jsonc` does not deploy and does not set `SELFHOST_LOG_DEV`. That variable is only for a local `wrangler dev`. Mesh calls publish to `SELFHOST_LOG_URL` with `detail` of `ok` or `error`. A failed publish does not fail the tool.

The admin API token is the login keychain item service `cloudflare`, account `default`. `cloudflare.admin` reports that state and does not return the token. `cloudflare-api` calls `api.cloudflare.com` with it and needs a verified Access JWT. The token is not an argument. A JSON body is the request body. Responses drop token fields.

If that item is absent or unusable, the user calls `cloudflare-token`. The token is typed at a prompt and is not an argument.

Plugin setup is `cloudflare.setup`.

## Lifecycle

Set yourself up with `node cloudflare/setup.mjs`. Tear yourself down with `node cloudflare/teardown.mjs`. Teardown leaves assets in place. The base event is the healthcheck. Dependencies live in this directory, except `core/`.
