import { createServer } from "node:http";
import { accessConfig, verifyAccessJwt } from "../lib/access.mjs";
import { buildDiscovery } from "../lib/discover.mjs";

const SERVER_NAME = "self-hosted";
const SERVER_VERSION = "0.1.0";

function bindIsLoopback(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function createMcpServer(env = process.env) {
  const access = accessConfig(env);
  const bindHost = env.BIND_HOST ?? "127.0.0.1";
  if (!bindIsLoopback(bindHost) && !access.required) {
    throw new Error("refusing non-loopback bind without Cloudflare Access (set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD)");
  }

  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/healthz") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, name: SERVER_NAME }));
      return;
    }
    if (req.method !== "POST" || path !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (access.required) {
      const token = req.headers["cf-access-jwt-assertion"];
      if (typeof token !== "string" || token === "") {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "cloudflare access jwt required" }));
        return;
      }
      try {
        await verifyAccessJwt(token, access, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
        return;
      }
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw.length === 0 ? {} : JSON.parse(raw);
      if (body.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }
      const result = handleRpc(body.method, body.params ?? {});
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message } }));
      }
    }
  });

  return { server, bindHost, access };
}

function handleRpc(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }
  if (method === "tools/list") {
    return {
      tools: [
        {
          name: "discover",
          description:
            "Describe this host and every self-hosted plugin, including the setup-host prompt, setup commands, and validate commands. " +
            "An agent uses this output and that prompt to install and check plugins. MCP tools are served only through Cloudflare Access when the server is not bound to loopback.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
      ],
    };
  }
  if (method === "tools/call") {
    if (params.name !== "discover") throw new Error(`unknown tool ${params.name}`);
    const discovery = buildDiscovery();
    return { content: [{ type: "text", text: JSON.stringify(discovery) }], isError: false };
  }
  throw new Error(`unsupported method ${method}`);
}

const startedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop())
  ? process.argv[1].endsWith("server.mjs")
  : false;

if (startedDirectly || process.argv[1]?.endsWith("mcp/server.mjs") || process.argv[1]?.endsWith("mcp\\server.mjs")) {
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
