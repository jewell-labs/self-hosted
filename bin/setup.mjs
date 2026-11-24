import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDiscovery, repoRoot } from "../lib/discover.mjs";
import { decisionUnit } from "../decision/registry.mjs";
import { JailError, writeInside } from "../lib/jail.mjs";
import { selectLlmProfile } from "../lib/profiles.mjs";
import { readHost } from "../lib/host.mjs";
import { homeDir, layout } from "../lib/paths.mjs";

const id = process.argv[2];
if (!id) {
  console.error("usage: node bin/setup.mjs <plugin>");
  process.exit(2);
}

const root = repoRoot();
const home = homeDir();
const stateDir = process.env.SELFHOST_STATE ?? layout().state;

async function writeState(name, body) {
  try {
    return await writeInside(home, join(stateDir, name), body);
  } catch (error) {
    console.error(error instanceof JailError ? error.message : error.message);
    process.exit(1);
  }
}
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

const host = readHost();

if (id === "baseline") {
  const dest = await writeState("host.json", `${JSON.stringify({ schema: discovery.schema, host }, null, 2)}\n`);
  console.log(`wrote ${dest}`);
} else if (id === "mcp") {
  const unit = {
    bind: "127.0.0.1",
    port: Number(process.env.PORT ?? 8473),
    command: ["node", "mcp/server.mjs"],
    access: plugin.access,
  };
  const dest = await writeState("mcp.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest}`);
} else if (id === "llm") {
  const profile = selectLlmProfile(host);
  const rendered = {
    profile: profile.id,
    port: profile.port,
    args: profile.args,
    modelsDir: host.llmModels,
  };
  const dest = await writeState("llm.json", `${JSON.stringify(rendered, null, 2)}\n`);
  console.log(`wrote ${dest} profile=${profile.id}`);
} else if (id === "decision") {
  const rendered = decisionUnit();
  const dest = await writeState("decision.json", `${JSON.stringify(rendered, null, 2)}\n`);
  console.log(`wrote ${dest} slots=${rendered.slots} models=${rendered.models.length}`);
} else if (id === "cloudflare") {
  const { cloudflareUnit } = await import("../plugins/cloudflare/unit.mjs");
  const unit = cloudflareUnit();
  const dest = await writeState("cloudflare.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest} access=${unit.access.required}`);
} else if (id === "sshd") {
  const dir = layout().sshd;
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
  const dest = await writeState("sshd.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest}`);
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
  const dest = await writeState("github-repos.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest} every ${unit.intervalSeconds}s`);
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
  const dest = await writeState("agent-desktop.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest} version=${unit.version}`);
} else if (id === "agent-browser") {
  const pins = JSON.parse(readFileSync(join(root, "catalog/pins.json"), "utf8"));
  const unit = {
    version: pins["agent-browser"],
    installBrowsers: "agent-browser install",
    note: "Chrome for Testing is downloaded into the user directory. It is not stored in git.",
  };
  const dest = await writeState("agent-browser.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest} version=${unit.version}`);
} else if (id === "simulators") {
  const { writeSimulatorState } = await import("../simulators/state.mjs");
  const unit = await writeSimulatorState(stateDir, process.env);
  console.log(`wrote ${join(stateDir, "simulators.json")} available=${unit.available.length}`);
} else if (id === "portless") {
  const { loadPolicy } = await import("../portless/host.mjs");
  const { writePortlessState } = await import("../portless/state.mjs");
  const pins = JSON.parse(readFileSync(join(root, "catalog/pins.json"), "utf8"));
  if (loadPolicy().version !== pins.portless) {
    console.error("portless policy version does not match catalog/pins.json");
    process.exit(1);
  }
  const unit = await writePortlessState(stateDir);
  console.log(`wrote ${join(stateDir, "portless.json")} version=${unit.version}`);
} else if (id === "work") {
  const { mkdir } = await import("node:fs/promises");
  const { installWrappers } = await import("../work/install.mjs");
  await mkdir(layout().work, { recursive: true });
  const bins = await installWrappers();
  console.log(`work root ${layout().work}`);
  console.log(`wrappers ${bins.join(",")}`);
} else if (id === "actions-runner") {
  if (!plugin.publicRunnerAllowed) {
    console.error("refusing actions-runner: this repository is public. Set ALLOW_PUBLIC_REPO_RUNNER=1 only if you accept pull-request code on this host.");
    process.exit(1);
  }
  await writeState("actions-runner.json", `${JSON.stringify({ allowed: true, host: host.hostname }, null, 2)}\n`);
  console.log("actions-runner override recorded");
} else {
  console.error(`no setup for ${id}`);
  process.exit(2);
}
