// Move an older self-hosted layout into ~/.self-hosted and leave symlinks behind.
// Same-volume rename only. Does not bootout launchd and does not print file contents.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { rename, symlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
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

for (const lock of [join(paths.legacy.ghref, ".lock"), join(paths.ghref, ".lock")]) {
  if (existsSync(lock)) die(`ghref holds ${lock}; wait for sync to finish`);
}

mkdirSync(root, { recursive: true });

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
  if (!existsSync(src) && !existsSync(dest)) continue;
  if (sameLink(src, dest)) {
    links.push({ path: src, target: dest });
    console.log(`already ${src}`);
    continue;
  }
  if (existsSync(src) && lstatSync(src).isSymbolicLink()) die(`${src} points somewhere else; not overwriting`);
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

for (const dir of [paths.logs, paths.bin, paths.launchd, paths.state, paths.gguf]) {
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
writeFileSync(paths.labels, `${JSON.stringify({ schema: "jewell-labs.self-hosted.launchd.v1", labels }, null, 2)}\n`);
writeFileSync(paths.links, `${JSON.stringify({ schema: "jewell-labs.self-hosted.links.v1", links }, null, 2)}\n`);
console.log(`home ${root}`);
