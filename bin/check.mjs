import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDiscovery, repoRoot } from "../lib/discover.mjs";
import { readHost } from "../lib/host.mjs";

const id = process.argv[2];
if (!id) {
  console.error("usage: node bin/check.mjs <plugin>");
  process.exit(2);
}

const root = repoRoot();
const stateDir = process.env.SELFHOST_STATE ?? join(root, ".self-hosted");
const discovery = buildDiscovery();
const plugin = discovery.plugins.find((item) => item.id === id);
if (!plugin?.applicable) {
  console.error(`${id} is not applicable`);
  process.exit(1);
}

function b64url(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString("base64url");
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
  const dir = await mkdtemp(join(tmpdir(), "selfhost-access-"));
  try {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" });
    jwk.kid = "proof";
    jwk.alg = "RS256";
    jwk.use = "sig";
    const jwksPath = join(dir, "jwks.json");
    await writeFile(jwksPath, JSON.stringify({ keys: [jwk] }));
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
    const gated = await startServer({
      PORT: "0",
      BIND_HOST: "127.0.0.1",
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "proof-aud",
      SELFHOST_ACCESS_JWKS_FILE: jwksPath,
    });
    try {
      const denied = await post(gated.info.port, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      if (denied.status !== 401) throw new Error(`expected 401 without jwt, got ${denied.status}`);
      const header = b64url(JSON.stringify({ alg: "RS256", kid: "proof", typ: "JWT" }));
      const body = b64url(JSON.stringify({
        iss: "https://team.cloudflareaccess.com",
        aud: "proof-aud",
        exp: Math.floor(Date.now() / 1000) + 600,
        sub: "proof",
      }));
      const sig = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey).toString("base64url");
      const allowed = await post(
        gated.info.port,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "discover", arguments: {} } },
        { "cf-access-jwt-assertion": `${header}.${body}.${sig}` },
      );
      if (allowed.status !== 200) throw new Error(`expected 200 with jwt, got ${allowed.status} ${allowed.text}`);
    } finally {
      gated.child.kill();
    }
    const refused = spawn(process.execPath, ["mcp/server.mjs"], {
      cwd: root,
      env: { ...process.env, BIND_HOST: "0.0.0.0", PORT: "0", CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "" },
    });
    const code = await new Promise((resolve) => refused.on("exit", resolve));
    if (code === 0) throw new Error("non-loopback bind without access was accepted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log("mcp ok");
} else if (id === "llama") {
  const written = JSON.parse(await readFile(join(stateDir, "llama.json"), "utf8"));
  if (written.profile !== discovery.llamaProfile?.id || written.args.join(" ") !== discovery.llamaProfile.args.join(" ")) {
    console.error("llama.json does not match the selected profile");
    process.exit(1);
  }
  console.log(`llama ok profile=${written.profile}`);
} else if (id === "decision") {
  const written = JSON.parse(await readFile(join(stateDir, "decision.json"), "utf8"));
  const expectSecond = readHost().memGb >= 64;
  if (written.secondProcess !== expectSecond || written.ctxSize !== 4096) {
    console.error("decision.json does not match host memory");
    process.exit(1);
  }
  console.log(`decision ok secondProcess=${written.secondProcess}`);
} else if (id === "cloudflared") {
  const written = JSON.parse(await readFile(join(stateDir, "cloudflared.json"), "utf8"));
  if (!written.tokenPath.endsWith(".cloudflared/token") || written.command[0] !== "plugins/cloudflared/run-tunnel.sh") {
    console.error("cloudflared unit is missing the token file");
    process.exit(1);
  }
  console.log("cloudflared ok");
} else if (id === "sshd") {
  const written = JSON.parse(await readFile(join(stateDir, "sshd.json"), "utf8"));
  const home = process.env.HOME ?? "/tmp";
  const dir = join(home, ".ssh", "userland");
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
