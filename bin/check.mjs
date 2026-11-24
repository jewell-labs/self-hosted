import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDiscovery, repoRoot } from "../lib/discover.mjs";
import { readHost } from "../lib/host.mjs";
import { layout } from "../lib/paths.mjs";

const id = process.argv[2];
if (!id) {
  console.error("usage: node bin/check.mjs <plugin>");
  process.exit(2);
}

const root = repoRoot();
const stateDir = process.env.SELFHOST_STATE ?? layout().state;
const discovery = buildDiscovery();
const plugin = discovery.plugins.find((item) => item.id === id);
if (!plugin?.applicable) {
  console.error(`${id} is not applicable`);
  process.exit(1);
}

async function post(port, body, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text };
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, ["mcp/server.mjs"], { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`server did not listen\n${buf}\n${err}`));
    }, 8_000);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const line = buf.split("\n").find((item) => item.startsWith("{"));
      if (!line || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, info: JSON.parse(line) });
    });
    child.on("exit", (code) => fail(new Error(`server exited ${code}: ${buf} ${err}`)));
  });
}

if (id === "baseline") {
  const written = JSON.parse(await readFile(join(stateDir, "host.json"), "utf8"));
  const host = readHost();
  if (written.host.os !== host.os || written.host.arch !== host.arch || written.schema !== discovery.schema) {
    console.error("baseline host.json does not match this host");
    process.exit(1);
  }
  console.log("baseline ok");
} else if (id === "mcp") {
  const unit = JSON.parse(await readFile(join(stateDir, "mcp.json"), "utf8"));
  if (unit.bind !== "127.0.0.1" || (unit.access !== "loopback-only" && unit.access !== "cloudflare-access")) {
    console.error("mcp unit is not loopback or access-gated");
    process.exit(1);
  }
  const open = await startServer({ PORT: "0", BIND_HOST: "127.0.0.1" });
  try {
    const listed = await post(open.info.port, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    if (listed.status !== 200 || !listed.text.includes("discover")) throw new Error(`tools/list failed ${listed.status}`);
    const called = await post(open.info.port, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "discover", arguments: {} } });
    const parsed = JSON.parse(called.text);
    const payload = JSON.parse(parsed.result.content[0].text);
    if (payload.schema !== "jewell-labs.self-hosted.discover.v1" || !payload.setupPrompt.includes("setup-host")) {
      throw new Error("discover payload missing schema or prompt");
    }
  } finally {
    open.child.kill();
  }
  console.log("mcp ok");
} else if (id === "llm") {
  const written = JSON.parse(await readFile(join(stateDir, "llm.json"), "utf8"));
  if (written.profile !== discovery.llmProfile?.id || written.args.join(" ") !== discovery.llmProfile.args.join(" ")) {
    console.error("llm.json does not match the selected profile");
    process.exit(1);
  }
  console.log(`llm ok profile=${written.profile}`);
} else if (id === "decision") {
  const { decisionUnit } = await import("../decision/registry.mjs");
  const written = JSON.parse(await readFile(join(stateDir, "decision.json"), "utf8"));
  if (JSON.stringify(written) !== JSON.stringify(decisionUnit())) {
    console.error("decision.json does not match the decision registry");
    process.exit(1);
  }
  console.log(`decision ok slots=${written.slots} models=${written.models.length}`);
} else if (id === "cloudflare") {
  const { readFileSync } = await import("node:fs");
  const { cloudflareUnit, loadPolicy } = await import("../plugins/cloudflare/unit.mjs");
  const { proveAccess } = await import("../plugins/cloudflare/prove.mjs");
  const written = JSON.parse(await readFile(join(stateDir, "cloudflare.json"), "utf8"));
  const expect = cloudflareUnit();
  if (JSON.stringify(written) !== JSON.stringify(expect)) {
    console.error("cloudflare unit does not match plugins/cloudflare");
    process.exit(1);
  }
  const mesh = JSON.parse(readFileSync(join(root, ".agents/mesh.json"), "utf8"));
  if (JSON.stringify(mesh.access) !== JSON.stringify(loadPolicy().access)) {
    console.error("mesh.json access does not match plugins/cloudflare/policy.json");
    process.exit(1);
  }
  for (const file of [expect.tunnel.tokenPath, expect.auth.idFile, expect.auth.secretFile]) {
    try {
      const stat = await lstat(file);
      if (stat.isFile() && (stat.mode & 0o777) !== 0o600) {
        console.error(`${file} must be mode 0600`);
        process.exit(1);
      }
    } catch {
      // Absent on a machine that has not installed the token yet.
    }
  }
  await proveAccess(root);
  console.log("cloudflare ok");
} else if (id === "sshd") {
  const written = JSON.parse(await readFile(join(stateDir, "sshd.json"), "utf8"));
  const dir = layout().sshd;
  if (written.listen !== "127.0.0.1" || written.port !== 2222 || written.passwordAuthentication !== false) {
    console.error("sshd unit is not loopback, port 2222, passwords off");
    process.exit(1);
  }
  for (const key of ["hostKey", "authorizedPrincipalsFile", "trustedUserCAKeys"]) {
    if (!written[key].startsWith(`${dir}/`)) {
      console.error(`sshd ${key} is not under ${dir}`);
      process.exit(1);
    }
  }
  console.log("sshd ok");
} else if (id === "github-repos") {
  const { execFileSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");
  const written = JSON.parse(await readFile(join(stateDir, "github-repos.json"), "utf8"));
  const script = readFileSync(join(root, "github-repos/ghref"), "utf8");
  const config = readFileSync(join(root, "github-repos/config"), "utf8");
  if (script.includes("REPOS=") || /integer>\d+<\/integer>/.test(script) || /\b900\b/.test(script)) {
    console.error("ghref hardcodes a repo list or interval; those belong in github-repos/config");
    process.exit(1);
  }
  const interval = Number((config.match(/^interval_seconds=(\d+)$/m) ?? [])[1]);
  const repos = config.split("\n").filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("interval_seconds="));
  const printed = execFileSync("bash", ["github-repos/ghref", "print-config"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  if (written.intervalSeconds !== interval || printed[0] !== `interval_seconds=${interval}`) {
    console.error("recorded interval does not match github-repos/config");
    process.exit(1);
  }
  if (written.repos.join("\n") !== repos.join("\n") || printed.slice(1).join("\n") !== repos.join("\n")) {
    console.error("recorded repos do not match github-repos/config");
    process.exit(1);
  }
  console.log(`github-repos ok every ${interval}s`);
} else if (id === "agent-desktop") {
  const { readFileSync } = await import("node:fs");
  const written = JSON.parse(await readFile(join(stateDir, "agent-desktop.json"), "utf8"));
  const pins = JSON.parse(readFileSync(join(root, "catalog/pins.json"), "utf8"));
  if (written.version !== pins["agent-desktop"] || !written.sandbox.note.includes("Accessibility")) {
    console.error("agent-desktop unit does not match catalog/pins.json");
    process.exit(1);
  }
  console.log(`agent-desktop ok ${written.version}`);
} else if (id === "agent-browser") {
  const { readFileSync } = await import("node:fs");
  const written = JSON.parse(await readFile(join(stateDir, "agent-browser.json"), "utf8"));
  const pins = JSON.parse(readFileSync(join(root, "catalog/pins.json"), "utf8"));
  if (written.version !== pins["agent-browser"] || written.installBrowsers !== "agent-browser install") {
    console.error("agent-browser unit does not match catalog/pins.json");
    process.exit(1);
  }
  console.log(`agent-browser ok ${written.version}`);
} else if (id === "simulators") {
  const { detectSimulators } = await import("../simulators/detect.mjs");
  const { readSimulatorState } = await import("../simulators/state.mjs");
  const written = await readSimulatorState(stateDir);
  const live = await detectSimulators();
  const left = (written.available ?? []).map((item) => item.udid).join(",");
  const right = live.map((item) => item.udid).join(",");
  if (written.claim !== "all" || left !== right) {
    console.error("simulators.json does not match the detected devices");
    process.exit(1);
  }
  console.log(`simulators ok ${live.length}`);
} else if (id === "portless") {
  const { readFileSync } = await import("node:fs");
  const { loadPolicy } = await import("../portless/host.mjs");
  const { readPortlessState } = await import("../portless/state.mjs");
  const written = await readPortlessState(stateDir);
  const policy = loadPolicy();
  const pins = JSON.parse(readFileSync(join(root, "catalog/pins.json"), "utf8"));
  if (written.version !== pins.portless || written.version !== policy.version || written.guestPort !== policy.guestPort || written.proxy !== policy.proxy || written.stateDir !== layout().portless || policy.stateDir !== ".self-hosted/portless") {
    console.error("portless.json does not match the host policy");
    process.exit(1);
  }
  console.log(`portless ok ${written.version}`);
} else if (id === "work") {
  const { readFileSync } = await import("node:fs");
  const routine = JSON.parse(readFileSync(join(root, ".agents/routines/clean-work.json"), "utf8"));
  if (routine.id !== "clean-work" || routine.every !== "1d" || routine.workflow !== "clean" || routine.plugin !== "work") {
    console.error("clean-work routine does not match");
    process.exit(1);
  }
  const { readProjects } = await import("../work/store.mjs");
  const { loadDescriptors } = await import("../work/harnesses.mjs");
  const projects = await readProjects();
  const docs = await loadDescriptors(root);
  if (!projects.includes("jewell-labs/self-hosted") || !docs.some((item) => item.id === "grok")) {
    console.error("work does not read github-repos/config or the harness descriptors");
    process.exit(1);
  }
  console.log(`work ok ${projects.length} projects ${docs.length} harnesses`);
} else if (id === "evals") {
  const { evalUnit } = await import("../evals/unit.mjs");
  const written = JSON.parse(await readFile(join(stateDir, "evals.json"), "utf8"));
  if (JSON.stringify(written) !== JSON.stringify(evalUnit())) {
    console.error("evals.json does not match the eval list");
    process.exit(1);
  }
  console.log(`evals ok ${written.ids.join(",")}`);
} else if (id === "actions-runner") {
  if (!plugin.publicRunnerAllowed) {
    console.error("actions-runner remains refused on a public repo");
    process.exit(1);
  }
  console.log("actions-runner ok");
} else {
  console.error(`no check for ${id}`);
  process.exit(2);
}
