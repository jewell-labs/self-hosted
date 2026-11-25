import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accessConfig, verifyAccessJwt } from "../lib/access.mjs";
import { createBus, eventLog, EventError, formatSse, parseFilter } from "../lib/events.mjs";
import { callTool, loadMesh, mcpTools, MeshError } from "../lib/mesh.mjs";

const logDir = join(dirname(fileURLToPath(import.meta.url)), "../plugins/cloudflare/log-ui");
const logFiles = new Map([
  ["/log/", ["index.html", "text/html; charset=utf-8"]],
  ["/log/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/log/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/log/app.css", ["app.css", "text/css; charset=utf-8"]],
]);

const SERVER_NAME = "self-hosted";
const SERVER_VERSION = "0.2.0";

function bindIsLoopback(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

export function createMcpServer(env = process.env) {
  const access = accessConfig(env);
  const bindHost = env.BIND_HOST ?? "127.0.0.1";
  const bus = createBus({ file: eventLog(env) });
  if (!bindIsLoopback(bindHost) && !access.required) {
    throw new Error("refusing non-loopback bind without Cloudflare Access (set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD)");
  }

  function accessToken(request) {
    const header = request.headers.get("cf-access-jwt-assertion");
    if (header) return header;
    const raw = request.headers.get("cookie");
    if (!raw) return "";
    for (const part of raw.split(";")) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq === -1 || trimmed.slice(0, eq) !== "CF_Authorization") continue;
      try {
        return decodeURIComponent(trimmed.slice(eq + 1));
      } catch {
        return "";
      }
    }
    return "";
  }

  async function gate(request) {
    if (!access.required) return { ok: true, jwtVerified: false };
    const token = accessToken(request);
    if (token === "") return { ok: false, response: json({ error: "cloudflare access jwt required" }, 401) };
    try {
      await verifyAccessJwt(token, access, env);
      return { ok: true, jwtVerified: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, response: json({ error: message }, 401) };
    }
  }

  async function fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") return json({ ok: true, name: SERVER_NAME });
    if (request.method === "GET" && (url.pathname === "/log" || logFiles.has(url.pathname))) {
      const allowed = await gate(request);
      if (!allowed.ok) return allowed.response;
      if (url.pathname === "/log") {
        return new Response(null, { status: 302, headers: { location: "/log/", "cache-control": "no-store" } });
      }
      const [file, type] = logFiles.get(url.pathname);
      const body = await readFile(join(logDir, file));
      return new Response(body, { status: 200, headers: { "content-type": type, "cache-control": "no-store" } });
    }
    if (request.method === "GET" && url.pathname === "/events") {
      const allowed = await gate(request);
      if (!allowed.ok) return allowed.response;
      let filter;
      try {
        filter = parseFilter(url.searchParams, request.headers.get("last-event-id") ?? "");
      } catch (error) {
        if (error instanceof EventError) return json({ error: error.message }, 400);
        throw error;
      }
      let subscription;
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(": open\n\n"));
          subscription = bus.subscribe(filter, (event) => {
            try {
              controller.enqueue(enc.encode(formatSse(event)));
            } catch {
              subscription?.close();
            }
          });
          for (const event of subscription.replay) controller.enqueue(enc.encode(formatSse(event)));
        },
        cancel() {
          subscription?.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (request.method !== "POST" || url.pathname !== "/mcp") return new Response(null, { status: 404 });
    const allowed = await gate(request);
    if (!allowed.ok) return allowed.response;
    try {
      const raw = await request.text();
      const body = raw.length === 0 ? {} : JSON.parse(raw);
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result = await handleRpc(body.method, body.params ?? {}, { env, jwtVerified: allowed.jwtVerified, bus });
      return json({ jsonrpc: "2.0", id: body.id ?? null, result });
    } catch (error) {
      if (error instanceof MeshError && error.status === 401) return json({ error: error.message }, 401);
      const message = error instanceof Error ? error.message : String(error);
      return json({ jsonrpc: "2.0", id: null, error: { code: -32603, message } }, 500);
    }
  }

  return {
    bindHost,
    access,
    bus,
    fetch,
    listen(port, host) {
      return tjs.serve({ fetch, port: Number(port), listenIp: host });
    },
  };
}

async function handleRpc(method, params, ctx) {
  if (method === "initialize") {
    return {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }
  if (method === "tools/list") return { tools: mcpTools(await loadMesh(ctx.env)) };
  if (method === "tools/call") return callTool(params.name, params.arguments ?? {}, ctx.env, { jwtVerified: ctx.jwtVerified, bus: ctx.bus });
  throw new Error(`unsupported method ${method}`);
}

const entry = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (entry.endsWith("mcp/server.mjs")) {
  try {
    const mcp = createMcpServer();
    const assigned = process.env.PORT ?? "";
    const port = /^[0-9]+$/.test(assigned) ? Number(assigned) : 0;
    const server = mcp.listen(port, mcp.bindHost);
    console.log(JSON.stringify({
      ok: true,
      name: SERVER_NAME,
      version: SERVER_VERSION,
      bind: mcp.bindHost,
      port: "port {mcp}",
      listen: server.port,
      access: mcp.access.required ? "cloudflare-access" : "loopback-only",
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
