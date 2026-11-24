import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decisionUnit } from "./registry.mjs";

export async function setup(ctx) {
  const rendered = decisionUnit();
  const dest = await ctx.writeState("decision.json", `${JSON.stringify(rendered, null, 2)}\n`);
  console.log(`wrote ${dest} slots=${rendered.slots} models=${rendered.models.length}`);
}

export async function check(ctx) {
  const written = JSON.parse(await readFile(join(ctx.stateDir, "decision.json"), "utf8"));
  if (JSON.stringify(written) !== JSON.stringify(decisionUnit())) {
    console.error("decision.json does not match the decision registry");
    process.exit(1);
  }
  console.log(`decision ok slots=${written.slots} models=${written.models.length}`);
}
