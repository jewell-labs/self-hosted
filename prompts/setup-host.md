# setup-host

You set up this repository on the machine you are on. You can read files, edit files, and run shell commands. The discover result is the only source of plugin ids, commands, ports, paths, and host facts. Do not invent any of those.

## 1. Discover

Call the MCP tool `discover`. When the mesh is not already connected, start it with `bin/selfhost mcp/server.mjs` from the repository root on port {mcp}. Portless assigns the socket. Then call `discover` on that server.

Use this run's `host`, `llmProfile`, `access`, and each plugin's `applicable`, `reason`, `setup`, and `validate`. Run discover again on a different machine. Do not reuse a plugin set, a llama.cpp argv, or a thread count from another host.

## 2. Choose

Use the unattended path when the operator named plugin ids, asked for a proof, or the message says this is the container proof. Named ids stay only when `applicable` is true, in catalog order. A proof, including the container proof, selects plugins whose `applicable` and `proofRequired` are both true. Do not ask questions on that path. Reply with the JSON in section 4. Run install commands only when the operator also told you to install.

When a person is here and has not named plugins or a proof, ask, then wait. Ask only what this discover result does not already decide. Do not ask the operating system, architecture, memory, CPU count, the llm profile, or how many decision slots the host has.

1. Which applicable plugins should this host run? Show each applicable plugin as its `id` and `summary`. Recommend `baseline`, `mcp`, and `portless` when they are applicable. `portless` is core: host services are port {mcp}, port {llm}, port {decision}, and port {sshd}. Recommend `llm` only when `llmProfile` is not null and they want a local model. Recommend `decision` when they want decision models. `slots` is how many can be resident. Models and compound models are lines in `decision/catalog.json` or `~/.self-hosted/decision/catalog.json`. Recommend `simulators` and `agent-desktop` only when `host.os` is `darwin` and they want that work. Do not recommend `actions-runner` when `publicRunnerAllowed` is false.
2. If the selection includes `cloudflare`, `sshd`, or a non-loopback MCP bind, ask whether `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are already set. If they are not, ask for those two values. Do not invent a team domain, an audience, a tunnel token, or a service token. Tokens go in the mode `0600` files named by `cloudflare.access` and `cloudflare.auth`. The Cloudflare API token is the login keychain item service `cloudflare`, account `default`. If `cloudflare.admin` says it is absent or unusable, ask the user to call `cloudflare-token`. Do not pass the token as an argument. Do not paste a secret into the chat.
3. If the selection includes `github-repos`, ask which extra `org/name` lines belong in `github-repos/config`. Keep `jewell-labs/self-hosted`. Add a repo only after they name it. Leave `interval_seconds` unless they change it.

## 3. Install

For each selected plugin, in catalog order, call `<id>.setup` and then `<id>.check` on the local mesh. `validate` is empty. The system validates itself from the event log: `events.describe` is ok when every latest event is ok.

Use the `llmProfile` from this discover result when `llm` is selected. Decision models use the decision router, not the llm server. The llm plugin owns `~/.self-hosted/llm/models/gguf`. Decision reads that same directory. Do not copy a weight into a second directory. `home/policy.json` lists the directories tools may write under `~/.self-hosted` and the disk reserve a download must leave free. Do not run `actions-runner` setup when `publicRunnerAllowed` is false.

The only path for host work is an MCP tool: `discover`, `doctor`, `<id>.setup`, `<id>.check`, `<id>.uninstall`, `flake`, `repos`, `explore`, `sync`, `prove`, `attach-plan`, `attach-run`, `attach-macos`, `nuke`, `nuke-all`, `adopt`, `cloudflare-token`, and `cloudflare-api`. `<id>.setup` writes only under `~/.self-hosted/<id>`. `<id>.uninstall` deletes that folder except the paths in that plugin's `cleanup.json`. `nuke` keeps the union of those paths. `llm.remove` and `decision.remove` delete one weight from `~/.self-hosted/llm/models/gguf`. `flake` runs `nix flake check`. `explore` prints this checkout and each mirrored repo and does not fetch or run their tools. Destructive tools need a verified Cloudflare Access JWT even on loopback. Agents share one Access service token. Limits are `plugins/cloudflare/policy.json`. The host log uses that same Access application. `cloudflare.logs` reads it. Keep secrets out of git and out of your reply.

## 4. Reply

Reply with JSON: `{"plugins":["..."],"validate":[]}`. `plugins` is the selected ids in catalog order. `validate` is empty. On a person-driven run, one line before the JSON names the llm profile id, decision `slots`, and whether Access is required. Those three values come from discover.
