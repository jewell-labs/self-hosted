// Delete one plugin's folder. Setup writes only there, so this removes the install.
// Paths listed in that plugin's cleanup.json stay. nuke uses the same files.
import { execFileSync } from "node:child_process";
import { lstatSync, readlinkSync, readdirSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { keepRelPaths, relation, removeSpared } from "../lib/cleanup.mjs";
import { buildDiscovery } from "../lib/discover.mjs";
import { homeDir, pluginDir, userHome } from "../lib/paths.mjs";

const id = process.argv[2];
if (!id || process.argv.length > 3) {
  console.error("usage: bin/selfhost bin/remove.mjs <plugin>");
  process.exit(2);
}

const known = buildDiscovery().plugins.some((plugin) => plugin.id === id);
if (!known) {
  console.error(`unknown plugin ${id}`);
  process.exit(2);
}

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
let keep = [];
try {
  keep = keepRelPaths(repo);
} catch (error) {
  console.error(error.message ?? String(error));
  process.exit(1);
}

const home = resolve(homeDir());
const dir = resolve(pluginDir(id));
if (dir !== join(home, id) || !dir.startsWith(`${home}${sep}`)) {
  console.error(`refusing ${dir}`);
  process.exit(2);
}

let info;
try {
  info = lstatSync(dir);
} catch (error) {
  if (error.code === "ENOENT") {
    console.log(`removed ${dir}`);
    process.exit(0);
  }
  throw error;
}
if (info.isSymbolicLink()) {
  console.error(`refusing symlink ${dir}`);
  process.exit(2);
}
const canon = realpathSync(dir);
const kind = relation(id, keep);
if (kind === "keep") {
  console.log(`kept ${dir}`);
  process.exit(0);
}
if (kind === "ancestor") removeSpared(dir, id, keep);
else rmSync(dir, { recursive: true, force: true });

function inside(path) {
  return path === dir || path === canon || path.startsWith(`${dir}${sep}`) || path.startsWith(`${canon}${sep}`);
}

function keptTarget(target) {
  const rel = relative(home, target);
  if (rel.startsWith("..") || rel === "") return false;
  return relation(rel.split(sep).join("/"), keep) === "keep";
}

function accountUid() {
  if (typeof process.getuid === "function") return String(process.getuid());
  try {
    return execFileSync("id", ["-u"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function bootout(label) {
  if (process.platform !== "darwin" || !label.endsWith(".plist")) return;
  const uid = accountUid();
  if (!/^[0-9]+$/.test(uid)) return;
  const launchctl = process.env.SELFHOST_LAUNCHCTL ?? "launchctl";
  try {
    execFileSync(launchctl, ["bootout", `gui/${uid}/${label.slice(0, -".plist".length)}`], { stdio: "ignore" });
  } catch {
    // Not loaded. The symlink is still removed below.
  }
}

function dropLinks(parent, agents) {
  let names = [];
  try {
    names = readdirSync(parent);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(parent, name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (!stat.isSymbolicLink()) continue;
    const target = resolve(parent, readlinkSync(path));
    if (!inside(target) || keptTarget(target)) continue;
    if (agents) bootout(name);
    unlinkSync(path);
  }
}

dropLinks(join(home, "bin"), false);
dropLinks(join(userHome(), "Library", "LaunchAgents"), true);
const spared = keep.filter((item) => item === id || item.startsWith(`${id}/`));
if (spared.length > 0) console.log(`removed ${dir} kept ${spared.join(", ")}`);
else console.log(`removed ${dir}`);
