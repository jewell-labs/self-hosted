// Remove one package home. cleanup.json names the paths that stay.
// This does not remove another package and it does not wipe the account.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CLEANUP_SCHEMA, loadPlugin } from "./plugins.mjs";
import { relation, removeSpared } from "./cleanup.mjs";
import { homeDir, pluginDir, userHome } from "./paths.mjs";

function keepFor(repo, id) {
  const file = join(repo, id, "cleanup.json");
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`cleanup ${id}`);
  }
  if (doc?.schema !== CLEANUP_SCHEMA || !Array.isArray(doc.keep)) throw new Error(`cleanup ${id}`);
  return doc.keep.map((entry) => {
    if (typeof entry !== "string") throw new Error(`cleanup ${id}`);
    if (entry === "." || entry === "") return id;
    return `${id}/${entry}`;
  });
}

function accountUid() {
  if (typeof process.getuid === "function") return String(process.getuid());
  try {
    return execFileSync("id", ["-u"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function bootout(label, env) {
  if (process.platform !== "darwin" || !label.endsWith(".plist")) return;
  const uid = accountUid();
  if (!/^[0-9]+$/.test(uid)) return;
  const launchctl = env.SELFHOST_LAUNCHCTL ?? "launchctl";
  try {
    execFileSync(launchctl, ["bootout", `gui/${uid}/${label.slice(0, -".plist".length)}`], { stdio: "ignore" });
  } catch {
    // Not loaded. The link is still removed by the caller.
  }
}

function dropLinks(parent, dir, canon, keep, home, agents, env) {
  let names = [];
  try {
    names = readdirSync(parent);
  } catch {
    return;
  }
  const inside = (path) => path === dir || path === canon || path.startsWith(`${dir}${sep}`) || path.startsWith(`${canon}${sep}`);
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
    const rel = relative(home, target);
    if (rel.startsWith("..") || rel === "") continue;
    if (relation(rel.split(sep).join("/"), keep) === "keep") continue;
    if (agents) bootout(name, env);
    unlinkSync(path);
  }
}

export function uninstallPlugin(id, env = process.env, repo = env.SELFHOST_ROOT) {
  if (!repo) return { status: 2, message: "missing repo" };
  let doc;
  try {
    doc = loadPlugin(repo, id);
  } catch (error) {
    return { status: 2, message: error.message ?? String(error) };
  }
  if (doc.id !== id) return { status: 2, message: `unknown plugin ${id}` };
  let keep = [];
  try {
    keep = keepFor(repo, id);
  } catch (error) {
    return { status: 1, message: error.message ?? String(error) };
  }
  const home = resolve(homeDir(env));
  const dir = resolve(pluginDir(id, env));
  if (dir !== join(home, id) || !dir.startsWith(`${home}${sep}`)) return { status: 2, message: `refusing ${dir}` };
  let info;
  try {
    info = lstatSync(dir);
  } catch (error) {
    if (error.code === "ENOENT") return { status: 0, message: `removed ${dir}` };
    throw error;
  }
  if (info.isSymbolicLink()) return { status: 2, message: `refusing symlink ${dir}` };
  const canon = realpathSync(dir);
  const kind = relation(id, keep);
  if (kind === "keep") return { status: 0, message: `kept ${dir}` };
  if (kind === "ancestor") removeSpared(dir, id, keep);
  else removeSpared(dir, id, []);
  dropLinks(join(home, "bin"), dir, canon, keep, home, false, env);
  dropLinks(join(userHome(env), "Library", "LaunchAgents"), dir, canon, keep, home, true, env);
  const spared = keep.filter((item) => item === id || item.startsWith(`${id}/`));
  if (spared.length > 0) return { status: 0, message: `removed ${dir} kept ${spared.join(", ")}` };
  return { status: 0, message: `removed ${dir}` };
}

export function uninstallSelf(scriptUrl, env = process.env) {
  const dir = dirname(fileURLToPath(scriptUrl));
  const id = basename(dir);
  return uninstallPlugin(id, env, dirname(dir));
}
