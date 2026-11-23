import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeInside } from "../lib/jail.mjs";
import { homeDir } from "../lib/paths.mjs";
import { detectSimulators } from "./detect.mjs";

export async function writeSimulatorState(dir, env) {
  const unit = { claim: "all", available: await detectSimulators(env) };
  await writeInside(homeDir(env), join(dir, "simulators.json"), `${JSON.stringify(unit, null, 2)}\n`);
  return unit;
}

export async function readSimulatorState(dir) {
  return JSON.parse(await readFile(join(dir, "simulators.json"), "utf8"));
}
