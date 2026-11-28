import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../core/lib/discover.mjs";
import { layout } from "../core/lib/paths.mjs";
import { serviceUrl } from "../core/lib/ports.mjs";
import { due } from "../core/lib/schedule.mjs";
import { cleanWork } from "./store.mjs";

export { due };

async function emit(env, detail) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "events.workflow", arguments: { plugin: "work", name: "clean", detail } },
  };
  try {
    const response = await fetch(`${serviceUrl("mcp")}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return `event ${detail} not delivered (${response.status})`;
    return `event ${detail}`;
  } catch {
    return `event ${detail} not delivered`;
  }
}

export async function tick(env = process.env, now = Date.now()) {
  const repo = env.SELFHOST_ROOT ?? repoRoot();
  const paths = layout(env);
  const routine = JSON.parse(await readFile(join(repo, ".agents/routines/clean-work.json"), "utf8"));
  if (routine.id !== "clean-work" || routine.every !== "1d" || routine.workflow !== "clean") {
    throw new Error("clean-work routine does not match");
  }
  await mkdir(paths.logs, { recursive: true });
  const statePath = join(paths.logs, "routines.json");
  let state = {};
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    state = {};
  }
  const lines = [];
  if (!due(routine.every, state[routine.id], now)) {
    lines.push("clean-work not due");
  } else {
    lines.push(await emit(env, "started"));
    try {
      const result = await cleanWork(env);
      state[routine.id] = new Date(now).toISOString();
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
      lines.push(`removed ${result.removed.length}`);
      lines.push(await emit(env, "ok"));
    } catch (error) {
      lines.push(error instanceof Error ? error.message : String(error));
      lines.push(await emit(env, "error"));
    }
  }
  await appendFile(join(paths.logs, "routines.log"), `${lines.join(" ")}\n`);
  return lines;
}
