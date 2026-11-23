import { execFile } from "node:child_process";
import { readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { buildDiscovery, repoRoot } from "./discover.mjs";

const execFileAsync = promisify(execFile);

export const MCP_SCHEMA = "jewell-labs.agents.mcp.v1";
export const MESH_SCHEMA = "jewell-labs.agents.mesh.v1";
export const LSP_SCHEMA = "jewell-labs.agents.lsp.v1";

const RUN_TYPES = new Set(["setup", "check", "discover", "mesh-list", "mesh-lsp", "mesh-skill"]);
const INFRA_RUN_TYPES = new Set(["discover", "mesh-list", "mesh-lsp", "mesh-skill"]);
const NAME_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const SKILL_NAME_RE = /^[a-z0-9-]+$/;
const SECRET_RE = /BEGIN OPENSSH PRIVATE KEY|cfast_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
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

function annotations(tool) {
  return {
    readOnlyHint: tool.run.type !== "setup" && tool.destructive !== true,
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
  if (run.type === "setup" || run.type === "check") {
    if (infra) throw new MeshError(`${tool.name} is not an infra tool`);
    if (run.plugin !== pluginId) throw new MeshError(`${tool.name} plugin`);
    if (Object.keys(run).length !== 2) throw new MeshError(`${tool.name} run keys`);
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
    run: run.type === "setup" || run.type === "check" ? { type: run.type, plugin: pluginId } : { type: run.type },
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
  const catalog = JSON.parse(await readOwn(join(root, "catalog/plugins.json")));
  const ids = catalog.plugins.map((plugin) => plugin.id);
  const tools = [];
  const skills = [];

  const infraPath = join(root, ".agents", "mcp.json");
  const infra = JSON.parse(await readOwn(infraPath));
  if (infra.schema !== MCP_SCHEMA || !Array.isArray(infra.tools)) throw new MeshError(`${infraPath} schema`);
  for (const tool of infra.tools) tools.push(validateTool(tool, { pluginId: null, infra: true }));

  for (const id of ids) {
    const dir = join(root, "plugins", id, ".agents");
    const doc = JSON.parse(await readOwn(join(dir, "mcp.json")));
    if (doc.schema !== MCP_SCHEMA || !Array.isArray(doc.tools)) throw new MeshError(`${id} schema`);
    const kinds = new Set();
    for (const tool of doc.tools) {
      const validated = validateTool(tool, { pluginId: id, infra: false });
      if (tools.some((item) => item.name === validated.name)) throw new MeshError(`duplicate tool ${validated.name}`);
      kinds.add(validated.run.type);
      tools.push(validated);
    }
    if (!kinds.has("setup") || !kinds.has("check")) throw new MeshError(`${id} needs setup and check`);
    const skillText = await readOwn(join(dir, "SKILL.md"));
    if (skillName(skillText) !== id) throw new MeshError(`skill ${id}`);
    skills.push({ name: id, path: join(dir, "SKILL.md"), trusted: true, repo: OWN_REPO });
  }

  for (const name of ["mesh", "lsp"]) {
    const file = join(root, ".agents", "skills", name, "SKILL.md");
    const text = await readOwn(file);
    if (skillName(text) !== name) throw new MeshError(`skill ${name}`);
    skills.push({ name, path: file, trusted: true, repo: OWN_REPO });
  }

  const mesh = JSON.parse(await readOwn(join(root, ".agents", "mesh.json")));
  if (mesh.schema !== MESH_SCHEMA || !Array.isArray(mesh.endpointSuffixes)) throw new MeshError("mesh.json");
  const lsp = JSON.parse(await readOwn(join(root, ".agents", "lsp.json")));
  if (lsp.schema !== LSP_SCHEMA || !Array.isArray(lsp.servers)) throw new MeshError("lsp.json");

  const repos = [{ name: OWN_REPO, trusted: true, present: true }];
  const skipped = [];
  const store = env.GHREF_REF ?? join(homedir(), "github");
  for (const spec of repoLines(await readOwn(join(root, "github-repos/config")))) {
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
  const root = env.SELFHOST_ROOT ?? repoRoot();
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, pluginId], {
      cwd: root,
      env: { ...env, SELFHOST_ROOT: root },
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return { text: `${stdout}${stderr}`, isError: false };
  } catch (error) {
    const stdout = error.stdout?.toString?.() ?? "";
    const stderr = error.stderr?.toString?.() ?? "";
    return { text: `${stdout}${stderr}`, isError: true };
  }
}

async function runTrusted(tool, args, env, mesh) {
  if (tool.run.type === "discover") return { text: JSON.stringify(buildDiscovery(env)), isError: false };
  if (tool.run.type === "mesh-list") return { text: JSON.stringify(publicMesh(mesh)), isError: false };
  if (tool.run.type === "mesh-lsp") {
    if (args.name !== undefined && (typeof args.name !== "string" || !SKILL_NAME_RE.test(args.name))) throw new MeshError("lsp name");
    const servers = args.name ? mesh.lsp.servers.filter((server) => server.name === args.name) : mesh.lsp.servers;
    return { text: JSON.stringify({ schema: LSP_SCHEMA, servers }), isError: false };
  }
  if (tool.run.type === "mesh-skill") {
    if (typeof args.name !== "string" || !SKILL_NAME_RE.test(args.name)) throw new MeshError("skill name");
    const skill = mesh.skills.find((item) => item.name === args.name);
    if (!skill) throw new MeshError(`unknown skill ${args.name}`);
    const text = await readFile(skill.path, "utf8");
    const body = skill.trusted ? text : `repo: ${skill.repo}\n${text}`;
    return { text: body, isError: false };
  }
  if (tool.run.type === "setup") return runNode("bin/setup.mjs", tool.run.plugin, env);
  if (tool.run.type === "check") return runNode("bin/check.mjs", tool.run.plugin, env);
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
  const result = await runTrusted(tool, input, env, mesh);
  return { content: [{ type: "text", text: result.text }], isError: result.isError };
}
