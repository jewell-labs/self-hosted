# Agents

Infra-wide skills, MCP tools, and language servers live in this directory. This is the agent setup every repo and worker uses. A plugin's tools are `plugins/<id>/.agents` or `<id>/.agents`. A skill in `.agents/skills/<id>` is the one agents read.

`mcp/server.mjs` loads this tree plus `.agents` from every other checkout named in `github-repos/config`. Tools from those other repos are listed and not executed. A checkout that declares `mcpServers` is listed by server name, and this process does not spawn that command. This server does not proxy, and `endpointSuffixes` stays empty.

Agents call the mesh tools. A destructive tool needs a verified Cloudflare Access JWT on loopback and off it. Limits and the shared service-token rule are in `mesh.json` and `mesh.list`.
