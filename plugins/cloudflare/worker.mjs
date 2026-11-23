import { DurableObject } from "cloudflare:workers";
import { appendEvent, ensureSchema, recentEvents } from "./log-book.mjs";
import { attachTail, fanout } from "./log-tail.mjs";
import { handleLogRequest } from "./log-route.mjs";

export class LogStream extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.listeners = new Set();
    ctx.blockConcurrencyWhile(async () => {
      ensureSchema(this.sql);
    });
  }

  append(event) {
    const row = appendEvent(this.sql, event);
    fanout(this.listeners, row);
    return row;
  }

  recent(query) {
    return recentEvents(this.sql, query ?? {});
  }

  stream(lastEventId, plugin = "") {
    return attachTail(this.listeners, Number(lastEventId) || 0, this.sql, plugin ?? "");
  }
}

export default {
  async fetch(request, env) {
    const stub = env.LOGS.getByName("host");
    return handleLogRequest(request, env, {
      append: (event) => stub.append(event),
      recent: (query) => stub.recent(query),
      stream: (lastEventId, plugin) => stub.stream(lastEventId, plugin),
      assets: (assetRequest) => env.ASSETS.fetch(assetRequest),
    });
  },
};
