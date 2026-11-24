import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { layout } from "../lib/paths.mjs";
import { loadDescriptors } from "./harnesses.mjs";
import { installWrappers } from "./install.mjs";
import { readProjects } from "./store.mjs";

export async function setup() {
  await mkdir(layout().work, { recursive: true });
  const bins = await installWrappers();
  console.log(`work root ${layout().work}`);
  console.log(`wrappers ${bins.join(",")}`);
}

export async function check(ctx) {
  const routine = JSON.parse(readFileSync(join(ctx.root, ".agents/routines/clean-work.json"), "utf8"));
  if (routine.id !== "clean-work" || routine.every !== "1d" || routine.workflow !== "clean" || routine.plugin !== "work") {
    console.error("clean-work routine does not match");
    process.exit(1);
  }
  const projects = await readProjects();
  const docs = await loadDescriptors(ctx.root);
  if (!projects.includes("jewell-labs/self-hosted") || !docs.some((item) => item.id === "grok")) {
    console.error("work does not read github-repos/config or the harness descriptors");
    process.exit(1);
  }
  console.log(`work ok ${projects.length} projects ${docs.length} harnesses`);
}
