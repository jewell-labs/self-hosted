import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { callTool } from "../lib/mesh.mjs";
import { appendEvent, ensureSchema, KEEP_EVENTS, recentEvents } from "../plugins/cloudflare/log-book.mjs";
import { publishEvent } from "../plugins/cloudflare/log-client.mjs";
import { handleLogRequest } from "../plugins/cloudflare/log-route.mjs";
import { attachTail, fanout } from "../plugins/cloudflare/log-tail.mjs";

const SECRET = "cfast_doNotStoreThis";
const repo = new URL("..", import.meta.url);

function b64url(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString("base64url");
}

function openSql() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query, ...bindings) {
      const stmt = db.prepare(query);
      const reading = /^\s*(select|with|pragma)/i.test(query) || /returning/i.test(query);
      if (!reading) {
        stmt.run(...bindings);
        return { toArray() { return []; }, one() { return undefined; } };
      }
      const rows = stmt.all(...bindings);
      return {
        toArray() { return rows; },
        one() { return rows[0]; },
      };
    },
  };
  ensureSchema(sql);
  return sql;
}

function book() {
  const sql = openSql();
  const listeners = new Set();
  return {
    sql,
    listeners,
    append(event) {
      const row = appendEvent(sql, event);
      fanout(listeners, row);
      return row;
    },
    recent(query) { return recentEvents(sql, query); },
    stream(lastEventId, plugin) { return attachTail(listeners, Number(lastEventId) || 0, sql, plugin ?? ""); },
    assets() { return new Response("log-ui\n", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }); },
  };
}

function jwt(privateKey, aud) {
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const body = b64url(JSON.stringify({
    iss: "https://team.cloudflareaccess.com",
    aud,
    exp: Math.floor(Date.now() / 1000) + 300,
  }));
  const sig = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey).toString("base64url");
  return `${header}.${body}.${sig}`;
}

test("sqlite keeps a redacted host log and drops rows past the cap", () => {
  const sql = openSql();
  const planted = appendEvent(sql, {
    plugin: "cloudflare",
    level: "info",
    event: "cloudflare.check",
    detail: `token ${SECRET} stayed out`,
  });
  assert.equal(planted.detail.includes(SECRET), false);
  assert.match(planted.detail, /\[redacted\]/);
  assert.equal(recentEvents(sql, { since: 0, plugin: "cloudflare" })[0].event, "cloudflare.check");
  for (let i = 0; i < KEEP_EVENTS + 5; i += 1) {
    appendEvent(sql, { plugin: "mesh", level: "info", event: "discover", detail: String(i) });
  }
  const count = Number(sql.exec("SELECT COUNT(*) AS n FROM events").one().n);
  assert.equal(count, KEEP_EVENTS);
  assert.equal(recentEvents(sql, { since: 0, limit: 1 })[0].detail, "5");
});

test("the log gate uses the same access audience and hides secrets", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "k1";
  const dir = await mkdtemp(join(tmpdir(), "log-jwks-"));
  const jwks = join(dir, "jwks.json");
  await writeJwks(jwks, jwk);
  const env = {
    CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    CF_ACCESS_AUD: "proof-aud",
    SELFHOST_ACCESS_JWKS_FILE: jwks,
  };
  const api = book();
  let assetsCalled = false;
  api.assets = () => {
    assetsCalled = true;
    return new Response("log-ui\n");
  };
  const closed = await handleLogRequest(new Request("http://logs.test/"), {}, api);
  assert.equal(closed.status, 401);
  assert.equal(assetsCalled, false);
  const missing = await handleLogRequest(new Request("http://logs.test/events"), env, api);
  assert.equal(missing.status, 401);
  const other = await handleLogRequest(new Request("http://logs.test/events", {
    headers: { "Cf-Access-Jwt-Assertion": jwt(privateKey, "other-aud") },
  }), env, api);
  assert.equal(other.status, 401);
  const headers = { "Cf-Access-Jwt-Assertion": jwt(privateKey, "proof-aud") };
  const posted = await handleLogRequest(new Request("http://logs.test/events", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ plugin: "mcp", level: "info", event: "discover", detail: SECRET }),
  }), env, api);
  assert.equal(posted.status, 200);
  const listed = await handleLogRequest(new Request("http://logs.test/events", { headers }), env, api);
  const text = await listed.text();
  assert.equal(text.includes(SECRET), false);
  assert.match(text, /\[redacted\]/);
  const page = await handleLogRequest(new Request("http://logs.test/", { headers }), env, api);
  assert.equal(page.status, 200);
  assert.equal(assetsCalled, true);
  await rm(dir, { recursive: true, force: true });
});

test("a tool call publishes ok without arguments or the service token", async () => {
  const api = book();
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    seen.push({ header: req.headers["cf-access-client-secret"] ?? "", body: body.toString("utf8") });
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = await handleLogRequest(request, { SELFHOST_LOG_DEV: "1" }, api);
    const payload = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "application/json" });
    res.end(payload);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const home = await mkdtemp(join(tmpdir(), "log-home-"));
  const repos = await mkdtemp(join(tmpdir(), "log-repos-"));
  try {
    const quiet = await publishEvent({ HOME: home }, { plugin: "mesh", level: "info", event: "discover", detail: "ok" });
    assert.equal(quiet.stored, false);
    const env = {
      HOME: home,
      GHREF_REF: repos,
      SELFHOST_LOG_URL: `http://127.0.0.1:${port}`,
      CF_ACCESS_CLIENT_ID: "agent.example",
      CF_ACCESS_CLIENT_SECRET: SECRET,
      CF_ACCESS_TEAM_DOMAIN: "",
      CF_ACCESS_AUD: "",
    };
    const result = await callTool("discover", {}, env);
    assert.equal(result.isError, false);
    const logs = await callTool("cloudflare.logs", {}, env);
    assert.equal(logs.isError, false);
    const combined = `${result.content[0].text}${logs.content[0].text}${seen.map((item) => item.body).join("")}`;
    assert.equal(combined.includes(SECRET), false);
    assert.equal(seen.some((item) => item.header === SECRET), true);
    const posted = JSON.parse(seen.find((item) => item.body).body);
    assert.deepEqual(Object.keys(posted).sort(), ["detail", "event", "level", "plugin"]);
    assert.equal(posted.detail, "ok");
    assert.equal(posted.event, "discover");
    const rows = recentEvents(api.sql, { since: 0 });
    assert.equal(rows.some((row) => row.event === "discover" && row.plugin === "mesh"), true);
    assert.equal(JSON.stringify(rows).includes(SECRET), false);
  } finally {
    server.close();
    await rm(home, { recursive: true, force: true });
    await rm(repos, { recursive: true, force: true });
  }
});

test("the tail replays sql then fans out new rows", async () => {
  const api = book();
  api.append({ plugin: "sshd", level: "warn", event: "sshd.check", detail: "ok" });
  const response = api.stream(0, "");
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /"event":"sshd.check"/);
  api.append({ plugin: "llm", level: "error", event: "llm.check", detail: "error" });
  const second = new TextDecoder().decode((await reader.read()).value);
  assert.match(second, /"level":"error"/);
  await reader.cancel();
});

test("the log page reads the mcp stream and the worker keeps the host log", async () => {
  const js = await readFile(new URL("plugins/cloudflare/log-ui/app.js", repo), "utf8");
  const worker = await readFile(new URL("plugins/cloudflare/worker.mjs", repo), "utf8");
  assert.equal(js.includes("innerHTML"), false);
  assert.match(js, /events\.webhooks/);
  assert.equal(js.includes("/events/stream"), false);
  assert.equal(js.includes("row.level"), false);
  assert.match(worker, /getByName\("host"\)/);
  assert.equal(worker.includes("cloudflare:workers"), true);
});

async function writeJwks(path, jwk) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, JSON.stringify({ keys: [jwk] }));
}
