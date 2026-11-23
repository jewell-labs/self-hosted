import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accessConfig, verifyAccessJwt } from "../lib/access.mjs";
import { createBus, EventError, formatSse, parseFilter } from "../lib/events.mjs";
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

export function createMcpServer(env = process.env) {
  const access = accessConfig(env);
  const bindHost = env.BIND_HOST ?? "127.0.0.1";
  const bus = createBus();
  if (!bindIsLoopback(bindHost) && !access.required) {
    throw new Error("refusing non-loopback bind without Cloudflare Access (set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD)");
  }

  function accessToken(req) {
    const header = req.headers["cf-access-jwt-assertion"];
    if (typeof header === "string" && header !== "") return header;
    const raw = req.headers.cookie;
    if (typeof raw !== "string") return "";
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

  async function gate(req, res) {
    if (!access.required) return { ok: true, jwtVerified: false };
    const token = accessToken(req);
    if (token === "") {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "cloudflare access jwt required" }));
      return { ok: false };
    }
    try {
      await verifyAccessJwt(token, access, env);
      return { ok: true, jwtVerified: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
      return { ok: false };
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, name: SERVER_NAME }));
      return;
    }
    if (req.method === "GET" && (url.pathname === "/log" || logFiles.has(url.pathname))) {
      const allowed = await gate(req, res);
      if (!allowed.ok) return;
      if (url.pathname === "/log") {
        res.writeHead(302, { location: "/log/", "cache-control": "no-store" }).end();
        return;
      }
      const [file, type] = logFiles.get(url.pathname);
      const body = await readFile(join(logDir, file));
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (req.method === "GET" && url.pathname === "/events") {
      const allowed = await gate(req, res);
      if (!allowed.ok) return;
      let filter;
      try {
        const header = req.headers["last-event-id"];
        filter = parseFilter(url.searchParams, Array.isArray(header) ? header[0] : header);
      } catch (error) {
        if (error instanceof EventError && !res.headersSent) {
          res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message }));
          return;
        }
        throw error;
      }
      const subscription = bus.subscribe(filter, (event) => {
        if (res.destroyed || res.writableEnded) {
          subscription.close();
          return;
        }
        res.write(formatSse(event));
      });
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.flushHeaders();
      res.socket?.setNoDelay(true);
      res.write(": open\n\n");
      for (const event of subscription.replay) res.write(formatSse(event));
      res.on("close", () => subscription.close());
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    const allowed = await gate(req, res);
    if (!allowed.ok) return;
    const jwtVerified = allowed.jwtVerified;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw.length === 0 ? {} : JSON.parse(raw);
      if (body.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }
      const result = await handleRpc(body.method, body.params ?? {}, { env, jwtVerified, bus });
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, result }));
    } catch (error) {
      if (error instanceof MeshError && error.status === 401 && !res.headersSent) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message }));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message } }));
      }
    }
  });

  return { server, bindHost, access, bus };
}

async function handleRpc(method, params, ctx) {
  if (method === "initialize") {
    return {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }
  if (method === "tools/list") {
    return { tools: mcpTools(await loadMesh(ctx.env)) };
  }
  if (method === "tools/call") {
    return callTool(params.name, params.arguments ?? {}, ctx.env, { jwtVerified: ctx.jwtVerified, bus: ctx.bus });
  }
  throw new Error(`unsupported method ${method}`);
}

const entry = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (entry.endsWith("mcp/server.mjs")) {
  try {
    const { server, bindHost, access } = createMcpServer();
    const port = Number(process.env.PORT ?? 8473);
    server.listen(port, bindHost, () => {
      const address = server.address();
      const realPort = typeof address === "object" && address ? address.port : port;
      console.log(JSON.stringify({
        ok: true,
        name: SERVER_NAME,
        version: SERVER_VERSION,
        bind: bindHost,
        port: realPort,
        access: access.required ? "cloudflare-access" : "loopback-only",
      }));
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
