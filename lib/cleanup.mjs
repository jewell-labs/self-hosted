// Each plugin's cleanup.json names the paths nuke keeps.
// A path is relative to that plugin's directory under the self-hosted home.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, sep } from "node:path";

export const CLEANUP_SCHEMA = "jewell-labs.self-hosted.cleanup.v1";

const PLUGIN_ID = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

function fail(id) {
  throw new Error(`cleanup ${id}`);
}

function pluginKeep(id, entry) {
  if (typeof entry !== "string") fail(id);
  if (entry === "." || entry === "") return id;
  if (entry.startsWith("/") || entry.includes("\\")) fail(id);
  const parts = entry.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) fail(id);
  return `${id}/${entry}`;
}

function readOne(id, file) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail(id);
  }
  if (doc?.schema !== CLEANUP_SCHEMA || !Array.isArray(doc.keep)) fail(id);
  return { id, keep: doc.keep.map((entry) => pluginKeep(id, entry)) };
}

export function loadCleanup(repoRoot) {
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(join(repoRoot, "catalog/plugins.json"), "utf8"));
  } catch {
    throw new Error("cleanup catalog");
  }
  if (!Array.isArray(catalog.plugins)) throw new Error("cleanup catalog");
  const byId = new Map();
  for (const plugin of catalog.plugins) {
    const id = plugin?.id;
    if (typeof id !== "string" || !PLUGIN_ID.test(id)) throw new Error("cleanup catalog");
    const top = join(repoRoot, id, "cleanup.json");
    const nested = join(repoRoot, "plugins", id, "cleanup.json");
    const topExists = existsSync(top);
    const nestedExists = existsSync(nested);
    if (topExists === nestedExists) fail(id);
    byId.set(id, readOne(id, topExists ? top : nested));
  }
  const pluginsDir = join(repoRoot, "plugins");
  if (existsSync(pluginsDir)) {
    for (const name of readdirSync(pluginsDir)) {
      if (byId.has(name) || !PLUGIN_ID.test(name)) continue;
      const file = join(pluginsDir, name, "cleanup.json");
      if (!existsSync(file)) continue;
      byId.set(name, readOne(name, file));
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function keepRelPaths(repoRoot) {
  const paths = [];
  for (const item of loadCleanup(repoRoot)) paths.push(...item.keep);
  return [...new Set(paths)].sort();
}

export function relation(rel, keep) {
  const norm = String(rel).split(sep).join("/");
  if (norm === "" || norm === ".") return keep.length > 0 ? "ancestor" : "drop";
  for (const item of keep) {
    if (norm === item || norm.startsWith(`${item}/`)) return "keep";
  }
  for (const item of keep) {
    if (item.startsWith(`${norm}/`)) return "ancestor";
  }
  return "drop";
}

function childRel(rel, name) {
  const base = String(rel).split(sep).join("/");
  if (base === "" || base === ".") return name;
  return `${base}/${name}`;
}

// Delete dir except the keep paths. An empty parent of a keep path is removed.
export function removeSpared(dir, rel, keep) {
  const kind = relation(rel, keep);
  if (kind === "keep") return;
  if (kind === "drop") {
    rmSync(dir, { recursive: true, force: true });
    return;
  }
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) removeSpared(join(dir, name), childRel(rel, name), keep);
  if (rel !== "" && rel !== ".") {
    try {
      if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
    } catch {
      // Already gone.
    }
  }
}
