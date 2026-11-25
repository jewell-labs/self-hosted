// One live benchmark. The routine calls the evals tool, and the tool writes the event log.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callTool } from "../lib/mesh.mjs";
import { createBus, eventLog } from "../lib/events.mjs";
import { layout } from "../lib/paths.mjs";
import { due } from "../work/routines.mjs";

const EVERY = "1h";

export async function tickLive(env = process.env, now = Date.now()) {
  const paths = layout(env);
  const statePath = join(paths.logs, "routines.json");
  let state = {};
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    state = {};
  }
  if (!due(EVERY, state["evals-live"], now)) return ["evals not due"];
  const bus = createBus({ file: eventLog(env) });
  const result = await callTool("evals.run", {}, env, { bus });
  state["evals-live"] = new Date(now).toISOString();
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return [result.isError ? "evals error" : "evals ok"];
}
