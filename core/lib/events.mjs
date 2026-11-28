// One event schema for every plugin. The home log is the history.
// A bus with no file keeps a process ring for a caller that has no home yet.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sleepSync } from "../runtime/node/syncio.js";
import { repoRoot } from "./discover.mjs";
import { packageIds } from "./plugins.mjs";
import { layout } from "./paths.mjs";

export const EVENT_SCHEMA = "jewell-labs.self-hosted.event.v1";
export const EVENT_TYPES = Object.freeze(["healthcheck", "tool", "workflow", "harness", "eval"]);
export const EVENT_DETAILS = Object.freeze(["started", "ok", "error"]);
export const WORKFLOW_NAMES = Object.freeze(["ci"]);
export const BODY_MAX = 4096;
const CONTROL_RING = 200;
const HARNESS_RING = 8192;
const NAME_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const SINCE_RE = /^(0|[1-9][0-9]{0,17})$/;
const FILTER_CAP = 16;

export class EventError extends Error {
  constructor(message) {
    super(message);
    this.name = "EventError";
  }
}

function assertDefinition(doc) {
  const types = doc?.properties?.type?.enum;
  const details = doc?.properties?.detail?.enum;
  const required = Array.isArray(doc?.required) ? doc.required : [];
  const fields = ["id", "at", "plugin", "type", "name", "detail"];
  if (doc?.$id !== EVENT_SCHEMA || doc.additionalProperties !== false) throw new EventError("event schema");
  if (!fields.every((field) => required.includes(field))) throw new EventError("event schema");
  if (!Array.isArray(types) || types.join() !== EVENT_TYPES.join()) throw new EventError("event schema");
  if (!Array.isArray(details) || details.join() !== EVENT_DETAILS.join()) throw new EventError("event schema");
}

function publishedType(pluginId) {
  // work and evals publish one more type after the base healthcheck, tool, and workflow.
  if (pluginId === "work") return "harness";
  if (pluginId === "evals") return "eval";
  return null;
}

export function validateWebhook(doc, pluginId) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new EventError(`${pluginId} event`);
  const keys = Object.keys(doc);
  if (keys.length !== 3 || doc.schema !== EVENT_SCHEMA || doc.plugin !== pluginId || !Array.isArray(doc.events)) {
    throw new EventError(`${pluginId} event`);
  }
  const extra = publishedType(pluginId);
  if (doc.events.length !== (extra ? 4 : 3)) throw new EventError(`${pluginId} event`);
  const health = doc.events[0];
  const tool = doc.events[1];
  const workflow = doc.events[2];
  if (!health || Object.keys(health).join() !== "type,name" || health.type !== "healthcheck" || health.name !== "healthcheck") {
    throw new EventError(`${pluginId} healthcheck`);
  }
  if (!tool || Object.keys(tool).join() !== "type" || tool.type !== "tool") throw new EventError(`${pluginId} tool`);
  if (!workflow || Object.keys(workflow).join() !== "type,name" || workflow.type !== "workflow" || !WORKFLOW_NAMES.includes(workflow.name)) {
    throw new EventError(`${pluginId} workflow`);
  }
  const events = [
    { type: "healthcheck", name: "healthcheck" },
    { type: "tool" },
    { type: "workflow", name: workflow.name },
  ];
  if (extra) {
    const fourth = doc.events[3];
    if (!fourth || Object.keys(fourth).join() !== "type" || fourth.type !== extra) throw new EventError(`${pluginId} ${extra}`);
    events.push({ type: extra });
  }
  return { plugin: pluginId, events };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function webhookPath(root, id) {
  if (id === "mesh") return join(root, ".agents", "event.json");
  return join(root, id, "event.json");
}

export async function loadWebhooks(root = repoRoot()) {
  let definition;
  try {
    definition = JSON.parse(await readFile(join(root, "core", "events", "event.json"), "utf8"));
  } catch {
    throw new EventError("event schema");
  }
  assertDefinition(definition);
  const webhooks = [];
  for (const id of [...packageIds(root), "mesh"]) {
    let doc;
    try {
      doc = JSON.parse(await readFile(await webhookPath(root, id), "utf8"));
    } catch {
      throw new EventError(`${id} event.json`);
    }
    webhooks.push(validateWebhook(doc, id));
  }
  return webhooks;
}

export async function eventDefinition(root = repoRoot()) {
  const doc = JSON.parse(await readFile(join(root, "core", "events", "event.json"), "utf8"));
  assertDefinition(doc);
  return doc;
}

function list(value, kind) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new EventError("event filter");
  const items = value.split(",").map((item) => item.trim()).filter((item) => item !== "");
  if (items.length === 0) return null;
  if (items.length > FILTER_CAP) throw new EventError("event filter");
  const allowed = kind === "type" ? EVENT_TYPES : null;
  for (const item of items) {
    if (allowed ? !allowed.includes(item) : !NAME_RE.test(item)) throw new EventError("event filter");
  }
  return new Set(items);
}

export function parseFilter(params, headerSince) {
  const source = headerSince !== undefined && headerSince !== "" ? headerSince : params.get("since");
  if (source !== undefined && source !== null && source !== "" && (typeof source !== "string" || !SINCE_RE.test(source))) {
    throw new EventError("event filter");
  }
  return {
    plugin: list(params.get("plugin"), "name"),
    type: list(params.get("type"), "type"),
    name: list(params.get("name"), "name"),
    since: source || "0",
  };
}

export function matches(filter, event) {
  if (filter.plugin && !filter.plugin.has(event.plugin)) return false;
  if (filter.type && !filter.type.has(event.type)) return false;
  if (filter.name && !filter.name.has(event.name)) return false;
  return true;
}

function newer(id, since) {
  return BigInt(id) > BigInt(since);
}

export function normalizeEvent(input, id) {
  const plugin = input?.plugin;
  const type = input?.type;
  const name = input?.name;
  const detail = input?.detail;
  if (typeof plugin !== "string" || !NAME_RE.test(plugin)) throw new EventError("event plugin");
  if (!EVENT_TYPES.includes(type)) throw new EventError("event type");
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new EventError("event name");
  if (type === "tool" && name.length > 80) throw new EventError("event name");
  if (type === "workflow" && !WORKFLOW_NAMES.includes(name)) throw new EventError("event name");
  if (type === "healthcheck" && name !== "healthcheck") throw new EventError("event name");
  if ((type === "harness" || type === "eval") && name.length > 80) throw new EventError("event name");
  if (type === "tool" && detail !== "ok" && detail !== "error") throw new EventError("event detail");
  if (type !== "tool" && !EVENT_DETAILS.includes(detail)) throw new EventError("event detail");
  const event = {
    id,
    at: new Date().toISOString(),
    plugin,
    type,
    name,
    detail,
  };
  if (input.body !== undefined && input.body !== "") {
    if ((type !== "harness" && type !== "eval") || typeof input.body !== "string" || input.body.length > BODY_MAX) throw new EventError("event body");
    event.body = input.body;
  }
  return event;
}

export function eventLog(env = process.env) {
  return join(layout(env).logs, "events.jsonl");
}

export function historyFilter(input = {}) {
  const params = new URLSearchParams();
  for (const key of ["plugin", "type", "name", "since"]) {
    if (typeof input[key] === "string" && input[key] !== "") params.set(key, input[key]);
  }
  return parseFilter(params);
}

function notify(listeners, event) {
  for (const listener of listeners) {
    if (!matches(listener.filter, event)) continue;
    try {
      listener.send(event);
    } catch {
      listeners.delete(listener);
    }
  }
}

function withLog(file, fn) {
  mkdirSync(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let fd;
    try {
      fd = openSync(lock, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      sleepSync(5);
      continue;
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      try {
        unlinkSync(lock);
      } catch {
        // The next writer removes a lock it no longer needs.
      }
    }
  }
  throw new EventError("event log");
}

function lastId(file) {
  if (!existsSync(file)) return 0n;
  const text = readFileSync(file, "utf8").trimEnd();
  if (text === "") return 0n;
  const line = text.slice(text.lastIndexOf("\n") + 1);
  try {
    const id = JSON.parse(line).id;
    return typeof id === "string" && SINCE_RE.test(id) && id !== "0" ? BigInt(id) : 0n;
  } catch {
    return 0n;
  }
}

export function readEvents(file, filter = { since: "0" }) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const rows = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event.id !== "string" || !newer(event.id, filter.since ?? "0")) continue;
    if (!matches(filter, event)) continue;
    rows.push(event);
  }
  return rows;
}

export function describeHistory(webhooks, events) {
  const latest = new Map();
  for (const event of events) latest.set(`${event.plugin}\0${event.type}\0${event.name}`, event);
  const plugins = webhooks.map((hook) => {
    const rows = [];
    for (const event of latest.values()) {
      if (event.plugin !== hook.plugin) continue;
      rows.push({ type: event.type, name: event.name, detail: event.detail, id: event.id, at: event.at });
    }
    rows.sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`));
    const state = rows.length === 0 ? "waiting" : rows.some((row) => row.detail === "error") ? "error" : "ok";
    return { plugin: hook.plugin, ok: state === "ok", state, events: rows };
  });
  return {
    schema: EVENT_SCHEMA,
    ok: plugins.every((plugin) => plugin.state !== "error"),
    plugins,
  };
}

const EVAL_TOKENS = new Set(["ok", "model", "router", "grade", "gateway", "container"]);

export function reportEvals(events) {
  const groups = new Map();
  for (const event of events) {
    if (event.plugin !== "evals" || event.type !== "eval") continue;
    const parts = typeof event.body === "string" ? event.body.split(" ") : [];
    const head = parts[0] ?? "";
    const token = EVAL_TOKENS.has(parts[parts.length - 1] ?? "") ? parts[parts.length - 1] : "";
    const model = head && !EVAL_TOKENS.has(head) ? head : "";
    const key = `${event.name}\0${model}`;
    const row = groups.get(key) ?? { name: event.name, model, ok: 0, error: 0, started: 0, last: "" };
    if (event.detail === "ok") row.ok += 1;
    else if (event.detail === "error") row.error += 1;
    else row.started += 1;
    row.last = event.detail;
    if (token) row.token = token;
    groups.set(key, row);
  }
  const benchmarks = [...groups.values()].sort((left, right) => `${left.name}:${left.model}`.localeCompare(`${right.name}:${right.model}`));
  return { schema: EVENT_SCHEMA, live: true, benchmarks };
}

export function createBus(opts = {}) {
  const file = typeof opts.file === "string" ? opts.file : "";
  let next = 1;
  const control = [];
  const harness = [];
  const listeners = new Set();
  return {
    publish(input) {
      if (file) {
        return withLog(file, () => {
          const event = normalizeEvent(input, String(lastId(file) + 1n));
          appendFileSync(file, `${JSON.stringify(event)}\n`);
          notify(listeners, event);
          return event;
        });
      }
      const event = normalizeEvent(input, String(next));
      next += 1;
      const bucket = event.type === "harness" ? harness : control;
      const cap = event.type === "harness" ? HARNESS_RING : CONTROL_RING;
      bucket.push(event);
      if (bucket.length > cap) bucket.shift();
      notify(listeners, event);
      return event;
    },
    subscribe(filter, send) {
      const listener = { filter, send };
      const source = file ? readEvents(file, filter) : [...control, ...harness].filter((row) => newer(row.id, filter.since) && matches(filter, row));
      const replay = source.sort((left, right) => (BigInt(left.id) < BigInt(right.id) ? -1 : 1));
      listeners.add(listener);
      return {
        replay,
        close() {
          listeners.delete(listener);
        },
      };
    },
  };
}

export function declareWorkflow(webhooks, input) {
  const plugin = input?.plugin;
  const name = input?.name;
  const detail = input?.detail;
  const hook = webhooks.find((item) => item.plugin === plugin);
  if (!hook) throw new EventError("unknown plugin");
  if (!hook.events.some((item) => item.type === "workflow" && item.name === name)) throw new EventError("undeclared workflow");
  if (!EVENT_DETAILS.includes(detail)) throw new EventError("event detail");
  return { plugin, type: "workflow", name, detail };
}

export function formatSse(event) {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}
