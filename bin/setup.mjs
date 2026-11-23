import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDiscovery, repoRoot } from "../lib/discover.mjs";
import { selectLlamaProfile } from "../lib/profiles.mjs";
import { readHost } from "../lib/host.mjs";

const id = process.argv[2];
if (!id) {
  console.error("usage: node bin/setup.mjs <plugin>");
  process.exit(2);
}

const root = repoRoot();
const stateDir = process.env.SELFHOST_STATE ?? join(root, ".self-hosted");
const discovery = buildDiscovery();
const plugin = discovery.plugins.find((item) => item.id === id);
if (!plugin) {
  console.error(`unknown plugin ${id}`);
  process.exit(2);
}
if (!plugin.applicable) {
  console.error(`${id} is not applicable: ${plugin.reason}`);
  process.exit(1);
}

await mkdir(stateDir, { recursive: true });
const host = readHost();

if (id === "baseline") {
  await writeFile(join(stateDir, "host.json"), `${JSON.stringify({ schema: discovery.schema, host }, null, 2)}\n`);
  console.log(`wrote ${join(stateDir, "host.json")}`);
} else if (id === "mcp") {
  const unit = {
    bind: "127.0.0.1",
    port: Number(process.env.PORT ?? 8473),
    command: ["node", "mcp/server.mjs"],
    access: plugin.access,
  };
  await writeFile(join(stateDir, "mcp.json"), `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${join(stateDir, "mcp.json")}`);
} else if (id === "llama") {
  const profile = selectLlamaProfile(host);
  const rendered = {
    profile: profile.id,
    port: profile.port,
    args: profile.args,
    modelsDir: host.modelsDir,
    note: "Pass --models-dir $SELFHOST_MODELS_DIR at install time. Weights stay outside git.",
  };
  await writeFile(join(stateDir, "llama.json"), `${JSON.stringify(rendered, null, 2)}\n`);
  console.log(`wrote ${join(stateDir, "llama.json")} profile=${profile.id}`);
} else if (id === "decision") {
  const rendered = {
    secondProcess: host.memGb >= 64,
    port: host.memGb >= 64 ? 8090 : 8080,
    ctxSize: 4096,
    note: host.memGb >= 64
      ? "Start a second llama-server for decision models."
      : "Keep a single router. Load a model whose output modality includes decisions.",
  };
  await writeFile(join(stateDir, "decision.json"), `${JSON.stringify(rendered, null, 2)}\n`);
  console.log(`wrote ${join(stateDir, "decision.json")} secondProcess=${rendered.secondProcess}`);
} else if (id === "cloudflared") {
  const tokenPath = join(process.env.HOME ?? "/tmp", ".cloudflared", "token");
  const unit = {
    tokenPath,
    command: ["plugins/cloudflared/run-tunnel.sh"],
    note: "Put the tunnel token in tokenPath mode 0600. Do not commit it.",
  };
  await writeFile(join(stateDir, "cloudflared.json"), `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${join(stateDir, "cloudflared.json")}`);
} else if (id === "sshd") {
  const home = process.env.HOME ?? "/tmp";
  const dir = join(home, ".ssh", "userland");
  const unit = {
    listen: "127.0.0.1",
    port: 2222,
    passwordAuthentication: false,
    kbdInteractiveAuthentication: false,
    pubkeyAuthentication: true,
    hostKey: join(dir, "ssh_host_ed25519_key"),
    authorizedPrincipalsFile: join(dir, "authorized_principals"),
    trustedUserCAKeys: join(dir, "cf-access-ca.pub"),
    note: "The CA, host key, and principals stay in this directory. Do not commit them.",
  };
  await writeFile(join(stateDir, "sshd.json"), `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${join(stateDir, "sshd.json")}`);
} else if (id === "github-repos") {
  const { execFileSync } = await import("node:child_process");
  const printed = execFileSync("bash", ["github-repos/ghref", "print-config"], { cwd: root, encoding: "utf8" });
  const lines = printed.trim().split("\n");
  const intervalLine = lines[0] ?? "";
  if (!intervalLine.startsWith("interval_seconds=")) {
    console.error("github-repos config did not print an interval");
    process.exit(1);
  }
  const unit = {
    intervalSeconds: Number(intervalLine.slice("interval_seconds=".length)),
    repos: lines.slice(1),
    config: "github-repos/config",
  };
  await writeFile(join(stateDir, "github-repos.json"), `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${join(stateDir, "github-repos.json")} every ${unit.intervalSeconds}s`);
} else if (id === "agent-desktop") {
  const pins = JSON.parse(readFileSync(join(root, "catalog/pins.json"), "utf8"));
  const unit = {
    version: pins["agent-desktop"],
    sandbox: {
      provider: "macos",
      install: "agent-desktop sandbox install macos",
      create: "agent-desktop sandbox create base --provider macos --set ipsw=latest",
      start: "agent-desktop sandbox start base",
      note: "The first macOS sandbox needs a person to finish Setup Assistant, run guest-setup.sh from the shared folder, and grant Accessibility. The guest network is not isolated.",
    },
  };
  await writeFile(join(stateDir, "agent-desktop.json"), `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${join(stateDir, "agent-desktop.json")} version=${unit.version}`);
} else if (id === "agent-browser") {
  const pins = JSON.parse(readFileSync(join(root, "catalog/pins.json"), "utf8"));
  const unit = {
    version: pins["agent-browser"],
    installBrowsers: "agent-browser install",
    note: "Chrome for Testing is downloaded into the user directory. It is not stored in git.",
  };
  await writeFile(join(stateDir, "agent-browser.json"), `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${join(stateDir, "agent-browser.json")} version=${unit.version}`);
} else if (id === "actions-runner") {
  if (!plugin.publicRunnerAllowed) {
    console.error("refusing actions-runner: this repository is public. Set ALLOW_PUBLIC_REPO_RUNNER=1 only if you accept pull-request code on this host.");
    process.exit(1);
  }
  await writeFile(join(stateDir, "actions-runner.json"), `${JSON.stringify({ allowed: true, host: host.hostname }, null, 2)}\n`);
  console.log("actions-runner override recorded");
} else {
  console.error(`no setup for ${id}`);
  process.exit(2);
}
