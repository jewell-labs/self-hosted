// Delete one plugin's folder. Setup writes only there, so this removes the install.
import { execFileSync } from "node:child_process";
import { lstatSync, readlinkSync, readdirSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { join, resolve, sep } from "node:path";
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
rmSync(dir, { recursive: true, force: true });

function inside(path) {
  return path === dir || path === canon || path.startsWith(`${dir}${sep}`) || path.startsWith(`${canon}${sep}`);
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
    if (!inside(target)) continue;
    if (agents) bootout(name);
    unlinkSync(path);
  }
}

dropLinks(join(home, "bin"), false);
dropLinks(join(userHome(), "Library", "LaunchAgents"), true);
console.log(`removed ${dir}`);
