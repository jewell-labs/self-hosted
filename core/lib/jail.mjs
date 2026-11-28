// Every self-hosted write goes through this file. The allowed list is core/home/policy.json.
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homeDir } from "./paths.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const HOME_SCHEMA = "jewell-labs.self-hosted.home.v1";

export class JailError extends Error {
  constructor(message) {
    super(message);
    this.name = "JailError";
  }
}

export async function loadHomePolicy(root = repoRoot) {
  const doc = JSON.parse(await readFile(join(root, "core/home/policy.json"), "utf8"));
  if (doc?.schema !== HOME_SCHEMA || !Array.isArray(doc.allowed) || !Array.isArray(doc.heavy) || !Array.isArray(doc.refuseNames)) {
    throw new JailError("home policy");
  }
  if (typeof doc.weights !== "string" || typeof doc.usageLog !== "string" || !Array.isArray(doc.probes)) throw new JailError("home policy");
  return doc;
}

async function realOrResolve(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return resolve(path);
    return join(await realOrResolve(parent), basename(path));
  }
}

export async function realInside(root, target) {
  const home = await realOrResolve(root);
  let cursor = resolve(target);
  const suffix = [];
  while (true) {
    try {
      const real = await realpath(cursor);
      const full = suffix.length === 0 ? real : join(real, ...suffix);
      if (full !== home && !full.startsWith(home + sep)) throw new JailError(`outside ${target}`);
      return full;
    } catch (error) {
      if (error instanceof JailError) throw error;
      if (error.code !== "ENOENT") throw error;
      suffix.unshift(basename(cursor));
      const parent = dirname(cursor);
      if (parent === cursor) throw new JailError(`outside ${target}`);
      cursor = parent;
    }
  }
}

export async function writeInside(root, target, data) {
  const dest = await realInside(root, target);
  await mkdir(dirname(dest), { recursive: true });
  await realInside(root, dest);
  await writeFile(dest, data);
  return dest;
}

function realSync(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return resolve(path);
    return join(realSync(parent), basename(path));
  }
}

export function realInsideSync(root, target) {
  const home = realSync(root);
  let cursor = resolve(target);
  const suffix = [];
  while (true) {
    try {
      const real = realpathSync(cursor);
      const full = suffix.length === 0 ? real : join(real, ...suffix);
      if (full !== home && !full.startsWith(home + sep)) throw new JailError(`outside ${target}`);
      return full;
    } catch (error) {
      if (error instanceof JailError) throw error;
      if (error.code !== "ENOENT") throw error;
      suffix.unshift(basename(cursor));
      const parent = dirname(cursor);
      if (parent === cursor) throw new JailError(`outside ${target}`);
      cursor = parent;
    }
  }
}

export function writeSyncInside(root, target, data) {
  const dest = realInsideSync(root, target);
  mkdirSync(dirname(dest), { recursive: true });
  realInsideSync(root, dest);
  writeFileSync(dest, data);
  return dest;
}

export async function scanHome(env = process.env, root = env.SELFHOST_ROOT ?? repoRoot) {
  const policy = await loadHomePolicy(root);
  const home = homeDir(env);
  let entries = [];
  try {
    entries = await readdir(home, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { ok: true, detail: "absent" };
    throw error;
  }
  const unknown = entries.filter((entry) => !policy.allowed.includes(entry.name)).map((entry) => entry.name);
  const refused = [];
  const escapes = [];
  const heavyAt = (rel) => {
    const norm = rel.split(sep).join("/");
    return policy.heavy.some((item) => norm === item || norm.startsWith(`${item}/`));
  };
  const walk = async (dir) => {
    const rel = relative(home, dir);
    if (rel && heavyAt(rel)) {
      let kids = [];
      try {
        kids = await readdir(dir);
      } catch {
        kids = [];
      }
      for (const name of kids) {
        if (policy.refuseNames.includes(name)) refused.push(join(rel, name));
      }
      return;
    }
    let kids = [];
    try {
      kids = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const kid of kids) {
      if (kid.name === ".git") continue;
      const path = join(dir, kid.name);
      if (policy.refuseNames.includes(kid.name)) refused.push(relative(home, path));
      if (kid.isSymbolicLink()) {
        try {
          await realInside(home, path);
        } catch {
          escapes.push(relative(home, path));
        }
        continue;
      }
      if (kid.isDirectory()) await walk(path);
    }
  };
  for (const entry of entries) {
    if (!policy.allowed.includes(entry.name) || entry.isSymbolicLink()) {
      if (entry.isSymbolicLink()) {
        try {
          await realInside(home, join(home, entry.name));
        } catch {
          escapes.push(entry.name);
        }
      }
      continue;
    }
    if (entry.isDirectory()) await walk(join(home, entry.name));
  }
  const ok = unknown.length === 0 && refused.length === 0 && escapes.length === 0;
  const detail = ok
    ? "inside home policy"
    : `unknown=${unknown.join(",") || "-"} refuse=${refused.join(",") || "-"} escape=${escapes.join(",") || "-"}`;
  return { ok, detail };
}
