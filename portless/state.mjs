import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeInside } from "../core/lib/jail.mjs";
import { homeDir } from "../core/lib/paths.mjs";
import { bridgeAddress } from "./forward.mjs";
import { caPath, loadPolicy, stateDir } from "./host.mjs";

export async function writePortlessState(dir, home) {
  const policy = loadPolicy();
  const unit = {
    version: policy.version,
    proxy: policy.proxy,
    services: policy.services,
    stateDir: stateDir(home),
    caFile: caPath(home),
    bridge: bridgeAddress(),
  };
  await writeInside(homeDir(), join(dir, "portless.json"), `${JSON.stringify(unit, null, 2)}\n`);
  return unit;
}

export async function readPortlessState(dir) {
  return JSON.parse(await readFile(join(dir, "portless.json"), "utf8"));
}
