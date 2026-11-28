import { readFileSync } from "node:fs";
import { join } from "node:path";
import { layout } from "../core/lib/paths.mjs";
import { loadPolicy } from "./host.mjs";
import { readPortlessState, writePortlessState } from "./state.mjs";

export async function setup(ctx) {
  const pins = JSON.parse(readFileSync(join(ctx.root, "core/catalog/pins.json"), "utf8"));
  if (loadPolicy().version !== pins.portless) {
    console.error("portless policy version does not match core/catalog/pins.json");
    process.exit(1);
  }
  const unit = await writePortlessState(ctx.stateDir);
  console.log(`wrote ${join(ctx.stateDir, "portless.json")} version=${unit.version}`);
}

export async function check(ctx) {
  const written = await readPortlessState(ctx.stateDir);
  const policy = loadPolicy();
  const pins = JSON.parse(readFileSync(join(ctx.root, "core/catalog/pins.json"), "utf8"));
  if (written.version !== pins.portless || written.version !== policy.version || written.services.join() !== policy.services.join() || written.proxy !== policy.proxy || written.stateDir !== layout().portless || policy.stateDir !== ".self-hosted/portless") {
    console.error("portless.json does not match the host policy");
    process.exit(1);
  }
  console.log(`portless ok ${written.version}`);
}
