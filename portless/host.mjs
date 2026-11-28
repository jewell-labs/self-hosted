import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { layout } from "../core/lib/paths.mjs";
import { localDevHost, localDevUrl, portRef, serviceUrl } from "../core/lib/ports.mjs";
export { localDevHost, localDevUrl, portRef, serviceUrl };

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

export function loadPolicy() {
  return JSON.parse(readFileSync(join(here, "policy.json"), "utf8"));
}

export function stateDir(home = process.env.HOME ?? homedir()) {
  const env = { ...process.env, HOME: home };
  if (home !== (process.env.HOME ?? homedir())) delete env.SELFHOST_HOME;
  return layout(env).portless;
}

export function caPath(home = homedir()) {
  return join(stateDir(home), loadPolicy().caFile);
}

export function dnsLabel(raw) {
  const label = String(raw).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!label) return "";
  if (label.length <= 63) return label;
  const hash = createHash("sha1").update(String(raw)).digest("hex").slice(0, 8);
  const head = label.slice(0, 54).replace(/-+$/g, "") || "x";
  return `${head}-${hash}`;
}

export function prefixFor(input) {
  const branch = dnsLabel(input.branch);
  const directory = dnsLabel(input.directory) || "checkout";
  if (input.linked && branch) return branch;
  if (!input.path) return directory;
  const stamp = createHash("sha1").update(resolve(input.path)).digest("hex").slice(0, 6);
  return dnsLabel(`${directory}-${stamp}`);
}

function git(dir, args) {
  return execFileAsync("git", ["-C", dir, ...args], { timeout: 5_000 }).then(
    (result) => ({ status: 0, stdout: result.stdout }),
    (error) => ({ status: error.code ?? 1, stdout: error.stdout?.toString?.() ?? "" }),
  );
}

export async function readCheckout(dir) {
  const gitDir = await git(dir, ["rev-parse", "--git-dir"]);
  const common = await git(dir, ["rev-parse", "--git-common-dir"]);
  const path = resolve(dir);
  const linked = gitDir.status === 0 && common.status === 0 && resolve(dir, gitDir.stdout.trim()) !== resolve(dir, common.stdout.trim());
  const branch = await git(dir, ["branch", "--show-current"]);
  return { linked, branch: branch.stdout.trim(), directory: basename(path), path };
}

export function serviceHost(prefix, service) {
  return `${prefix}.${service}.localhost`;
}


export function urlLines(prefix, services, bridge) {
  const lines = services.map((service) => `${portRef(service)} https://${serviceHost(prefix, service)}`);
  if (!bridge) return [...lines, "guest down"];
  const guest = services[0];
  const rule = services.map((service) => `MAP ${serviceHost(prefix, service)} ${bridge}`).join(", ");
  return [...lines, `guest https://${serviceHost(prefix, guest)}`, `resolver ${rule}`];
}
