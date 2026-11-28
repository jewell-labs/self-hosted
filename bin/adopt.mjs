// Move an older self-hosted layout into ~/.self-hosted and leave symlinks behind.
// Same-volume rename only. Does not bootout launchd and does not print file contents.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { rename, symlink, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { installLaunchAgents, recordLaunchAgents } from "../lib/launchd.mjs";
import { MANAGED_LABELS, layout, userHome } from "../lib/paths.mjs";

const user = userHome();
const paths = layout();
const root = resolve(paths.root);

function die(message) {
  console.error(message);
  process.exit(1);
}

if (root === resolve(user) || root === "/" || !root.startsWith(`${resolve(user)}${sep}`)) {
  die(`refusing to adopt into ${root}`);
}

if (process.argv.includes("--install-agents")) {
  try {
    for (const path of installLaunchAgents()) console.log(`installed ${path}`);
  } catch (error) {
    die(error.message ?? String(error));
  }
  process.exit(0);
}

for (const lock of [join(paths.legacy.ghref, ".lock"), join(paths.ghref, ".lock")]) {
  if (existsSync(lock)) die(`ghref holds ${lock}; wait for sync to finish`);
}

mkdirSync(root, { recursive: true });

const oldModels = join(root, "models");
let oldModelsStat = null;
try {
  oldModelsStat = lstatSync(oldModels);
} catch {
  oldModelsStat = null;
}
if (oldModelsStat?.isDirectory() && !oldModelsStat.isSymbolicLink()) {
  if (existsSync(paths.models)) die(`${paths.models} already exists; not merging`);
  mkdirSync(dirname(paths.models), { recursive: true });
  try {
    await rename(oldModels, paths.models);
  } catch (error) {
    if (error?.code === "EXDEV") die(`${oldModels} is on another volume; not copying`);
    throw error;
  }
  console.log(`moved ${oldModels}`);
}

const moves = [
  [paths.legacy.models, paths.models],
  [paths.legacy.agentDesktop, paths.agentDesktop],
  [paths.legacy.cloudflared, paths.cloudflared],
  [paths.legacy.sshd, paths.sshd],
  [paths.legacy.github, paths.github],
  [paths.legacy.ghref, paths.ghref],
  [paths.legacy.portless, paths.portless],
  [paths.legacy.state, paths.state],
];

function sameLink(src, dest) {
  try {
    if (!lstatSync(src).isSymbolicLink()) return false;
    return resolve(dirname(src), readlinkSync(src)) === resolve(dest);
  } catch {
    return false;
  }
}

const links = [];
for (const [src, dest] of moves) {
  let srcStat = null;
  try {
    srcStat = lstatSync(src);
  } catch {
    continue;
  }
  if (srcStat.isSymbolicLink()) {
    const target = resolve(dirname(src), readlinkSync(src));
    const oldModelLink = src === paths.legacy.models && target === resolve(oldModels);
    if (target === resolve(dest)) {
      links.push({ path: src, target: dest });
      console.log(`already ${src}`);
      continue;
    }
    if (oldModelLink) {
      await unlink(src);
      await symlink(dest, src);
      links.push({ path: src, target: dest });
      console.log(`retargeted ${src}`);
      continue;
    }
    die(`${src} points somewhere else; not overwriting`);
  }
  if (!existsSync(src)) continue;
  if (existsSync(dest)) die(`${dest} already exists; not merging`);
  if (src === paths.legacy.github) execFileSync("chmod", ["-R", "u+w", src], { stdio: "ignore" });
  mkdirSync(dirname(dest), { recursive: true });
  try {
    await rename(src, dest);
  } catch (error) {
    if (error?.code === "EXDEV") die(`${src} is on another volume; not copying`);
    throw error;
  }
  await symlink(dest, src);
  if (src === paths.legacy.github) execFileSync("chmod", ["-R", "a-w", dest], { stdio: "ignore" });
  links.push({ path: src, target: dest });
  console.log(`moved ${src}`);
}

// The containers plugin owns its directory. Do not leave the Apple default path behind.
const containerSrc = paths.legacy.containers;
const containerDest = paths.containers;
if (existsSync(containerSrc)) {
  if (sameLink(containerSrc, containerDest)) {
    await unlink(containerSrc);
    console.log(`unlinked ${containerSrc}`);
  } else if (lstatSync(containerSrc).isSymbolicLink()) {
    die(`${containerSrc} points somewhere else; not overwriting`);
  } else if (existsSync(containerDest)) {
    die(`${containerDest} already exists; not merging`);
  } else {
    mkdirSync(dirname(containerDest), { recursive: true });
    try {
      await rename(containerSrc, containerDest);
    } catch (error) {
      if (error?.code === "EXDEV") die(`${containerSrc} is on another volume; not copying`);
      throw error;
    }
    console.log(`moved ${containerSrc}`);
  }
}

for (const dir of [paths.logs, paths.bin, paths.launchd, paths.state, paths.gguf, paths.containers]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const agents = join(user, "Library/LaunchAgents");
const found = existsSync(agents)
  ? readdirSync(agents)
    .filter((name) => name.endsWith(".plist") && !name.endsWith(".plist.replaced"))
    .map((name) => name.slice(0, -".plist".length))
    .filter((name) => MANAGED_LABELS.includes(name) || name.startsWith("com.jewell-labs.") || name.startsWith("com.dpi.llama"))
  : [];
const labels = [...new Set([...MANAGED_LABELS, ...found])];
recordLaunchAgents(process.env, labels);
writeFileSync(paths.links, `${JSON.stringify({ schema: "jewell-labs.self-hosted.links.v1", links }, null, 2)}\n`);
console.log(`home ${root}`);
