// Print large directories and fail when the owned store sits outside ~/.self-hosted.
// SELFHOST_DISK_MIN overrides the 1 GB row threshold. Tests use a fixture home.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keepRelPaths } from "../lib/cleanup.mjs";
import { diskContext, loadDu, ownedBytes, render, scanRoots } from "../lib/disk.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const keep = keepRelPaths(repo);
const ctx = diskContext(process.env, keep);

function volume() {
  try {
    const out = execFileSync("df", ["-k", "/System/Volumes/Data"], { encoding: "utf8" });
    const line = out.trim().split("\n").at(-1);
    const parts = line.trim().split(/\s+/);
    const used = Number(parts[2]) * 1024;
    const avail = Number(parts[3]) * 1024;
    if (!Number.isFinite(used) || !Number.isFinite(avail)) return null;
    return { mount: "/System/Volumes/Data", used, avail };
  } catch {
    return null;
  }
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const loaded = loadDu(arg("--sizes") ? readFileSync(arg("--sizes"), "utf8") : "");
const sizes = loaded.sizes;
const expanded = loaded.expanded;
const errFile = arg("--du-err");
const denied = errFile
  ? (readFileSync(errFile, "utf8").match(/Operation not permitted/g) || []).length
  : 0;

function expand(path) {
  const key = resolve(path);
  if (expanded.has(key)) return;
  console.log(`measure ${key}`);
  process.exit(2);
}
function sizeOf(path) {
  const key = resolve(path);
  if (sizes.has(key)) return sizes.get(key);
  if (expanded.has(key)) {
    console.error(`disk measure missing size for ${key}`);
    process.exit(1);
  }
  // A finished parent walk lists every child it could read. Anything missing was skipped.
  if (expanded.has(dirname(key))) return 0;
  expand(key);
}

const rows = scanRoots(ctx, sizeOf, undefined, expand);
const owned = ownedBytes(ctx, sizeOf);
owned.home = sizeOf(ctx.home);
owned.store = sizeOf(ctx.root);
const report = render(ctx, rows, owned, volume(), denied);
for (const line of report.lines) console.log(line);
process.exit(report.ok ? 0 : 1);
