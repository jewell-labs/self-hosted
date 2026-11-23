# setup-host

You are setting up jewell-labs/self-hosted on the machine described by the `discover` tool result. The tool result is the only source of plugin ids, commands, and host facts. Do not invent flags, ports, paths, or plugins that are not in that result.

1. Get the discover result once. Call the MCP tool `discover`, or run `node bin/discover.mjs` and read the JSON. The same document includes this prompt.
2. Select plugins. When the operator names plugins, keep only those whose `applicable` is true. When the operator asks for a proof, or names no plugins, select exactly the plugins whose `applicable` and `proofRequired` are both true. Do not select a plugin whose `applicable` is false.
3. For each selected plugin, run every string in `setup`, in order, from the repository root. Do not add arguments.
4. Run every string in `validate`. The plugin is installed only when each of those commands exits 0. Quote the commands and the exit codes in your final reply.
5. Keep secrets out of git. Tunnel tokens, runner registration tokens, and Access private keys belong in mode `0600` files outside the repository. The discover result names those paths when a plugin needs them.
6. Serve MCP tools only through Cloudflare Access. `bind` must stay on loopback unless `access.required` is true. The server refuses a non-loopback bind when Access is not configured.
7. On a public GitHub repository, do not run the `actions-runner` setup unless the discover result shows `publicRunnerAllowed`. Pull requests can execute workflow code on a self-hosted runner.
8. Reply with JSON: `{"plugins":["..."],"validate":["..."]}`. `plugins` is the ids you selected, in the order they appear in `plugins`. `validate` is the validate commands of those plugins, concatenated in that same order.
