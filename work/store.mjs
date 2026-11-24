import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { repoRoot } from "../lib/discover.mjs";
import { layout } from "../lib/paths.mjs";
import { loadDescriptors } from "./harnesses.mjs";
import { repoName, workPath } from "./names.mjs";

const execFileAsync = promisify(execFile);
export const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const HARNESS_BIN = new Set(["grok", "claude", "codex", "pi"]);

export function projectLines(text) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !line.startsWith("interval_seconds="));
}

export async function readProjects(env = process.env) {
  const root = env.SELFHOST_ROOT ?? repoRoot();
  const text = await readFile(join(root, "github-repos/config"), "utf8");
  return projectLines(text);
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
  if (!projects.includes(input.project)) throw new Error("project is not in github-repos/config");
  const harnesses = await loadDescriptors(env.SELFHOST_ROOT ?? repoRoot());
  if (!harnesses.some((item) => item.id === input.harness)) throw new Error("unknown harness");
  const branch = input.branch ?? "main";
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error("branch is not a ref name");
  const root = workRoot(env);
  const dir = workPath(root, input);
  try {
    await readdir(dir);
    throw new Error("work directory already exists");
  } catch (error) {
    if (error.message === "work directory already exists") throw error;
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(root, { recursive: true });
  const remote = `https://github.com/${input.project}.git`;
  let sha = "";
  try {
    sha = await clone({ remote, branch, dir });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  const meta = {
    project: input.project,
    remote,
    branch,
    harness: input.harness,
    domain: input.domain,
    slug: input.slug,
    createdAt: new Date().toISOString(),
    head: sha,
  };
  await writeFile(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return { ...meta, dir, name: repoName(input.project) };
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
