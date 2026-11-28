import { execFile } from "node:child_process";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { publishEvent } from "./publish.mjs";
import { layout } from "./paths.mjs";
import { promisify } from "node:util";
import { buildDiscovery, repoRoot } from "./discover.mjs";
import { packageIds } from "./plugins.mjs";
import { SECRET_RE } from "./secret.mjs";
import { declareWorkflow, describeHistory, eventDefinition, eventLog, EventError, historyFilter, loadWebhooks, readEvents, reportEvals } from "./events.mjs";

const execFileAsync = promisify(execFile);

const TOOL_CALLS = {
  "simulators-list": ["simulators", "simulatorList", (fn, args, env) => fn(env)],
  "simulators-boot": ["simulators", "simulatorBoot", (fn, args, env) => fn(args, env)],
  "simulators-shutdown": ["simulators", "simulatorShutdown", (fn, args, env) => fn(args, env)],
  "simulators-openurl": ["simulators", "simulatorOpen", (fn, args, env) => fn(args, env)],
  "portless-status": ["portless", "portlessStatus", (fn) => fn()],
  "portless-urls": ["portless", "portlessUrls", (fn, args, env) => fn(args, env)],
  "portless-forward": ["portless", "portlessForward", (fn) => fn()],
  "cloudflare-access": ["cloudflare", "cloudflareAccess", (fn, args, env) => fn(env)],
  "cloudflare-auth": ["cloudflare", "cloudflareAuth", (fn, args, env) => fn(env)],
  "cloudflare-logs": ["cloudflare", "cloudflareLogs", (fn, args, env) => fn(env)],
  "cloudflare-admin": ["cloudflare", "cloudflareAdmin", (fn, args, env) => fn(env)],
  "cloudflare-apply": ["cloudflare", "cloudflareApply", (fn, args, env) => fn(args, env)],
  "cloudflare-token": ["cloudflare", "cloudflareToken", (fn, args, env) => fn(env)],
  "decision-models": ["decision", "decisionModels", (fn, args, env) => fn(env)],
  "decision-call": ["decision", "decisionCall", (fn, args, env) => fn(args, env)],
  "decision-config": ["decision", "decisionConfig", (fn, args, env) => fn(args, env)],
  "decision-usage": ["decision", "decisionUsage", (fn, args, env) => fn(env)],
  "decision-download": ["decision", "decisionDownload", (fn, args, env) => fn(args, env)],
  "decision-remove": ["decision", "decisionRemove", (fn, args, env) => fn(args, env)],
  "decision-sample": ["decision", "decisionSample", (fn, args, env) => fn(args, env)],
  "llm-models": ["llm", "llmModels", (fn, args, env) => fn(env)],
  "llm-config": ["llm", "llmConfig", (fn, args, env) => fn(args, env)],
  "llm-usage": ["llm", "llmUsage", (fn, args, env) => fn(env)],
  "llm-download": ["llm", "llmDownload", (fn, args, env) => fn(args, env)],
  "llm-remove": ["llm", "llmRemove", (fn, args, env) => fn(args, env)],
  "llm-sample": ["llm", "llmSample", (fn, args, env) => fn(args, env)],
  "work-list": ["work", "workList", (fn, args, env) => fn(env)],
  "work-create": ["work", "workCreate", (fn, args, env) => fn(args, env)],
  "work-clean": ["work", "workClean", (fn, args, env) => fn(env)],
  "harness-list": ["work", "harnessList", (fn, args, env) => fn(env)],
  "harness-run": ["work", "harnessRun", (fn, args, env, opts) => fn(args, env, { bus: opts.bus })],
  "evals-list": ["evals", "evalsList", (fn) => fn()],
  "evals-run": ["evals", "evalsRun", (fn, args, env, opts) => fn(args, env, opts)],
  "evals-report": ["evals", "evalsReport", (fn, args, env) => fn(env)],
};

async function runPluginTool(type, args, env, opts) {
  const spec = TOOL_CALLS[type];
  if (!spec) return null;
  const [id, exportName, call] = spec;
  const root = env.SELFHOST_ROOT ?? repoRoot();
  const href = pathToFileURL(join(root, id, "tools.mjs")).href;
  const mod = await import(href);
  const fn = mod[exportName];
  if (typeof fn !== "function") throw new MeshError(`missing ${exportName} in ${id}`);
  return call(fn, args, env, opts);
}


export const MCP_SCHEMA = "jewell-labs.agents.mcp.v1";
export const MESH_SCHEMA = "jewell-labs.agents.mesh.v1";
export const LSP_SCHEMA = "jewell-labs.agents.lsp.v1";

const INFRA_RUN_TYPES = new Set(["discover", "mesh-list", "mesh-lsp", "mesh-skill", "doctor", "events-webhooks", "events-history", "events-describe", "events-workflow", "repos", "explore", "sync", "prove", "attach-plan", "attach-run", "attach-macos", "adopt", "flake"]);
const PLUGIN_OWNER = {
  setup: "",
  check: "",
  remove: "",
  "simulators-list": "simulators",
  "simulators-boot": "simulators",
  "simulators-shutdown": "simulators",
  "simulators-openurl": "simulators",
  "portless-status": "portless",
  "portless-urls": "portless",
  "portless-forward": "portless",
  "cloudflare-access": "cloudflare",
  "cloudflare-auth": "cloudflare",
  "cloudflare-logs": "cloudflare",
  "cloudflare-admin": "cloudflare",
  "cloudflare-apply": "cloudflare",
  "cloudflare-token": "cloudflare",
  "decision-models": "decision",
  "decision-call": "decision",
  "decision-config": "decision",
  "decision-usage": "decision",
  "decision-download": "decision",
  "decision-remove": "decision",
  "decision-sample": "decision",
  "llm-models": "llm",
  "llm-config": "llm",
  "llm-usage": "llm",
  "llm-download": "llm",
  "llm-remove": "llm",
  "llm-sample": "llm",
  "work-list": "work",
  "work-create": "work",
  "work-clean": "work",
  "harness-list": "work",
  "harness-run": "work",
  "evals-list": "evals",
  "evals-run": "evals",
  "evals-report": "evals",
};
const WRITE_RUNS = new Set(["llm-download", "llm-remove", "decision-download", "decision-remove", "events-workflow"]);
const DESTRUCTIVE_RUN = new Set(["simulators-boot", "simulators-shutdown", "simulators-openurl", "portless-forward", "cloudflare-apply", "work-create", "work-clean", "harness-run", "remove"]);
const RUN_TYPES = new Set([...INFRA_RUN_TYPES, ...Object.keys(PLUGIN_OWNER)]);
const NAME_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const SKILL_NAME_RE = /^[a-z0-9-]+$/;
const OWN_REPO = "jewell-labs/self-hosted";

export class MeshError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "MeshError";
    this.status = status;
  }
}

export function rejectSecrets(text, path) {
  if (SECRET_RE.test(text)) throw new MeshError(`refusing ${path}: secret material`);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function pluginAgentDir(root, id) {
  return join(root, id, ".agents");
}

function annotations(tool) {
  return {
    readOnlyHint: tool.run.type !== "setup" && tool.destructive !== true && !WRITE_RUNS.has(tool.run.type),
    destructiveHint: tool.destructive === true,
    idempotentHint: true,
    openWorldHint: false,
  };
}

export function validateTool(tool, { pluginId, infra }) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) throw new MeshError("tool");
  if (typeof tool.name !== "string" || !NAME_RE.test(tool.name)) throw new MeshError(`tool name ${tool.name ?? ""}`);
  if (typeof tool.description !== "string" || tool.description.length < 8 || tool.description.length > 512) {
    throw new MeshError(`tool description ${tool.name}`);
  }
  if (typeof tool.destructive !== "boolean") throw new MeshError(`tool destructive ${tool.name}`);
  const schema = tool.inputSchema;
  if (!schema || schema.type !== "object" || schema.additionalProperties !== false || (schema.properties && typeof schema.properties !== "object")) {
    throw new MeshError(`tool inputSchema ${tool.name}`);
  }
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (typeof key !== "string" || !schema.properties?.[key]) throw new MeshError(`tool required ${tool.name}`);
    }
  }
  const run = tool.run;
  if (!run || typeof run !== "object" || typeof run.type !== "string" || !RUN_TYPES.has(run.type)) {
    throw new MeshError(`tool run ${tool.name}`);
  }
  if (Object.hasOwn(PLUGIN_OWNER, run.type)) {
    if (infra) throw new MeshError(`${tool.name} is not an infra tool`);
    if (run.plugin !== pluginId) throw new MeshError(`${tool.name} plugin`);
    if (PLUGIN_OWNER[run.type] && PLUGIN_OWNER[run.type] !== pluginId) throw new MeshError(`${tool.name} run`);
    if (Object.keys(run).length !== 2) throw new MeshError(`${tool.name} run keys`);
    if (DESTRUCTIVE_RUN.has(run.type) && tool.destructive !== true) throw new MeshError(`${tool.name} is destructive`);
    if (!DESTRUCTIVE_RUN.has(run.type) && run.type !== "setup" && tool.destructive !== false) {
      throw new MeshError(`${tool.name} is read-only`);
    }
  } else if (!INFRA_RUN_TYPES.has(run.type) || Object.keys(run).length !== 1) {
    throw new MeshError(`${tool.name} run`);
  }
  if (pluginId === "actions-runner" && run.type === "setup" && tool.destructive !== true) {
    throw new MeshError("actions-runner.setup is destructive");
  }
  return {
    name: tool.name,
    description: tool.description,
    destructive: tool.destructive,
    inputSchema: schema,
    run: Object.hasOwn(PLUGIN_OWNER, run.type) ? { type: run.type, plugin: pluginId } : { type: run.type },
    callable: true,
    trusted: true,
    repo: OWN_REPO,
  };
}

async function readOwn(path) {
  const text = await readFile(path, "utf8");
  rejectSecrets(text, path);
  return text;
}

function inside(base, file) {
  return file === base || file.startsWith(base.endsWith(sep) ? base : base + sep);
}

async function safeRead(base, file) {
  try {
    const realBase = await realpath(base);
    const realFile = await realpath(file);
    if (!inside(realBase, realFile)) return { skipped: "path" };
    const text = await readFile(realFile, "utf8");
    if (SECRET_RE.test(text)) return { skipped: "secret material" };
    return { text, path: realFile };
  } catch {
    return null;
  }
}

function repoLines(configText) {
  return configText.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !line.startsWith("interval_seconds="));
}

export function repoSpecs(configText, env = process.env) {
  const override = env.SELFHOST_REPOS ?? "";
  if (override !== "") return override.split(",").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  return repoLines(configText);
}

async function pluginDirs(checkout) {
  const dirs = [];
  let entries = [];
  try {
    entries = await readdir(join(checkout, "plugins"), { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) dirs.push(entry.name);
  }
  return dirs;
}

function skillName(text) {
  const match = text.match(/^---\n[\s\S]*?^name:\s*([a-z0-9-]+)\s*$/m);
  return match ? match[1] : "";
}

async function absorbExternal(checkout, repoName, tools, skills, skipped) {
  const files = [join(checkout, ".agents", "mcp.json")];
  for (const id of await pluginDirs(checkout)) files.push(join(checkout, "plugins", id, ".agents", "mcp.json"));
  for (const file of files) {
    const read = await safeRead(checkout, file);
    if (!read) continue;
    if (read.skipped) {
      skipped.push({ repo: repoName, reason: read.skipped });
      continue;
    }
    let doc;
    try {
      doc = JSON.parse(read.text);
    } catch {
      skipped.push({ repo: repoName, reason: "invalid json" });
      continue;
    }
    if (doc?.mcpServers && typeof doc.mcpServers === "object") {
      for (const name of Object.keys(doc.mcpServers)) {
        if (!NAME_RE.test(name) || tools.some((item) => item.name === name)) {
          skipped.push({ repo: repoName, name, reason: "name" });
          continue;
        }
        tools.push({
          name,
          description: `MCP server declared by ${repoName}. This process does not spawn it.`,
          destructive: false,
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          run: { type: "unknown" },
          callable: false,
          trusted: false,
          repo: repoName,
        });
      }
      continue;
    }
    if (!doc || doc.schema !== MCP_SCHEMA || !Array.isArray(doc.tools)) {
      skipped.push({ repo: repoName, reason: "schema" });
      continue;
    }
    for (const tool of doc.tools) {
      const name = typeof tool?.name === "string" ? tool.name : "";
      const runType = typeof tool?.run?.type === "string" ? tool.run.type : "unknown";
      if (!NAME_RE.test(name) || tools.some((item) => item.name === name)) {
        skipped.push({ repo: repoName, name, reason: "name" });
        continue;
      }
      const description = typeof tool.description === "string" ? tool.description.slice(0, 512) : "Declared by another repo.";
      const inputSchema = tool.inputSchema && tool.inputSchema.type === "object"
        ? tool.inputSchema
        : { type: "object", properties: {}, additionalProperties: false };
      tools.push({
        name,
        description,
        destructive: tool.destructive === true,
        inputSchema,
        run: { type: runType },
        callable: false,
        trusted: false,
        repo: repoName,
      });
    }
  }
  const skillFiles = [];
  const topSkills = join(checkout, ".agents", "skills");
  let skillDirs = [];
  try {
    skillDirs = await readdir(topSkills, { withFileTypes: true });
  } catch {
    skillDirs = [];
  }
  for (const entry of skillDirs) {
    if (entry.isDirectory()) skillFiles.push(join(topSkills, entry.name, "SKILL.md"));
  }
  for (const id of await pluginDirs(checkout)) skillFiles.push(join(checkout, "plugins", id, ".agents", "SKILL.md"));
  for (const file of skillFiles) {
    const read = await safeRead(checkout, file);
    if (!read?.text) continue;
    const name = skillName(read.text);
    if (!SKILL_NAME_RE.test(name) || skills.some((item) => item.name === name)) continue;
    skills.push({ name, path: read.path, trusted: false, repo: repoName });
  }
}

export async function loadMesh(env = process.env) {
  const root = env.SELFHOST_ROOT ?? repoRoot();
  const ids = [];
  for (const id of packageIds(root)) {
    if (await exists(join(root, id, ".agents", "mcp.json"))) ids.push(id);
  }
  const tools = [];
  const skills = [];

  const infraPath = join(root, ".agents", "mcp.json");
  const infra = JSON.parse(await readOwn(infraPath));
  if (infra.schema !== MCP_SCHEMA || !Array.isArray(infra.tools)) throw new MeshError(`${infraPath} schema`);
  for (const tool of infra.tools) tools.push(validateTool(tool, { pluginId: null, infra: true }));

  for (const id of ids) {
    const dir = await pluginAgentDir(root, id);
    const doc = JSON.parse(await readOwn(join(dir, "mcp.json")));
    if (doc.schema !== MCP_SCHEMA || !Array.isArray(doc.tools)) throw new MeshError(`${id} schema`);
    const kinds = new Set();
    for (const tool of doc.tools) {
      const validated = validateTool(tool, { pluginId: id, infra: false });
      if (tools.some((item) => item.name === validated.name)) throw new MeshError(`duplicate tool ${validated.name}`);
      kinds.add(validated.run.type);
      tools.push(validated);
    }
    if (!kinds.has("setup") || !kinds.has("check") || !kinds.has("remove")) throw new MeshError(`${id} needs setup, check, and remove`);
    const preferred = join(root, ".agents", "skills", id, "SKILL.md");
    const skillFile = await exists(preferred) ? preferred : join(dir, "SKILL.md");
    const skillText = await readOwn(skillFile);
    if (skillName(skillText) !== id) throw new MeshError(`skill ${id}`);
    skills.push({ name: id, path: skillFile, trusted: true, repo: OWN_REPO });
  }

  const skillRoot = join(root, ".agents", "skills");
  const skillDirs = await readdir(skillRoot, { withFileTypes: true });
  for (const entry of skillDirs) {
    if (!entry.isDirectory()) continue;
    const file = join(skillRoot, entry.name, "SKILL.md");
    if (!(await exists(file))) continue;
    const text = await readOwn(file);
    if (skillName(text) !== entry.name) throw new MeshError(`skill ${entry.name}`);
    skills.push({ name: entry.name, path: file, trusted: true, repo: OWN_REPO });
  }

  const mesh = JSON.parse(await readOwn(join(root, ".agents", "mesh.json")));
  if (mesh.schema !== MESH_SCHEMA || !Array.isArray(mesh.endpointSuffixes)) throw new MeshError("mesh.json");
  const lsp = JSON.parse(await readOwn(join(root, ".agents", "lsp.json")));
  if (lsp.schema !== LSP_SCHEMA || !Array.isArray(lsp.servers)) throw new MeshError("lsp.json");

  const repos = [{ name: OWN_REPO, trusted: true, present: true }];
  const skipped = [];
  const store = env.GHREF_REF ?? layout(env).github;
  for (const spec of repoSpecs(await readOwn(join(root, "github-repos/config")), env)) {
    if (spec === OWN_REPO) continue;
    const checkout = join(store, spec);
    let present = false;
    try {
      await realpath(checkout);
      present = true;
    } catch {
      present = false;
    }
    repos.push({ name: spec, trusted: false, present });
    if (present) await absorbExternal(checkout, spec, tools, skills, skipped);
  }

  const seen = new Set();
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new MeshError(`duplicate tool ${tool.name}`);
    seen.add(tool.name);
  }
  return { tools, skills, mesh, lsp, repos, skipped };
}

export function mcpTools(mesh) {
  return mesh.tools.map((tool) => ({
    name: tool.name,
    description: tool.callable ? tool.description : `${tool.description} Declared by ${tool.repo}. This server does not run it.`,
    inputSchema: {
      type: "object",
      properties: tool.inputSchema.properties ?? {},
      additionalProperties: false,
      ...(Array.isArray(tool.inputSchema.required) ? { required: tool.inputSchema.required } : {}),
    },
    annotations: tool.callable
      ? annotations(tool)
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));
}

function publicMesh(mesh) {
  return {
    schema: mesh.mesh.schema,
    access: mesh.mesh.access,
    endpointSuffixes: mesh.mesh.endpointSuffixes,
    repos: mesh.repos,
    tools: mesh.tools.map((tool) => ({
      name: tool.name,
      destructive: tool.destructive,
      callable: tool.callable,
      trusted: tool.trusted,
      repo: tool.repo,
      run: tool.run.type,
    })),
    skills: mesh.skills.map((skill) => ({ name: skill.name, trusted: skill.trusted, repo: skill.repo })),
    skipped: mesh.skipped,
  };
}

async function runNode(script, pluginId, env) {
  return runFile(process.execPath, [script, pluginId], env, 60_000);
}

function oneToken(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new MeshError(label);
  return value;
}

function filterArg(value) {
  if (value === undefined || value === "-") return "-";
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || /[\0\n\r]/.test(value) || value.startsWith("-")) {
    throw new MeshError("filter");
  }
  return value;
}

function modelArg(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || /[\0\n\r]/.test(value)) throw new MeshError("model");
  return value;
}

async function runFile(command, args, env, timeout) {
  const root = env.SELFHOST_ROOT ?? repoRoot();
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: root,
      env: { ...env, SELFHOST_ROOT: root },
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    const text = `${stdout ?? ""}${stderr ?? ""}`;
    return { text: text.length > 0 ? text : "ok", isError: false };
  } catch (error) {
    const stdout = error.stdout?.toString?.() ?? "";
    const stderr = error.stderr?.toString?.() ?? "";
    const text = `${stdout}${stderr}`.trim() || error.message || "failed";
    return { text, isError: true };
  }
}

async function runHost(tool, args, env) {
  const root = env.SELFHOST_ROOT ?? repoRoot();
  if (tool.run.type === "repos") return runFile("bash", [join(root, "github-repos/ghref"), "print-config"], env, 30_000);
  if (tool.run.type === "explore") return runFile(process.execPath, ["core/bin/explore.mjs"], env, 60_000);
  if (tool.run.type === "sync") return runFile("bash", [join(root, "github-repos/ghref"), "sync"], env, 600_000);
  if (tool.run.type === "prove") {
    const model = modelArg(args.model ?? env.LLM_MODEL ?? env.LLAMA_MODEL ?? "");
    return runFile(process.execPath, ["proof/prove.mjs"], { ...env, LLM_MODEL: model, LLAMA_MODEL: model }, 600_000);
  }
  if (tool.run.type === "attach-plan" || tool.run.type === "attach-run" || tool.run.type === "attach-macos") {
    const name = args.name === undefined ? "arm" : oneToken(args.name, "name");
    const filter = filterArg(args.filter);
    if (tool.run.type === "attach-plan") {
      return runFile(process.execPath, ["core/bin/attach.mjs", "plan", "--name", name, "--filter", filter], env, 60_000);
    }
    if (tool.run.type === "attach-macos") {
      const sandbox = oneToken(args.sandbox, "sandbox");
      return runFile(process.execPath, ["core/bin/attach.mjs", "macos", "--sandbox", sandbox, "--name", name, "--filter", filter], env, 120_000);
    }
    const image = args.image;
    if (typeof image !== "string" || image.length === 0 || image.length > 256 || /[\0\n\r\s]/.test(image)) throw new MeshError("image");
    const command = args.command === undefined ? [] : args.command;
    if (!Array.isArray(command) || command.some((item) => typeof item !== "string" || item.length > 256 || /[\0\n\r]/.test(item))) {
      throw new MeshError("command");
    }
    return runFile(process.execPath, ["core/bin/attach.mjs", "run", "--name", name, "--filter", filter, "--", image, ...command], env, 600_000);
  }
  if (tool.run.type === "adopt") return runFile(process.execPath, ["core/bin/adopt.mjs"], env, 120_000);
  if (tool.run.type === "flake") return runFile("nix", ["flake", "check"], env, 600_000);
  throw new MeshError(`refusing run ${tool.run.type}`);
}

async function runTrusted(tool, args, env, mesh, opts) {
  if (tool.run.type === "discover") return { text: JSON.stringify(buildDiscovery(env)), isError: false };
  if (tool.run.type === "mesh-list") return { text: JSON.stringify(publicMesh(mesh)), isError: false };
  if (tool.run.type === "mesh-lsp") {
    if (args.name !== undefined && (typeof args.name !== "string" || !SKILL_NAME_RE.test(args.name))) throw new MeshError("lsp name");
    const servers = args.name ? mesh.lsp.servers.filter((server) => server.name === args.name) : mesh.lsp.servers;
    return { text: JSON.stringify({ schema: LSP_SCHEMA, servers }), isError: false };
  }
  if (tool.run.type === "doctor") {
    const { doctor } = await import("./doctor.mjs");
    const report = await doctor(env, args);
    return { text: JSON.stringify(report), isError: report.ok === false };
  }
  if (tool.run.type === "events-history") {
    try {
      const filter = historyFilter(args ?? {});
      return { text: JSON.stringify({ schema: "jewell-labs.self-hosted.event.v1", events: readEvents(eventLog(env), filter) }), isError: false };
    } catch (error) {
      if (error instanceof EventError) return { text: error.message, isError: true };
      throw error;
    }
  }
  if (tool.run.type === "events-describe") {
    const root = env.SELFHOST_ROOT ?? repoRoot();
    const webhooks = await loadWebhooks(root);
    const events = readEvents(eventLog(env), historyFilter({}));
    return { text: JSON.stringify(describeHistory(webhooks, events)), isError: false };
  }
  if (tool.run.type === "events-webhooks") {
    const root = env.SELFHOST_ROOT ?? repoRoot();
    const webhooks = await loadWebhooks(root);
    return {
      text: JSON.stringify({
        schema: "jewell-labs.self-hosted.event.v1",
        stream: "/events",
        query: ["plugin", "type", "name"],
        detail: ["started", "ok", "error"],
        webhooks,
        definition: await eventDefinition(root),
      }),
      isError: false,
    };
  }
  if (tool.run.type === "events-workflow") {
    if (!opts.bus) return { text: "event bus is local to the mcp server", isError: true };
    try {
      const draft = declareWorkflow(await loadWebhooks(env.SELFHOST_ROOT ?? repoRoot()), args);
      const event = opts.bus.publish(draft);
      await publishEvent(env, {
        plugin: event.plugin,
        level: event.detail === "error" ? "error" : "info",
        event: event.name,
        detail: event.detail,
      });
      return { text: JSON.stringify(event), isError: false };
    } catch (error) {
      if (error instanceof EventError) return { text: error.message, isError: true };
      throw error;
    }
  }
  if (tool.run.type === "mesh-skill") {
    if (typeof args.name !== "string" || !SKILL_NAME_RE.test(args.name)) throw new MeshError("skill name");
    const skill = mesh.skills.find((item) => item.name === args.name);
    if (!skill) throw new MeshError(`unknown skill ${args.name}`);
    const text = await readFile(skill.path, "utf8");
    const body = skill.trusted ? text : `repo: ${skill.repo}\n${text}`;
    return { text: body, isError: false };
  }
  if (tool.run.type === "setup") return runNode("core/bin/setup.mjs", tool.run.plugin, env);
  if (tool.run.type === "check") return runNode("core/bin/check.mjs", tool.run.plugin, env);
  if (tool.run.type === "remove") return runFile(process.execPath, [`${tool.run.plugin}/uninstall.mjs`], env, 60_000);
  const pluginResult = await runPluginTool(tool.run.type, args, env, opts);
  if (pluginResult) return pluginResult;
  if (INFRA_RUN_TYPES.has(tool.run.type)) return runHost(tool, args, env);
  throw new MeshError(`refusing run ${tool.run.type}`);
}

export async function callTool(name, args, env = process.env, opts = {}) {
  const mesh = opts.mesh ?? await loadMesh(env);
  const tool = mesh.tools.find((item) => item.name === name);
  if (!tool) throw new MeshError(`unknown tool ${name ?? ""}`);
  if (!tool.callable || !tool.trusted || !RUN_TYPES.has(tool.run.type)) {
    return { content: [{ type: "text", text: `not executed: ${tool.name} from ${tool.repo}` }], isError: true };
  }
  if (tool.destructive && !opts.jwtVerified) throw new MeshError("cloudflare access jwt required", 401);
  const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const properties = tool.inputSchema.properties ?? {};
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(properties, key)) throw new MeshError(`unexpected argument ${key}`);
  }
  for (const key of tool.inputSchema.required ?? []) {
    if (input[key] === undefined) throw new MeshError(`missing argument ${key}`);
  }
  const result = await runTrusted(tool, input, env, mesh, opts);
  try {
    opts.bus?.publish({
      plugin: tool.run.plugin || "mesh",
      type: "tool",
      name: tool.name,
      detail: result.isError ? "error" : "ok",
    });
  } catch {
    // A stream failure must not fail the tool.
  }
  await publishEvent(env, {
    plugin: tool.run.plugin || "mesh",
    level: result.isError ? "error" : "info",
    event: tool.name,
    detail: result.isError ? "error" : "ok",
  });
  return { content: [{ type: "text", text: result.text }], isError: result.isError };
}
