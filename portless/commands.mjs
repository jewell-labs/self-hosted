import { join } from "node:path";
import { pluginVersion } from "../core/lib/plugins.mjs";
import { layout } from "../core/lib/paths.mjs";
import { loadPolicy } from "./host.mjs";
import { readPortlessState, writePortlessState } from "./state.mjs";

export async function setup(ctx) {
  const version = pluginVersion(ctx.root, "portless");
  if (loadPolicy().version !== version) {
    console.error("portless policy version does not match portless/plugin.json");
    process.exit(1);
  }
  const unit = await writePortlessState(ctx.stateDir);
  console.log(`wrote ${join(ctx.stateDir, "portless.json")} version=${unit.version}`);
}

export async function check(ctx) {
  const written = await readPortlessState(ctx.stateDir);
  const policy = loadPolicy();
  const version = pluginVersion(ctx.root, "portless");
  if (written.version !== version || written.version !== policy.version || written.services.join() !== policy.services.join() || written.proxy !== policy.proxy || written.stateDir !== layout().portless || policy.stateDir !== ".self-hosted/portless") {
    console.error("portless.json does not match the host policy");
    process.exit(1);
  }
  console.log(`portless ok ${written.version}`);
}
