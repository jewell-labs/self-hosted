import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const containerBin = "/opt/homebrew/bin/container";
const repo = new URL("..", import.meta.url).pathname;
const image = "node:24.11.1-bookworm-slim";
const name = "selfhost-mcp-e2e";

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function mint(privateKey, aud) {
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "e2e" }));
  const payload = b64url(JSON.stringify({
    iss: "https://team.cloudflareaccess.com",
    aud,
    exp: Math.floor(Date.now() / 1000) + 120,
  }));
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function follow(port, query, headers) {
  const ac = new AbortController();
  const events = [];
  let buf = "";
  const ready = fetch(`http://127.0.0.1:${port}/events?${query}`, {
    headers: { accept: "text/event-stream", ...headers },
    signal: ac.signal,
  }).then(async (response) => {
    if (!response.ok || !response.body) return response;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const pump = async () => {
      while (!ac.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let split = buf.indexOf("\n\n");
        while (split !== -1) {
          const block = buf.slice(0, split);
          buf = buf.slice(split + 2);
          const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
          if (data) events.push(JSON.parse(data));
          split = buf.indexOf("\n\n");
        }
      }
    };
    pump().catch(() => {});
    return response;
  });
  return {
    events,
    ready,
    stop() {
      ac.abort();
    },
  };
}

async function until(stream, count, ms = 8000) {
  const start = Date.now();
  while (stream.events.length < count && Date.now() - start < ms) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return stream.events.slice();
}

async function stopContainer() {
  await exec(containerBin, ["stop", name], { timeout: 30_000 }).catch(() => {});
  await exec(containerBin, ["rm", "-f", name], { timeout: 30_000 }).catch(() => {});
}

test("a container serves the mcp event stream to a remote client", { timeout: 180_000 }, async (t) => {
  try {
    await exec(containerBin, ["--version"], { timeout: 10_000 });
  } catch {
    t.skip("apple container cli is absent");
    return;
  }
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "e2e";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const dir = await mkdtemp(join(tmpdir(), "mcp-e2e-jwks-"));
  await writeFile(join(dir, "jwks.json"), JSON.stringify({ keys: [jwk] }));
  const token = mint(privateKey, "mcp-e2e");
  const wrong = mint(privateKey, "other-aud");
  const port = await freePort();
  const cookie = { cookie: `CF_Authorization=${encodeURIComponent(token)}` };
  const header = { "cf-access-jwt-assertion": token };
  let live;
  let filtered;
  try {
    await stopContainer();
    await exec(containerBin, [
      "run", "-d", "--rm", "--name", name,
      "--progress", "none",
      "--cpus", "2",
      "--memory", "1G",
      "--workdir", "/src",
      "--tmpfs", "/tmp",
      "-e", "HOME=/tmp",
      "-e", "BIND_HOST=0.0.0.0",
      "-e", "PORT=8473",
      "-e", "CF_ACCESS_TEAM_DOMAIN=team.cloudflareaccess.com",
      "-e", "CF_ACCESS_AUD=mcp-e2e",
      "-e", "SELFHOST_ACCESS_JWKS_FILE=/jwks/jwks.json",
      "-e", "SELFHOST_LOG_URL=",
      "--mount", `type=bind,source=${repo},target=/src,readonly`,
      "--mount", `type=bind,source=${dir},target=/jwks,readonly`,
      "-p", `127.0.0.1:${port}:8473`,
      image,
      "node", "mcp/server.mjs",
    ], { timeout: 120_000 });
    const start = Date.now();
    let last = "starting";
    while (Date.now() - start < 90_000) {
      try {
        const health = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (health.status === 200) {
          last = "ok";
          break;
        }
        last = `status ${health.status}`;
      } catch (error) {
        last = error instanceof Error ? error.name : "fetch";
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (last !== "ok") {
      const logs = await exec(containerBin, ["logs", name], { timeout: 15_000 }).catch((error) => error);
      const text = `${logs.stdout ?? ""}${logs.stderr ?? ""}`.slice(-400);
      throw new Error(`container healthz did not open (${last}) ${text}`);
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/events`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/log/`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/events`, {
      headers: { "cf-access-jwt-assertion": wrong },
    })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `CF_Authorization=${encodeURIComponent(wrong)}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })).status, 401);
    live = follow(port, "plugin=llm&type=workflow&name=ci", cookie);
    filtered = follow(port, "plugin=decision&type=workflow&name=ci", header);
    const opened = await Promise.all([live.ready, filtered.ready]);
    assert.equal(opened[0].status, 200);
    assert.equal(opened[1].status, 200);
    assert.match(opened[0].headers.get("content-type") ?? "", /text\/event-stream/);
    const posted = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", ...header },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "events.workflow", arguments: { plugin: "llm", name: "ci", detail: "started" } },
      }),
    });
    assert.equal(posted.status, 200);
    const body = await posted.json();
    assert.equal(body.result.isError, false);
    const seen = await until(live, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].plugin, "llm");
    assert.equal(seen[0].type, "workflow");
    assert.equal(seen[0].name, "ci");
    assert.equal(seen[0].detail, "started");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(filtered.events.length, 0);
    const page = await fetch(`http://127.0.0.1:${port}/log/`, { headers: cookie });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /name="event-stream" content="\/events"/);
    assert.match(html, /events\.webhooks/);
    const script = await fetch(`http://127.0.0.1:${port}/log/app.js`, { headers: cookie });
    assert.equal(script.status, 200);
    const source = await script.text();
    assert.match(source, /events\.webhooks/);
    assert.match(source, /tools\/call/);
    assert.equal(source.includes("/events/stream"), false);
  } finally {
    live?.stop();
    filtered?.stop();
    await stopContainer();
    await rm(dir, { recursive: true, force: true });
  }
});
