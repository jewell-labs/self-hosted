import { realpath } from "node:fs/promises";
import { sep } from "node:path";
import { repoRoot } from "../lib/discover.mjs";
import { BODY_MAX } from "../lib/events.mjs";
import { loadDescriptors, probeOne, runProcess } from "./harnesses.mjs";
import { workRoot } from "./store.mjs";

const BLOCKED_ENV = new Set(["PATH", "HOME", "NODE_OPTIONS"]);

function inside(root, dir) {
  return dir === root || dir.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

export async function assertWorkCwd(cwd, env = process.env) {
  if (typeof cwd !== "string" || cwd.length === 0) throw new Error("cwd is required");
  const root = await realpath(workRoot(env));
  const dir = await realpath(cwd);
  if (!inside(root, dir)) throw new Error("cwd is outside ~/.self-hosted/work");
  return dir;
}

export function scrubEnv(base, extra) {
  const env = { ...base };
  if (extra === undefined) return env;
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error("env must be a string map");
  for (const [key, value] of Object.entries(extra)) {
    if (BLOCKED_ENV.has(key)) throw new Error(`refusing to replace ${key}`);
    if (typeof value !== "string") throw new Error("env values must be strings");
    env[key] = value;
  }
  return env;
}

function fill(argv, spec) {
  const agents = spec.agents === undefined ? "" : JSON.stringify(spec.agents);
  const map = {
    "{cwd}": spec.cwd,
    "{prompt}": spec.prompt,
    "{model}": spec.model ?? "",
    "{agents}": agents,
  };
  return argv.map((part) => {
    if (Object.hasOwn(map, part)) {
      if (map[part] === "") throw new Error(`missing ${part}`);
      return map[part];
    }
    if (/^\{[a-z]+\}$/.test(part)) throw new Error(`unknown placeholder ${part}`);
    return part;
  });
}

export function buildArgv(doc, spec) {
  if (typeof spec.prompt !== "string" || spec.prompt.length === 0) throw new Error("prompt is required");
  if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some((item) => typeof item !== "string"))) {
    throw new Error("args must be a string array");
  }
  const argv = fill(doc.cli, spec);
  const extras = [];
  if (spec.model) {
    if (!doc.model) throw new Error("harness has no model flag");
    extras.push(...fill(doc.model, spec));
  }
  if (spec.agents !== undefined) {
    if (!doc.agents) throw new Error("harness has no agents flag");
    extras.push(...fill(doc.agents, spec));
  }
  if (spec.args?.length) extras.push(...spec.args);
  if (extras.length > 0 && doc.argsBeforePrompt) {
    const index = argv.lastIndexOf(spec.prompt);
    if (index < 0) throw new Error("prompt placeholder missing");
    argv.splice(index, 0, ...extras);
  } else if (extras.length > 0) {
    argv.push(...extras);
  }
  return { command: doc.command, argv };
}

export function acpArgv(doc) {
  if (!Array.isArray(doc.acp)) throw new Error("harness has no acp entry");
  return { command: doc.acpCommand ?? doc.command, argv: [...doc.acp] };
}

function clip(line) {
  return line.length > BODY_MAX ? line.slice(0, BODY_MAX) : line;
}

function emit(onEvent, event) {
  try {
    onEvent?.(event);
  } catch {
    // A full client must not stop the harness.
  }
}

export async function runHarness(spec, env = process.env, hooks = {}) {
  const docs = await loadDescriptors(env.SELFHOST_ROOT ?? repoRoot());
  const doc = docs.find((item) => item.id === spec.harness);
  if (!doc) throw new Error("unknown harness");
  const cwd = await assertWorkCwd(spec.cwd, env);
  const childEnv = scrubEnv(env, spec.env);
  const spawn = hooks.spawn ?? runProcess;
  const probed = await probeOne(doc, (command, argv) => spawn(command, argv, { env: childEnv, timeoutMs: 8000 }));
  if (!probed.ready) return { text: `${doc.id} probe failed: ${probed.reason}`, isError: true };
  emit(hooks.onEvent, { plugin: "work", type: "harness", name: doc.id, detail: "started" });
  if (spec.transport === "acp") {
    const cmd = acpArgv(doc);
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: spec.capabilities ?? {} } };
    const session = { jsonrpc: "2.0", id: 2, method: "session/new", params: {} };
    const turn = { jsonrpc: "2.0", id: 3, method: "session/prompt", params: { prompt: [{ type: "text", text: spec.prompt }] } };
    const input = `${JSON.stringify(init)}\n${JSON.stringify(session)}\n${JSON.stringify(turn)}\n`;
    const result = await spawn(cmd.command, cmd.argv, {
      cwd,
      env: childEnv,
      input,
      onLine: (line, stream) => emit(hooks.onEvent, {
        plugin: "work",
        type: "harness",
        name: doc.id,
        detail: stream === "stderr" ? "error" : "ok",
        body: clip(line),
      }),
    });
    const detail = result.code === 0 ? "ok" : "error";
    emit(hooks.onEvent, { plugin: "work", type: "harness", name: doc.id, detail });
    return { text: result.out || result.err, isError: result.code !== 0 };
  }
  if (spec.transport !== "cli") throw new Error("transport must be cli or acp");
  const cmd = buildArgv(doc, { ...spec, cwd });
  const result = await spawn(cmd.command, cmd.argv, {
    cwd,
    env: childEnv,
    onLine: (line, stream) => emit(hooks.onEvent, {
      plugin: "work",
      type: "harness",
      name: doc.id,
      detail: stream === "stderr" ? "error" : "ok",
      body: clip(line),
    }),
  });
  emit(hooks.onEvent, { plugin: "work", type: "harness", name: doc.id, detail: result.code === 0 ? "ok" : "error" });
  return { text: result.out || result.err, isError: result.code !== 0 };
}
