// Remove this account's self-hosted install.
// Default keeps the GGUF library, Apple container images, the llm and decision
// server homes, and the agent-desktop sandbox.
// --all removes those too.
// SELFHOST_HOME, SELFHOST_LAUNCHCTL, and SELFHOST_LAUNCHD_DOMAIN are for tests.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { KEEP, MANAGED_LABELS, homeDir, layout, userHome } from "../lib/paths.mjs";

const all = process.argv.includes("--all");
const user = userHome();
const paths = layout();
const root = resolve(paths.root);
const launchctl = process.env.SELFHOST_LAUNCHCTL ?? "launchctl";

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function assertSafeRoot() {
  const home = resolve(user);
  if (root === "/" || root === home || root === "/Users" || root === "/home" || !root.startsWith(`${home}${sep}`)) {
    die(`refusing to nuke ${root}`, 2);
  }
}

function domain() {
  if (process.env.SELFHOST_LAUNCHD_DOMAIN) return process.env.SELFHOST_LAUNCHD_DOMAIN;
  try {
    const uid = execFileSync("id", ["-u"], { encoding: "utf8" }).trim();
    return `gui/${uid}`;
  } catch {
    return "gui/0";
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function labels() {
  const extra = readJson(paths.labels);
  const recorded = Array.isArray(extra?.labels) ? extra.labels : [];
  return [...new Set([...MANAGED_LABELS, ...recorded.filter((item) => typeof item === "string")])];
}

function recordedLinks() {
  const doc = readJson(paths.links);
  const recorded = Array.isArray(doc?.links) ? doc.links : [];
  const known = Object.values(paths.legacy).map((path) => ({ path, target: "" }));
  return [...recorded, ...known];
}

function launchctlMissing(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

function bootout(label) {
  try {
    execFileSync(launchctl, ["bootout", `${domain()}/${label}`], { stdio: "ignore" });
  } catch (error) {
    if (!launchctlMissing(error)) {
      // Not loaded, or launchctl refused. The plist is still removed below.
    }
  }
  rmSync(join(user, "Library/LaunchAgents", `${label}.plist`), { force: true });
  rmSync(join(user, "Library/LaunchAgents", `${label}.plist.replaced`), { force: true });
}

function linkTarget(path) {
  const raw = readlinkSync(path);
  return resolve(dirname(path), raw);
}

function inside(path, parent) {
  const abs = resolve(path);
  const dir = resolve(parent);
  return abs === dir || abs.startsWith(`${dir}${sep}`);
}

function removeLink(entry) {
  let stat;
  try {
    stat = lstatSync(entry.path);
  } catch {
    return;
  }
  if (!stat.isSymbolicLink()) return;
  let target;
  try {
    target = linkTarget(entry.path);
  } catch {
    return;
  }
  if (!inside(target, root)) return;
  if (!all && KEEP.some((name) => inside(target, join(root, name)))) return;
  unlinkSync(entry.path);
}

function oursBin(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return false;
  }
  if (stat.isSymbolicLink()) {
    try {
      const target = linkTarget(path);
      return inside(target, root) || target.endsWith(`${sep}github-repos${sep}ghref`) || target.endsWith(`${sep}ghref`);
    } catch {
      return false;
    }
  }
  try {
    const text = readFileSync(path, "utf8");
    return text.includes("token-file") && text.includes("cloudflared") && text.includes("tunnel");
  } catch {
    return false;
  }
}

function removeBins() {
  for (const path of [join(user, ".local/bin/ghref"), join(user, ".local/bin/cloudflared-tunnel")]) {
    if (oursBin(path)) unlinkSync(path);
  }
}

function removeChildren() {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    if (!all && KEEP.includes(name)) continue;
    rmSync(join(root, name), { recursive: true, force: true });
  }
  if (all) rmSync(root, { recursive: true, force: true });
}

function stillLoaded(label) {
  try {
    execFileSync(launchctl, ["print", `${domain()}/${label}`], { stdio: "ignore" });
    return true;
  } catch (error) {
    if (launchctlMissing(error)) return false;
    return false;
  }
}

function assertClean(managed, links) {
  const problems = [];
  for (const label of managed) {
    const plist = join(user, "Library/LaunchAgents", `${label}.plist`);
    if (existsSync(plist)) problems.push(`plist still present: ${label}`);
    if (stillLoaded(label)) problems.push(`still loaded: ${label}`);
  }
  if (existsSync(root)) {
    const left = readdirSync(root).sort();
    const allowed = all ? [] : [...KEEP].sort();
    for (const name of left) {
      if (!allowed.includes(name)) problems.push(`left behind: ${name}`);
    }
  }
  for (const entry of links) {
    let stat;
    try {
      stat = lstatSync(entry.path);
    } catch {
      continue;
    }
    if (!stat.isSymbolicLink()) continue;
    try {
      const target = linkTarget(entry.path);
      if (!inside(target, root)) continue;
      if (!all && KEEP.some((name) => inside(target, join(root, name)))) continue;
      problems.push(`symlink still present: ${entry.path}`);
    } catch {
      problems.push(`symlink still present: ${entry.path}`);
    }
  }
  if (problems.length > 0) die(problems.join("\n"));
}

assertSafeRoot();
const managed = labels();
const links = recordedLinks();
for (const label of managed) bootout(label);
for (const entry of links) removeLink(entry);
removeBins();
removeChildren();
assertClean(managed, links);
if (all) console.log("clean. removed ~/.self-hosted");
else console.log(`clean. kept: ${KEEP.join(", ")}`);
