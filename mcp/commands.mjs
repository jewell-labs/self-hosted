import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function post(port, body, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text };
}

function startServer(root, env) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, ["mcp/server.mjs"], { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`server did not listen\n${buf}\n${err}`));
    }, 8_000);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const line = buf.split("\n").find((item) => item.startsWith("{"));
      if (!line || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, info: JSON.parse(line) });
    });
    child.on("exit", (code) => fail(new Error(`server exited ${code}: ${buf} ${err}`)));
  });
}

export async function setup(ctx) {
  const unit = {
    bind: "127.0.0.1",
    port: "port {mcp}",
    command: ["core/bin/selfhost", "mcp/server.mjs"],
    access: ctx.plugin.access,
  };
  const dest = await ctx.writeState("mcp.json", `${JSON.stringify(unit, null, 2)}\n`);
  console.log(`wrote ${dest}`);
}

export async function check(ctx) {
  const unit = JSON.parse(await readFile(join(ctx.stateDir, "mcp.json"), "utf8"));
  if (unit.bind !== "127.0.0.1" || unit.port !== "port {mcp}" || (unit.access !== "loopback-only" && unit.access !== "cloudflare-access")) {
    console.error("mcp unit is not loopback, port {mcp}, or access-gated");
    process.exit(1);
  }
  const open = await startServer(ctx.root, { PORT: "0", BIND_HOST: "127.0.0.1" });
  try {
    const listed = await post(open.info.listen, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    if (listed.status !== 200 || !listed.text.includes("discover")) throw new Error(`tools/list failed ${listed.status}`);
    const called = await post(open.info.listen, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "discover", arguments: {} } });
    const parsed = JSON.parse(called.text);
    const payload = JSON.parse(parsed.result.content[0].text);
    if (payload.schema !== "jewell-labs.self-hosted.discover.v1" || !payload.setupPrompt.includes("setup-host")) {
      throw new Error("discover payload missing schema or prompt");
    }
  } finally {
    open.child.kill();
  }
  console.log("mcp ok");
}
