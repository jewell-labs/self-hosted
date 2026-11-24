import { join } from "node:path";
import { detectSimulators } from "./detect.mjs";
import { readSimulatorState, writeSimulatorState } from "./state.mjs";

export async function setup(ctx) {
  const unit = await writeSimulatorState(ctx.stateDir, process.env);
  console.log(`wrote ${join(ctx.stateDir, "simulators.json")} available=${unit.available.length}`);
}

export async function check(ctx) {
  const written = await readSimulatorState(ctx.stateDir);
  const live = await detectSimulators();
  const left = (written.available ?? []).map((item) => item.udid).join(",");
  const right = live.map((item) => item.udid).join(",");
  if (written.claim !== "all" || left !== right) {
    console.error("simulators.json does not match the detected devices");
    process.exit(1);
  }
  console.log(`simulators ok ${live.length}`);
}
