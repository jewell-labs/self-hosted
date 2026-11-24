import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { sep } from "node:path";
import { repoRoot } from "../lib/discover.mjs";
import { loadDescriptors } from "./harnesses.mjs";
import { chooseProject, createWork, ensureProject, listWork, workRoot } from "./store.mjs";

const harness = process.argv[2];
const userArgs = process.argv.slice(3);
const docs = await loadDescriptors(repoRoot());
const doc = docs.find((item) => item.id === harness);
if (!doc) {
  console.error(`unknown harness ${harness ?? ""}`);
  process.exit(2);
}

function insideWork(cwd) {
  try {
    const root = realpathSync(workRoot());
    const dir = realpathSync(cwd);
    return dir === root || dir.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
  } catch {
    return false;
  }
}

function execReal(cwd, args) {
  const child = spawnSync(doc.command, args, { cwd, stdio: "inherit", env: process.env });
  process.exit(child.status ?? 127);
}

function withDir(cwd, args) {
  if (!doc.dirFlag) return args;
  return [doc.dirFlag, cwd, ...args];
}

if (process.env.SELFHOST_WORK || insideWork(process.cwd())) {
  execReal(process.cwd(), withDir(process.cwd(), userArgs));
}

let project = process.env.SELFHOST_PROJECT ?? "";
let domain = process.env.SELFHOST_DOMAIN ?? "";
let slug = process.env.SELFHOST_SLUG ?? "";
let branch = process.env.SELFHOST_BRANCH || undefined;

if (!project || !domain || !slug) {
  if (!stdin.isTTY) {
    console.error("set SELFHOST_PROJECT, SELFHOST_DOMAIN, and SELFHOST_SLUG");
    process.exit(2);
  }
  const listed = await listWork();
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (!project) {
      listed.projects.forEach((item, index) => console.log(`${index + 1} ${item}`));
      console.log("owner/repo adds a project");
      while (!project) {
        const answer = await rl.question("project number or owner/repo: ");
        let choice;
        try {
          choice = chooseProject(answer, listed.projects);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          continue;
        }
        if (!choice.add) {
          project = choice.project;
          break;
        }
        try {
          const saved = await ensureProject(choice.project);
          project = saved.name;
          if (!branch) branch = saved.branch;
          if (saved.added) console.error(`added ${saved.name}`);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
        }
      }
    }
    if (!domain) domain = (await rl.question("domain: ")).trim();
    if (!slug) slug = (await rl.question("slug: ")).trim();
  } finally {
    rl.close();
  }
  if (!project || !domain || !slug) {
    console.error("project, domain, and slug are required");
    process.exit(2);
  }
}

if (project) {
  try {
    const saved = await ensureProject(project);
    project = saved.name;
    if (!branch) branch = saved.branch;
    if (saved.added) console.error(`added ${saved.name}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

let created;
try {
  created = await createWork({ project, harness, domain, slug, branch });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
execReal(created.dir, withDir(created.dir, userArgs));
