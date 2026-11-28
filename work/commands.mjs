import { mkdir } from "node:fs/promises";
import { layout } from "../core/lib/paths.mjs";
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
  const projects = await readProjects();
  const docs = await loadDescriptors(ctx.root);
  if (!projects.includes("jewell-labs/self-hosted") || !docs.some((item) => item.id === "grok")) {
    console.error("work does not read github-repos/config or the harness descriptors");
    process.exit(1);
  }
  console.log(`work ok ${projects.length} projects ${docs.length} harnesses`);
}
