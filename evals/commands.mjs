import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evalUnit } from "./unit.mjs";

export async function setup(ctx) {
  const unit = evalUnit();
  const dest = await ctx.writeState("evals.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest} evals=${unit.ids.join(",")}`);
}

export async function check(ctx) {
  const written = JSON.parse(await readFile(join(ctx.stateDir, "evals.json"), "utf8"));
  if (JSON.stringify(written) !== JSON.stringify(evalUnit())) {
    console.error("evals.json does not match the eval list");
    process.exit(1);
  }
  console.log(`evals ok ${written.ids.join(",")}`);
}
