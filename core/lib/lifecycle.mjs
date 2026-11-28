import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homeDir } from "./paths.mjs";

const ID_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

export function repoRootFromHere() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function listPackages(root) {
  return readdirSync(root).filter((name) => !name.startsWith(".") && statSync(join(root, name)).isDirectory()).sort();
}

export function loadPackage(root, id) {
  const doc = JSON.parse(readFileSync(join(root, id, "plugin.json"), "utf8"));
  if (!doc || doc.id !== id || !Array.isArray(doc.assets) || !Array.isArray(doc.events)) throw new Error(`plugin ${id}`);
  if (!doc.events.some((event) => event.type === "healthcheck" && event.name === "healthcheck")) throw new Error(`${id} healthcheck`);
  for (const asset of doc.assets) {
    if (typeof asset.path !== "string" || asset.path.includes("..") || asset.path.startsWith("/") || asset.path.includes("\\")) throw new Error(`${id} asset`);
    if (asset.scope !== "home" && asset.scope !== "package") throw new Error(`${id} asset scope`);
  }
  if (!doc.assets.some((asset) => asset.scope === "home")) throw new Error(`${id} home asset`);
  return doc;
}

function pause(ms) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, ms);
}

function publishHealth(env, id) {
  const file = join(homeDir(env), "logs", "events.jsonl");
  mkdirSync(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let fd;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      fd = openSync(lock, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      pause(5);
    }
  }
  if (fd === undefined) throw new Error("event log");
  try {
    let last = 0n;
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8").trimEnd();
      if (text) {
        const line = text.slice(text.lastIndexOf("\n") + 1);
        try {
          const prev = JSON.parse(line).id;
          if (/^(0|[1-9][0-9]{0,17})$/.test(prev) && prev !== "0") last = BigInt(prev);
        } catch {
          last = 0n;
        }
      }
    }
    const event = {
      id: String(last + 1n),
      at: new Date().toISOString(),
      plugin: id,
      type: "healthcheck",
      name: "healthcheck",
      detail: "ok",
    };
    appendFileSync(file, `${JSON.stringify(event)}\n`);
    return event;
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lock);
    } catch {
      // The next writer removes a lock it no longer needs.
    }
  }
}

function payloads(base, doc) {
  const out = {};
  for (const asset of doc.assets) {
    if (asset.scope !== "home" || asset.path === "." || asset.path === "") continue;
    const file = join(base, asset.path, "payload");
    out[asset.path] = existsSync(file) ? readFileSync(file).toString("base64") : null;
  }
  return out;
}

export async function setupPackage({ id, env = process.env, root = env.SELFHOST_ROOT ?? repoRootFromHere() } = {}) {
  const doc = loadPackage(root, id);
  const base = join(homeDir(env), id);
  mkdirSync(base, { recursive: true });
  for (const asset of doc.assets) {
    if (asset.scope !== "home" || asset.path === "." || asset.path === "") continue;
    mkdirSync(join(base, asset.path), { recursive: true });
  }
  const runDir = join(base, "run");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), `${JSON.stringify({ id, status: "up" })}\n`);
  const event = publishHealth(env, id);
  return { id, healthcheck: event.detail, status: "up" };
}

export async function teardownPackage({ id, env = process.env, root = env.SELFHOST_ROOT ?? repoRootFromHere() } = {}) {
  const doc = loadPackage(root, id);
  const base = join(homeDir(env), id);
  const before = payloads(base, doc);
  rmSync(join(base, "run"), { recursive: true, force: true });
  const after = payloads(base, doc);
  return { id, status: "down", healthcheck: "down", assetsChanged: JSON.stringify(before) !== JSON.stringify(after) };
}

function fixtureSetup(id) {
  return `import { pathToFileURL } from "node:url";
import { join } from "node:path";

const core = process.env.SELFHOST_CORE;
if (!core) throw new Error("SELFHOST_CORE");
const loaded = await import(pathToFileURL(join(core, "lib/lifecycle.mjs")).href);
const result = await loaded.setupPackage({ id: ${JSON.stringify(id)} });
console.log(JSON.stringify({ id: result.id, healthcheck: result.healthcheck, status: result.status }));
if (result.healthcheck !== "ok") process.exit(1);
`;
}

function fixtureTeardown(id) {
  return `import { pathToFileURL } from "node:url";
import { join } from "node:path";

const core = process.env.SELFHOST_CORE;
if (!core) throw new Error("SELFHOST_CORE");
const loaded = await import(pathToFileURL(join(core, "lib/lifecycle.mjs")).href);
const result = await loaded.teardownPackage({ id: ${JSON.stringify(id)} });
console.log(JSON.stringify({ id: result.id, healthcheck: result.healthcheck, status: result.status, assetsChanged: result.assetsChanged }));
if (result.status !== "down" || result.assetsChanged) process.exit(1);
`;
}

export function addPlugin(root, id) {
  if (!ID_RE.test(id)) throw new Error(`plugin id ${id}`);
  const dir = join(root, id);
  if (existsSync(dir)) throw new Error(`plugin exists ${id}`);
  mkdirSync(dir, { recursive: true });
  const doc = {
    id,
    assets: [{ path: "assets", scope: "home", kind: "payload" }],
    events: [{ type: "healthcheck", name: "healthcheck" }],
  };
  writeFileSync(join(dir, "plugin.json"), `${JSON.stringify(doc, null, 2)}\n`);
  writeFileSync(join(dir, "setup.mjs"), fixtureSetup(id));
  writeFileSync(join(dir, "teardown.mjs"), fixtureTeardown(id));
  writeFileSync(join(dir, "README.md"), `# ${id}\n\nIsolated package added by core onto an existing install.\n`);
  writeFileSync(join(dir, "AGENTS.md"), `# ${id}\n\nWhen asked to set yourself up, reply with only {"command":"node ${id}/setup.mjs"}\n`);
  writeFileSync(join(dir, "event.json"), `${JSON.stringify({
    schema: "jewell-labs.self-hosted.event.v1",
    plugin: id,
    events: [
      { type: "healthcheck", name: "healthcheck" },
      { type: "tool" },
      { type: "workflow", name: "ci" },
    ],
  }, null, 2)}\n`);
}
