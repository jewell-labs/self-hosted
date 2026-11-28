// Read-only review of the mesh, the repos it lists, Cloudflare files, and workflows.
// The default level is strict. This module does not spawn other repos' tools, read tunnel token files, or print the API token.
import { execFile } from "node:child_process";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { repoRoot } from "./discover.mjs";
import { loadMesh, MeshError, MCP_SCHEMA } from "./mesh.mjs";
import { keychainStatus } from "../plugins/cloudflare/keychain.mjs";
import { loadWebhooks } from "./events.mjs";
import { loadCleanup } from "./cleanup.mjs";
import { loadHomePolicy, scanHome } from "./jail.mjs";
import { layout } from "./paths.mjs";
import { SECRET_RE } from "./secret.mjs";

const execFileAsync = promisify(execFile);

export const DOCTOR_SCHEMA = "jewell-labs.agents.doctor.v1";
export const LEVELS = Object.freeze(["shape", "mesh", "repos", "strict"]);
const OWN_REPO = "jewell-labs/self-hosted";
const HOSTED_PREFIXES = ["ubuntu-", "macos-", "windows-"];
const INFRA_TOOLS = ["discover", "doctor", "mesh.list", "mesh.lsp", "mesh.skill", "events.webhooks", "events.history", "events.describe", "events.workflow"];
const ACCESS_KEYS = ["serviceTokensDoNotConsumeSeats", "oneSharedServiceToken", "freePlanUserSeats", "serviceTokenLimit", "assertionHeader"];

function finding(level, id, ok, detail) {
  return { level, id, ok, detail };
}

export function normalizeLevel(level) {
  if (level === undefined || level === "") return "strict";
  if (typeof level !== "string" || !LEVELS.includes(level)) throw new MeshError(`doctor level ${level ?? ""}`);
  return level;
}

function groupsFor(level) {
  const index = LEVELS.indexOf(level);
  const groups = new Set(["shape"]);
  if (index >= 1) groups.add("mesh");
  if (index >= 2) groups.add("repos");
  if (index >= 3) groups.add("cloudflare").add("workflows").add("workers");
  return groups;
}

function namesFrom(source) {
  const block = source.match(/names = \[([\s\S]*?)\];/);
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

async function readText(path) {
  try {
    const text = await readFile(path, "utf8");
    if (SECRET_RE.test(text)) return { secret: true };
    return { text };
  } catch {
    return null;
  }
}

function skillName(text) {
  const match = text.match(/^---\n[\s\S]*?^name:\s*([a-z0-9-]+)\s*$/m);
  return match ? match[1] : "";
}

export function runsOnLabels(raw) {
  const text = String(raw).split("#")[0].trim();
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    const body = end >= 0 ? text.slice(1, end) : text.slice(1);
    return body.split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  }
  const one = text.replace(/^['"]|['"]$/g, "");
  return one ? [one] : [];
}

function hostedLabel(label) {
  return HOSTED_PREFIXES.some((prefix) => label.startsWith(prefix)) || label.endsWith("-latest");
}

export function runnerOk(raw, visibility, annotatedPublic) {
  const labels = runsOnLabels(raw);
  if (labels.length === 0) return false;
  const selfHosted = labels.some((label) => label === "self-hosted" || label.startsWith("self-hosted"));
  const publicRepo = visibility === "public" || annotatedPublic;
  if (publicRepo) return !selfHosted && labels.every(hostedLabel);
  return selfHosted;
}

function workflowRuns(text) {
  const lines = text.split("\n");
  const runs = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(\s*)runs-on:\s*(.*)$/);
    if (!match) continue;
    const previous = lines[i - 1] ?? "";
    runs.push({
      raw: match[2],
      annotatedPublic: /public-repo/.test(previous) || /public-repo/.test(lines[i]),
    });
  }
  return runs;
}

async function workflowFiles(root) {
  const dir = join(root, ".github", "workflows");
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml")).map((name) => join(dir, name));
}

async function visibilityOf(repo, env) {
  if (repo === OWN_REPO) return "public";
  if (env.SELFHOST_DOCTOR_OFFLINE === "1") return "unknown";
  try {
    const { stdout } = await execFileAsync("gh", ["repo", "view", repo, "--json", "visibility", "-q", ".visibility"], {
      timeout: 8_000,
      env,
    });
    const value = stdout.trim().toLowerCase();
    if (value === "public" || value === "private" || value === "internal") return value;
  } catch {
    // gh is optional. Unknown visibility uses the self-hosted default.
  }
  return "unknown";
}

async function linkState(path, root) {
  try {
    const stat = await lstat(path);
    if (!stat.isSymbolicLink()) return "outside";
    const target = await realpath(path);
    let base = root;
    try {
      base = await realpath(root);
    } catch {
      // The home directory may not exist yet.
    }
    const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
    return target === base || target.startsWith(prefix) ? "linked" : "elsewhere";
  } catch {
    return "absent";
  }
}

async function modeOf(path) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return { kind: "link" };
    if (!stat.isFile()) return { kind: "other" };
    return { kind: "file", mode: stat.mode & 0o777 };
  } catch {
    return { kind: "absent" };
  }
}

export async function doctor(env = process.env, args = {}) {
  const level = normalizeLevel(args.level);
  const groups = groupsFor(level);
  const root = env.SELFHOST_ROOT ?? repoRoot();
  const findings = [];
  const paths = layout(env);

  let mesh = null;
  try {
    mesh = await loadMesh(env);
    findings.push(finding("shape", "mesh.load", true, "mesh loaded"));
  } catch (error) {
    findings.push(finding("shape", "mesh.load", false, String(error.message ?? error).slice(0, 200)));
  }

  if (groups.has("shape")) {
    const catalogText = await readText(join(root, "catalog/plugins.json"));
    const nixText = await readText(join(root, "nix/packages.nix"));
    if (!catalogText?.text || !nixText?.text) {
      findings.push(finding("shape", "catalog.order", false, "catalog or nix names unreadable"));
    } else {
      const catalog = JSON.parse(catalogText.text);
      const ids = catalog.plugins.map((plugin) => plugin.id);
      const names = namesFrom(nixText.text);
      findings.push(finding("shape", "catalog.order", ids.join() === names.join(), ids.join() === names.join() ? ids.join(",") : "catalog and nix names differ"));
    }
    try {
      await loadHomePolicy(root);
      findings.push(finding("shape", "home.policy", true, "home/policy.json"));
    } catch {
      findings.push(finding("shape", "home.policy", false, "home/policy.json"));
    }
    try {
      const kept = loadCleanup(root).flatMap((item) => item.keep);
      findings.push(finding("shape", "cleanup", true, kept.length === 0 ? "none" : kept.join(",")));
    } catch (error) {
      findings.push(finding("shape", "cleanup", false, String(error.message ?? error).slice(0, 200)));
    }
    try {
      const hooks = await loadWebhooks(root);
      findings.push(finding("shape", "events.schema", true, `${hooks.length} webhooks`));
    } catch (error) {
      findings.push(finding("shape", "events.schema", false, String(error.message ?? error).slice(0, 200)));
    }
    if (mesh) {
      const present = new Set(mesh.tools.filter((tool) => tool.trusted).map((tool) => tool.name));
      const missing = INFRA_TOOLS.filter((name) => !present.has(name));
      findings.push(finding("shape", "infra.tools", missing.length === 0, missing.length === 0 ? INFRA_TOOLS.join(",") : `missing ${missing.join(",")}`));
      const pluginIds = mesh.skills.filter((skill) => skill.trusted && skill.repo === OWN_REPO).map((skill) => skill.name);
      const need = ["doctor", "mesh", "lsp"];
      const skillMiss = need.filter((name) => !pluginIds.includes(name));
      findings.push(finding("shape", "infra.skills", skillMiss.length === 0, skillMiss.length === 0 ? need.join(",") : `missing ${skillMiss.join(",")}`));
      findings.push(finding("shape", "lsp.schema", mesh.lsp.schema === "jewell-labs.agents.lsp.v1" && Array.isArray(mesh.lsp.servers), mesh.lsp.schema));
      findings.push(finding("mesh", "mcp.lsp", mesh.mesh.schema === "jewell-labs.agents.mesh.v1" && Array.isArray(mesh.lsp.servers), "mcp and lsp schemas loaded together"));
    }
    const catalog = catalogText?.text ? JSON.parse(catalogText.text) : null;
    if (catalog) {
      const dupes = [];
      for (const plugin of catalog.plugins) {
        const copies = [
          join(root, ".agents", "skills", plugin.id, "SKILL.md"),
          join(root, "plugins", plugin.id, ".agents", "SKILL.md"),
          join(root, plugin.id, ".agents", "SKILL.md"),
        ];
        const found = [];
        for (const file of copies) {
          const read = await readText(file);
          if (read?.text) found.push(file);
        }
        if (found.length > 1) dupes.push(plugin.id);
        else if (found.length === 1) {
          const read = await readText(found[0]);
          if (skillName(read.text) !== plugin.id) dupes.push(plugin.id);
        }
      }
      findings.push(finding("shape", "skills.single", dupes.length === 0, dupes.length === 0 ? "one skill file per plugin" : dupes.join(",")));
    }
  }

  if (groups.has("mesh") && mesh) {
    const external = mesh.tools.filter((tool) => tool.trusted === false);
    const runnable = external.filter((tool) => tool.callable || tool.trusted);
    findings.push(finding("mesh", "external.frozen", runnable.length === 0, runnable.length === 0 ? `${external.length} listed` : runnable.map((tool) => tool.name).join(",")));
    const shells = external.filter((tool) => tool.run?.type === "shell");
    findings.push(finding("mesh", "external.shell", shells.length === 0, shells.length === 0 ? "no shell runs" : shells.map((tool) => tool.name).join(",")));
    findings.push(finding("mesh", "lsp.servers", Array.isArray(mesh.lsp.servers), `${mesh.lsp.servers.length} servers`));
  }

  if (groups.has("repos") && mesh) {
    for (const repo of mesh.repos) {
      if (repo.trusted) continue;
      if (!repo.present) {
        findings.push(finding("repos", `repo.${repo.name}`, true, "absent"));
        continue;
      }
      const checkout = join(env.GHREF_REF ?? paths.github, repo.name);
      const files = [join(checkout, ".agents", "mcp.json")];
      let pluginDirs = [];
      try {
        pluginDirs = await readdir(join(checkout, "plugins"));
      } catch {
        pluginDirs = [];
      }
      for (const id of pluginDirs) files.push(join(checkout, "plugins", id, ".agents", "mcp.json"));
      let saw = false;
      for (const file of files) {
        const read = await readText(file);
        if (!read) continue;
        saw = true;
        if (read.secret) {
          findings.push(finding("repos", `agents.${repo.name}`, false, "secret material"));
          continue;
        }
        let doc;
        try {
          doc = JSON.parse(read.text);
        } catch {
          findings.push(finding("repos", `agents.${repo.name}`, false, "invalid json"));
          continue;
        }
        if (doc.mcpServers && typeof doc.mcpServers === "object") {
          findings.push(finding("repos", `mcpServers.${repo.name}`, true, `listed, not executed: ${Object.keys(doc.mcpServers).join(",")}`));
          continue;
        }
        const schemaOk = doc.schema === MCP_SCHEMA && Array.isArray(doc.tools);
        const shell = schemaOk && doc.tools.some((tool) => tool?.run?.type === "shell");
        findings.push(finding("repos", `agents.${repo.name}`, schemaOk && !shell, shell ? "shell run" : schemaOk ? "schema" : "schema"));
      }
      if (!saw) findings.push(finding("repos", `agents.${repo.name}`, true, "no mcp.json"));
      const skillRoot = join(checkout, ".agents", "skills");
      let skillDirs = [];
      try {
        skillDirs = await readdir(skillRoot);
      } catch {
        skillDirs = [];
      }
      for (const name of skillDirs) {
        const read = await readText(join(skillRoot, name, "SKILL.md"));
        if (!read) continue;
        if (read.secret) {
          findings.push(finding("repos", `skill.${repo.name}.${name}`, false, "secret material"));
          continue;
        }
        findings.push(finding("repos", `skill.${repo.name}.${name}`, skillName(read.text) === name, skillName(read.text) === name ? name : "name"));
      }
    }
    const secrets = mesh.skipped.filter((item) => item.reason === "secret material");
    findings.push(finding("repos", "secrets", secrets.length === 0, secrets.length === 0 ? "none" : "secret material"));
  }

  if (groups.has("cloudflare")) {
    const token = await modeOf(paths.token);
    if (token.kind === "absent") findings.push(finding("cloudflare", "cloudflared.token", true, "absent"));
    else if (token.kind === "file") findings.push(finding("cloudflare", "cloudflared.token", token.mode === 0o600, token.mode === 0o600 ? "mode 0600" : `mode ${token.mode.toString(8)}`));
    else findings.push(finding("cloudflare", "cloudflared.token", false, token.kind));
    for (const [id, legacy] of [["cloudflared.home", paths.legacy.cloudflared], ["sshd.home", paths.legacy.sshd], ["github.home", paths.legacy.github], ["ghref.home", paths.legacy.ghref], ["portless.home", paths.legacy.portless], ["models.home", paths.legacy.models], ["agent-desktop.home", paths.legacy.agentDesktop], ["containers.home", paths.legacy.containers]]) {
      const state = await linkState(legacy, paths.root);
      findings.push(finding("cloudflare", id, state !== "outside" && state !== "elsewhere", state));
    }
    const sshd = await modeOf(join(paths.sshd, "sshd_config"));
    findings.push(finding("cloudflare", "sshd.config", sshd.kind === "absent" || sshd.kind === "file", sshd.kind));
    const admin = await keychainStatus(env);
    const adminOk = admin.state === "absent" || admin.state === "present" || admin.state === "unavailable";
    findings.push(finding("cloudflare", "cloudflare.admin", adminOk, admin.state));
  }

  if (groups.has("workflows")) {
    const ownFiles = await workflowFiles(root);
    const ownRuns = [];
    let ownText = "";
    for (const file of ownFiles) {
      const read = await readText(file);
      if (!read?.text) continue;
      ownText += read.text;
      ownRuns.push(...workflowRuns(read.text));
    }
    const ownOk = ownRuns.length > 0 && ownRuns.every((run) => runnerOk(run.raw, "public", run.annotatedPublic));
    findings.push(finding("workflows", "workflows.catalog", ownOk, ownOk ? `${ownRuns.length} github-hosted` : "public catalog must use a github-hosted runner"));
    const refuses = ownText.includes("setup.mjs actions-runner") && ownText.includes("exit 1");
    findings.push(finding("workflows", "workflows.public-runner", refuses, refuses ? "public runner refused" : "workflow does not refuse actions-runner"));
    if (mesh) {
      for (const repo of mesh.repos) {
        if (repo.trusted || !repo.present) continue;
        const checkout = join(env.GHREF_REF ?? paths.github, repo.name);
        const files = await workflowFiles(checkout);
        if (files.length === 0) {
          findings.push(finding("workflows", `workflows.${repo.name}`, true, "no workflows"));
          continue;
        }
        const visibility = await visibilityOf(repo.name, env);
        let ok = true;
        for (const file of files) {
          const read = await readText(file);
          if (!read?.text) continue;
          if (read.secret) {
            ok = false;
            break;
          }
          const runs = workflowRuns(read.text);
          if (runs.length === 0 || runs.some((run) => !runnerOk(run.raw, visibility, run.annotatedPublic))) ok = false;
        }
        const expect = visibility === "public" ? "github-hosted" : "self-hosted";
        findings.push(finding("workflows", `workflows.${repo.name}`, ok, ok ? `${visibility} ${expect}` : `${visibility} jobs must use ${expect}`));
      }
    }
  }

  if (groups.has("workers") && mesh) {
    const access = mesh.mesh.access ?? {};
    const missing = ACCESS_KEYS.filter((key) => access[key] === undefined);
    const seats = access.serviceTokensDoNotConsumeSeats === true && access.oneSharedServiceToken === true && Array.isArray(mesh.mesh.endpointSuffixes) && mesh.mesh.endpointSuffixes.length === 0;
    findings.push(finding("workers", "access.limits", missing.length === 0 && seats, missing.length === 0 ? "one shared token, no proxy suffixes" : `missing ${missing.join(",")}`));
    const equipped = INFRA_TOOLS.every((name) => mesh.tools.some((tool) => tool.name === name && tool.trusted && tool.callable && tool.destructive === false));
    findings.push(finding("workers", "agents.equipped", equipped, equipped ? "discover, doctor, mesh tools" : "infra tools incomplete"));
    const wrangler = await readText(join(root, "plugins/cloudflare/wrangler.jsonc"));
    const worker = await readText(join(root, "plugins/cloudflare/worker.mjs"));
    const logsOk = Boolean(wrangler?.text && worker?.text)
      && wrangler.text.includes('"class_name": "LogStream"')
      && wrangler.text.includes('"new_sqlite_classes": ["LogStream"]')
      && wrangler.text.includes('"run_worker_first": true')
      && !wrangler.text.includes("SELFHOST_LOG_DEV")
      && worker.text.includes('getByName("host")')
      && worker.text.includes("handleLogRequest");
    findings.push(finding("workers", "logs.durable-object", logsOk, logsOk ? "sqlite LogStream, same access gate" : "log worker config"));
    const home = await scanHome(env, root);
    findings.push(finding("workers", "home.jail", home.ok, home.detail));
  }

  const relevant = findings.filter((item) => groups.has(item.level));
  return {
    schema: DOCTOR_SCHEMA,
    level,
    ok: relevant.every((item) => item.ok),
    stores: {
      home: paths.root,
      weights: paths.gguf,
      containers: paths.containers,
    },
    levels: [...LEVELS],
    findings: relevant,
  };
}
