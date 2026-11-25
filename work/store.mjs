import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { repoRoot } from "../lib/discover.mjs";
import { realInside, writeInside } from "../lib/jail.mjs";
import { homeDir, layout, pluginDir } from "../lib/paths.mjs";
import { loadDescriptors } from "./harnesses.mjs";
import { repoName, workPath } from "./names.mjs";

const execFileAsync = promisify(execFile);
export const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
export const PROJECTS_SCHEMA = "jewell-labs.self-hosted.projects.v1";
const REF = /^[A-Za-z0-9._/-]+$/;
const HARNESS_BIN = new Set(["grok", "claude", "codex", "pi"]);

export function projectLines(text) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !line.startsWith("interval_seconds="));
}

function sameProject(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

function projectsPath(env) {
  return join(pluginDir("work", env), "projects.json");
}

export function chooseProject(answer, projects) {
  const text = String(answer ?? "").trim();
  if (/^\d+$/.test(text)) {
    const project = projects[Number(text) - 1];
    if (!project) throw new Error("project number is not in the list");
    return { project, add: false };
  }
  repoName(text);
  const found = projects.find((item) => sameProject(item, text));
  if (found) return { project: found, add: false };
  return { project: text, add: true };
}

async function readStateProjects(env) {
  let text = "";
  try {
    text = await readFile(await realInside(homeDir(env), projectsPath(env)), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("projects state");
  }
  if (!doc || doc.schema !== PROJECTS_SCHEMA || !Array.isArray(doc.projects)) throw new Error("projects state");
  const seen = new Set();
  const projects = [];
  for (const item of doc.projects) {
    if (!item || typeof item.name !== "string" || typeof item.branch !== "string") throw new Error("projects state");
    repoName(item.name);
    if (!REF.test(item.branch) || seen.has(item.name.toLowerCase())) throw new Error("projects state");
    seen.add(item.name.toLowerCase());
    projects.push({ name: item.name, branch: item.branch });
  }
  return projects;
}

async function writeStateProjects(env, projects) {
  const body = `${JSON.stringify({ schema: PROJECTS_SCHEMA, projects }, null, 2)}\n`;
  await writeInside(homeDir(env), projectsPath(env), body);
}

export async function readProjects(env = process.env) {
  const root = env.SELFHOST_ROOT ?? repoRoot();
  const text = await readFile(join(root, "github-repos/config"), "utf8");
  const names = projectLines(text);
  for (const item of await readStateProjects(env)) {
    if (!names.some((name) => sameProject(name, item.name))) names.push(item.name);
  }
  return names;
}

export async function projectBranch(project, env = process.env) {
  const found = (await readStateProjects(env)).find((item) => sameProject(item.name, project));
  return found?.branch;
}

async function gitHead(remote) {
  const { stdout } = await execFileAsync("git", ["ls-remote", "--symref", remote, "HEAD"], {
    timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

export async function inspectProject(project, run = gitHead) {
  repoName(project);
  const remote = `https://github.com/${project}.git`;
  let text = "";
  try {
    text = await run(remote);
  } catch {
    throw new Error("project is not reachable");
  }
  if (typeof text !== "string") throw new Error("project is not reachable");
  let branch = "";
  for (const line of text.split("\n")) {
    const match = line.match(/^ref: refs\/heads\/([A-Za-z0-9._/-]+)\tHEAD$/);
    if (match) branch = match[1];
  }
  if (!REF.test(branch)) throw new Error("project has no default branch");
  return { project, remote, branch };
}

export async function ensureProject(project, env = process.env, inspect = inspectProject) {
  const known = await readProjects(env);
  const found = known.find((item) => sameProject(item, project));
  if (found) return { name: found, branch: (await projectBranch(found, env)) ?? "main", added: false };
  const info = await inspect(project);
  const state = await readStateProjects(env);
  state.push({ name: info.project, branch: info.branch });
  await writeStateProjects(env, state);
  return { name: info.project, branch: info.branch, added: true };
}

export function workRoot(env = process.env) {
  return env.SELFHOST_WORK_ROOT ?? layout(env).work;
}

function inside(root, dir) {
  return dir === root || dir.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

async function gitClone(spec) {
  await execFileAsync("git", ["clone", "--branch", spec.branch, "--single-branch", spec.remote, spec.dir], { timeout: 600_000 });
  const { stdout } = await execFileAsync("git", ["-C", spec.dir, "rev-parse", "HEAD"], { timeout: 30_000 });
  return stdout.trim();
}

export async function createWork(input, env = process.env, clone = gitClone) {
  const projects = await readProjects(env);
  const project = projects.find((item) => sameProject(item, input.project ?? ""));
  if (!project) throw new Error("project is not in the project list");
  const harnesses = await loadDescriptors(env.SELFHOST_ROOT ?? repoRoot());
  if (!harnesses.some((item) => item.id === input.harness)) throw new Error("unknown harness");
  const branch = input.branch ?? (await projectBranch(project, env)) ?? "main";
  if (!REF.test(branch)) throw new Error("branch is not a ref name");
  const root = workRoot(env);
  const dir = workPath(root, { ...input, project });
  try {
    await readdir(dir);
    throw new Error("work directory already exists");
  } catch (error) {
    if (error.message === "work directory already exists") throw error;
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(root, { recursive: true });
  const remote = `https://github.com/${project}.git`;
  let sha = "";
  try {
    sha = await clone({ remote, branch, dir });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  const meta = {
    project,
    remote,
    branch,
    harness: input.harness,
    domain: input.domain,
    slug: input.slug,
    createdAt: new Date().toISOString(),
    head: sha,
  };
  await writeFile(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return { ...meta, dir, name: repoName(project) };
}

export async function listWork(env = process.env) {
  const root = workRoot(env);
  let names = [];
  try {
    names = await readdir(root);
  } catch {
    names = [];
  }
  const works = [];
  for (const name of names) {
    try {
      const meta = JSON.parse(await readFile(join(root, name, "meta.json"), "utf8"));
      works.push({ ...meta, dir: join(root, name) });
    } catch {
      // A directory without meta.json is not a work record.
    }
  }
  return { projects: await readProjects(env), works };
}

export async function liveHarnessCwds() {
  let listed = "";
  try {
    const { stdout } = await execFileAsync("ps", ["-ax", "-o", "pid=,command="], { timeout: 20_000 });
    listed = stdout;
  } catch {
    throw new Error("ps failed; refusing to clean");
  }
  const pids = [];
  for (const line of listed.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\S+)/);
    if (!match) continue;
    const base = match[2].split("/").pop();
    if (HARNESS_BIN.has(base)) pids.push(match[1]);
  }
  if (pids.length === 0) return new Set();
  let cwdText = "";
  try {
    const { stdout } = await execFileAsync("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-Fn"], { timeout: 20_000 });
    cwdText = stdout;
  } catch {
    throw new Error("lsof failed; refusing to clean");
  }
  const live = new Set();
  for (const line of cwdText.split("\n")) {
    if (line.startsWith("n")) live.add(line.slice(1));
  }
  return live;
}

export async function cleanWork(env = process.env, opts = {}) {
  const root = workRoot(env);
  const now = opts.now ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? MAX_AGE_MS;
  const live = opts.live ?? await liveHarnessCwds();
  const remove = opts.rm ?? ((dir) => rm(dir, { recursive: true, force: true }));
  let names = [];
  try {
    names = await readdir(root);
  } catch {
    return { removed: [], kept: [] };
  }
  const removed = [];
  const kept = [];
  for (const name of names) {
    const dir = join(root, name);
    let meta;
    try {
      meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
    } catch {
      kept.push({ dir, reason: "no meta" });
      continue;
    }
    const created = Date.parse(meta.createdAt);
    if (!Number.isFinite(created) || now - created < maxAgeMs) {
      kept.push({ dir, reason: "young" });
      continue;
    }
    if (!inside(root, dir)) {
      kept.push({ dir, reason: "outside" });
      continue;
    }
    if (live.has(dir)) {
      kept.push({ dir, reason: "live" });
      continue;
    }
    await remove(dir);
    removed.push(dir);
  }
  return { removed, kept };
}

export function defaultHome() {
  return homedir();
}
