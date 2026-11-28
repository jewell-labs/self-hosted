// Each plugin's cleanup.json names the paths that plugin's uninstall leaves.
// A path is relative to that plugin's directory under the self-hosted home.
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import { CLEANUP_SCHEMA, packageIds } from "./plugins.mjs";

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
  return packageIds(repoRoot).map((id) => readOne(id, join(repoRoot, id, "cleanup.json")));
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
