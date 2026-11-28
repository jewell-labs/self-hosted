// A package is a top-level directory. There is no catalog file.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ID = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const EVENT_SCHEMA = "jewell-labs.self-hosted.event.v1";
export const CLEANUP_SCHEMA = "jewell-labs.self-hosted.cleanup.v1";
export const REQUIRED_FILES = Object.freeze([
  "README.md",
  "AGENTS.md",
  "plugin.json",
  "event.json",
  "setup.mjs",
  "teardown.mjs",
  "uninstall.mjs",
  "cleanup.json",
]);

export function packageIds(root) {
  let names = [];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names.filter((name) => {
    if (name.startsWith(".")) return false;
    try {
      const stat = lstatSync(join(root, name));
      return stat.isDirectory() && !stat.isSymbolicLink();
    } catch {
      return false;
    }
  }).sort();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function loadPlugin(root, id) {
  const doc = readJson(join(root, id, "plugin.json"));
  if (!doc || doc.id !== id) throw new Error(`plugin ${id}`);
  return doc;
}

export function pluginVersion(root, id) {
  const version = loadPlugin(root, id).version;
  if (typeof version !== "string" || version.length === 0) throw new Error(`${id} version`);
  return version;
}

function finding(file, message, fix) {
  return { check: "plugins", file, line: 1, message, fix };
}

function assetOk(asset) {
  if (!asset || typeof asset !== "object") return false;
  if (typeof asset.path !== "string" || asset.path.length === 0) return false;
  if (asset.path !== ".") {
    if (asset.path.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  }
  if (asset.scope !== "home" && asset.scope !== "package") return false;
  return typeof asset.kind === "string" && asset.kind.length > 0;
}

function hasHealth(events) {
  return Array.isArray(events) && events.some((event) => event?.type === "healthcheck" && event?.name === "healthcheck");
}

function stringList(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

export function pluginFindings(root) {
  const findings = [];
  let names = [];
  try {
    names = readdirSync(root);
  } catch (error) {
    return [finding(".", error.message ?? String(error), "run the check from the repo root")];
  }
  for (const name of names) {
    const path = join(root, name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (name === ".git") continue;
    if (stat.isSymbolicLink()) {
      findings.push(finding(name, "root entry is a symlink", `remove the symlink ${name}`));
      continue;
    }
    if (stat.isFile() && name !== "README.md" && name !== "AGENTS.md") {
      findings.push(finding(name, "root file is not README.md or AGENTS.md", `move ${name} into a package directory`));
    }
    if (stat.isDirectory() && name === "plugins") {
      findings.push(finding("plugins", "packages live in their own top-level directory", "move each directory under plugins/ to the repo root and remove plugins/"));
    }
    if (stat.isDirectory() && name === "catalog") {
      findings.push(finding("catalog", "a catalog directory is not a package", "describe each package in its own plugin.json and remove catalog/"));
    }
  }
  for (const id of packageIds(root)) {
    if (!PLUGIN_ID.test(id)) {
      findings.push(finding(id, "directory name is not a package id", "rename it to lowercase words separated by . or -"));
      continue;
    }
    for (const file of REQUIRED_FILES) {
      const rel = `${id}/${file}`;
      let stat;
      try {
        stat = lstatSync(join(root, id, file));
      } catch {
        findings.push(finding(rel, `missing ${file}`, `add ${rel}`));
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isFile()) {
        findings.push(finding(rel, `${file} is not a regular file`, `replace ${rel} with a regular file`));
      }
    }
    const manifest = `${id}/plugin.json`;
    let doc;
    try {
      doc = readJson(join(root, id, "plugin.json"));
    } catch {
      findings.push(finding(manifest, "plugin.json is not json", `write a JSON object in ${manifest}`));
      continue;
    }
    if (doc.id !== id) findings.push(finding(manifest, "id does not match the directory", `set id to ${id}`));
    if (typeof doc.summary !== "string" || doc.summary.trim().length === 0) {
      findings.push(finding(manifest, "summary is missing", "set summary to one sentence"));
    }
    if (typeof doc.proofRequired !== "boolean") {
      findings.push(finding(manifest, "proofRequired is not a boolean", "set proofRequired to true or false"));
    }
    if (!stringList(doc.match?.os)) findings.push(finding(manifest, "match.os is missing", "set match.os to the operating systems this package runs on"));
    if (!stringList(doc.match?.arch)) findings.push(finding(manifest, "match.arch is missing", "set match.arch to the architectures this package runs on"));
    if (!Array.isArray(doc.assets) || doc.assets.length === 0 || !doc.assets.every(assetOk)) {
      findings.push(finding(manifest, "assets are missing or invalid", "list each asset with path, scope home or package, and kind"));
    } else if (!doc.assets.some((asset) => asset.scope === "home")) {
      findings.push(finding(manifest, "no home asset", "declare one asset with scope home"));
    }
    if (!hasHealth(doc.events)) {
      findings.push(finding(manifest, "healthcheck event is missing", "add an events entry with type healthcheck and name healthcheck"));
    }
    if (doc.version !== undefined && (typeof doc.version !== "string" || doc.version.length === 0)) {
      findings.push(finding(manifest, "version is empty", "set version to the pinned release or remove the field"));
    }
    const eventFile = `${id}/event.json`;
    try {
      const event = readJson(join(root, id, "event.json"));
      if (event.schema !== EVENT_SCHEMA || event.plugin !== id || !hasHealth(event.events)) {
        findings.push(finding(eventFile, "event.json does not declare this package healthcheck", `set schema ${EVENT_SCHEMA}, plugin ${id}, and a healthcheck event`));
      }
    } catch {
      findings.push(finding(eventFile, "event.json is not json", `write the event record in ${eventFile}`));
    }
    const cleanupFile = `${id}/cleanup.json`;
    try {
      const cleanup = readJson(join(root, id, "cleanup.json"));
      const keep = cleanup.keep;
      const keepOk = (entry) => {
        if (typeof entry !== "string" || entry.startsWith("/") || entry.includes("\\")) return false;
        if (entry === "." || entry === "") return true;
        return entry.split("/").every((part) => part !== "" && part !== "." && part !== "..");
      };
      const bad = cleanup.schema !== CLEANUP_SCHEMA || !Array.isArray(keep) || keep.some((entry) => !keepOk(entry));
      if (bad) findings.push(finding(cleanupFile, "keep list is missing or not relative", "set schema and keep to paths uninstall leaves under this package home"));
    } catch {
      findings.push(finding(cleanupFile, "cleanup.json is not json", `write the keep list in ${cleanupFile}`));
    }
  }
  return findings;
}
