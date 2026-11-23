// One event schema for every plugin. The bus is memory in this process, so a sandbox needs no Cloudflare and writes nothing.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./discover.mjs";

export const EVENT_SCHEMA = "jewell-labs.self-hosted.event.v1";
export const EVENT_TYPES = Object.freeze(["tool", "workflow"]);
export const EVENT_DETAILS = Object.freeze(["started", "ok", "error"]);
export const WORKFLOW_NAMES = Object.freeze(["ci"]);
const NAME_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const SINCE_RE = /^(0|[1-9][0-9]{0,17})$/;
const RING = 200;
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

export function validateWebhook(doc, pluginId) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new EventError(`${pluginId} event`);
  const keys = Object.keys(doc);
  if (keys.length !== 3 || doc.schema !== EVENT_SCHEMA || doc.plugin !== pluginId || !Array.isArray(doc.events)) {
    throw new EventError(`${pluginId} event`);
  }
  if (doc.events.length !== 2) throw new EventError(`${pluginId} event`);
  const tool = doc.events[0];
  const workflow = doc.events[1];
  if (!tool || Object.keys(tool).join() !== "type" || tool.type !== "tool") throw new EventError(`${pluginId} tool`);
  if (!workflow || Object.keys(workflow).join() !== "type,name" || workflow.type !== "workflow" || !WORKFLOW_NAMES.includes(workflow.name)) {
    throw new EventError(`${pluginId} workflow`);
  }
  return {
    plugin: pluginId,
    events: [
      { type: "tool" },
      { type: "workflow", name: workflow.name },
    ],
  };
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
  if (await exists(join(root, id, ".agents", "mcp.json"))) return join(root, id, "event.json");
  return join(root, "plugins", id, "event.json");
}

export async function loadWebhooks(root = repoRoot()) {
  let definition;
  let catalog;
  try {
    definition = JSON.parse(await readFile(join(root, "events", "event.json"), "utf8"));
    catalog = JSON.parse(await readFile(join(root, "catalog", "plugins.json"), "utf8"));
  } catch {
    throw new EventError("event schema");
  }
  assertDefinition(definition);
  if (!Array.isArray(catalog.plugins)) throw new EventError("event schema");
  const webhooks = [];
  for (const id of [...catalog.plugins.map((plugin) => plugin.id), "mesh"]) {
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
  const doc = JSON.parse(await readFile(join(root, "events", "event.json"), "utf8"));
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
  if (type === "tool" && detail !== "ok" && detail !== "error") throw new EventError("event detail");
  if (type === "workflow" && !EVENT_DETAILS.includes(detail)) throw new EventError("event detail");
  return {
    id,
    at: new Date().toISOString(),
    plugin,
    type,
    name,
    detail,
  };
}

export function createBus() {
  let next = 1;
  const rows = [];
  const listeners = new Set();
  return {
    publish(input) {
      const event = normalizeEvent(input, String(next));
      next += 1;
      rows.push(event);
      if (rows.length > RING) rows.shift();
      for (const listener of listeners) {
        if (!matches(listener.filter, event)) continue;
        try {
          listener.send(event);
        } catch {
          listeners.delete(listener);
        }
      }
      return event;
    },
    subscribe(filter, send) {
      const listener = { filter, send };
      const replay = rows.filter((row) => newer(row.id, filter.since) && matches(filter, row));
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
