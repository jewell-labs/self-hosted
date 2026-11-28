// SQLite log for one host. The sql object is Durable Object storage.sql
// or any exec() that returns a cursor with one() and toArray().
import { redactSecrets } from "../core/lib/secret.mjs";

export const KEEP_EVENTS = 2000;

const PLUGIN_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const LEVELS = new Set(["info", "warn", "error"]);
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function ensureSchema(sql) {
  drain(sql.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    plugin TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    event TEXT NOT NULL,
    detail TEXT NOT NULL
  )`));
}

export function redact(text) {
  return redactSecrets(text).replace(/[\r\n]+/g, " ").slice(0, 240);
}

export function normalizeEvent(input, now = new Date()) {
  const plugin = String(input?.plugin ?? "");
  if (!PLUGIN_RE.test(plugin) || plugin.length > 64) throw new Error("plugin");
  const level = input?.level ?? "info";
  if (!LEVELS.has(level)) throw new Error("level");
  const event = String(input?.event ?? "");
  if (!PLUGIN_RE.test(event) || event.length > 80) throw new Error("event");
  const ts = input?.ts ?? now.toISOString();
  if (!TS_RE.test(ts)) throw new Error("ts");
  return { ts, plugin, level, event, detail: redact(input?.detail ?? "") };
}

export function appendEvent(sql, input, now) {
  const row = normalizeEvent(input, now);
  const inserted = sql.exec(
    "INSERT INTO events (ts, plugin, level, event, detail) VALUES (?, ?, ?, ?, ?) RETURNING id, ts, plugin, level, event, detail",
    row.ts,
    row.plugin,
    row.level,
    row.event,
    row.detail,
  ).one();
  drain(sql.exec(
    `DELETE FROM events WHERE id < (
      SELECT MIN(id) FROM (SELECT id FROM events ORDER BY id DESC LIMIT ?)
    )`,
    KEEP_EVENTS,
  ));
  return {
    id: Number(inserted.id),
    ts: inserted.ts,
    plugin: inserted.plugin,
    level: inserted.level,
    event: inserted.event,
    detail: inserted.detail,
  };
}

export function recentEvents(sql, query = {}) {
  const since = Number(query.since) || 0;
  const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 500);
  const plugin = query.plugin ? String(query.plugin) : "";
  if (plugin && (!PLUGIN_RE.test(plugin) || plugin.length > 64)) throw new Error("plugin");
  const cursor = plugin
    ? sql.exec(
      "SELECT id, ts, plugin, level, event, detail FROM events WHERE id > ? AND plugin = ? ORDER BY id ASC LIMIT ?",
      since,
      plugin,
      limit,
    )
    : sql.exec(
      "SELECT id, ts, plugin, level, event, detail FROM events WHERE id > ? ORDER BY id ASC LIMIT ?",
      since,
      limit,
    );
  return cursor.toArray().map((row) => ({
    id: Number(row.id),
    ts: row.ts,
    plugin: row.plugin,
    level: row.level,
    event: row.event,
    detail: row.detail,
  }));
}

function drain(cursor) {
  if (cursor && typeof cursor.toArray === "function") cursor.toArray();
}
