import { recentEvents } from "./log-book.mjs";

const encoder = new TextEncoder();

export function formatSse(row) {
  return `id: ${row.id}\ndata: ${JSON.stringify(row)}\n\n`;
}

export function fanout(listeners, row) {
  const bytes = encoder.encode(formatSse(row));
  for (const item of listeners) {
    if (item.plugin && item.plugin !== row.plugin) continue;
    try {
      item.controller.enqueue(bytes);
    } catch {
      listeners.delete(item);
    }
  }
}

export function attachTail(listeners, lastEventId, sql, plugin = "") {
  const missed = recentEvents(sql, { since: lastEventId, limit: 200, plugin });
  let item;
  const stream = new ReadableStream({
    start(controller) {
      item = { controller, plugin };
      for (const row of missed) controller.enqueue(encoder.encode(formatSse(row)));
      listeners.add(item);
    },
    cancel() {
      if (item) listeners.delete(item);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
