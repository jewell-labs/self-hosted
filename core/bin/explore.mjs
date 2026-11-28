import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../lib/discover.mjs";
import { repoSpecs } from "../lib/mesh.mjs";
import { layout } from "../lib/paths.mjs";
import { readFileSync } from "node:fs";

const root = repoRoot();
const store = process.env.GHREF_REF ?? layout().github;
const specs = repoSpecs(readFileSync(join(root, "github-repos/config"), "utf8"));

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

async function summarize(label, path) {
  let names;
  try {
    names = (await readdir(path))
      .filter((name) => name === ".agents" || name === ".github" || !name.startsWith("."))
      .sort();
  } catch {
    process.stdout.write(`${label}\n  absent  ${path}\n`);
    return;
  }
  const head = git(path, ["rev-parse", "--short", "HEAD"]) || "none";
  const dirty = git(path, ["status", "--porcelain"]) ? "yes" : "no";
  process.stdout.write(`${label}\n  path    ${path}\n  head    ${head}\n  dirty   ${dirty}\n  agents  ${names.includes(".agents") ? "yes" : "no"}\n  top     ${names.join(" ")}\n`);
}

await summarize("work", root);
for (const spec of specs) {
  const path = join(store, spec);
  if (samePath(path, root)) {
    process.stdout.write(`mirror ${spec}\n  same as work\n`);
    continue;
  }
  await summarize(`mirror ${spec}`, path);
}
