import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../lib/discover.mjs";
import { layout } from "../lib/paths.mjs";
import { serviceUrl } from "../portless/host.mjs";
import { cleanWork } from "./store.mjs";

const EVERY = { "1h": 60 * 60 * 1000, "1d": 24 * 60 * 60 * 1000, "3d": 3 * 24 * 60 * 60 * 1000 };

export function due(every, last, now) {
  const span = EVERY[every];
  if (!span) throw new Error(`unknown every ${every}`);
  if (!last) return true;
  const then = Date.parse(last);
  return Number.isFinite(then) && now - then >= span;
}

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
  const root = env.SELFHOST_ROOT ?? repoRoot();
  const paths = layout(env);
  const routine = JSON.parse(await readFile(join(root, ".agents/routines/clean-work.json"), "utf8"));
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
