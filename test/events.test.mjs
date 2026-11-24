import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBus, loadWebhooks, parseFilter, validateWebhook } from "../lib/events.mjs";
import { createMcpServer } from "../mcp/server.mjs";

function env(extra = {}) {
  return {
    ...process.env,
    ...extra,
    BIND_HOST: "127.0.0.1",
    ALLOW_PUBLIC_REPO_RUNNER: "",
    CF_ACCESS_TEAM_DOMAIN: extra.CF_ACCESS_TEAM_DOMAIN ?? "",
    CF_ACCESS_AUD: extra.CF_ACCESS_AUD ?? "",
    SELFHOST_ACCESS_JWKS_FILE: extra.SELFHOST_ACCESS_JWKS_FILE ?? "",
    SELFHOST_LOG_URL: "",
    SELFHOST_LOG_JWT: "",
  };
}

async function listen(serverEnv) {
  const started = createMcpServer(serverEnv);
  await new Promise((resolve) => started.server.listen(0, "127.0.0.1", resolve));
  return { ...started, port: started.server.address().port };
}

function follow(port, query, headers = {}) {
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

async function until(stream, count, ms = 2000) {
  const start = Date.now();
  while (stream.events.length < count && Date.now() - start < ms) {
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  return stream.events.slice();
}

async function post(port, body, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

function call(id, name, args) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

test("a webhook declares the events that plugin publishes", async () => {
  assert.throws(() => validateWebhook({
    schema: "jewell-labs.self-hosted.event.v1",
    plugin: "llm",
    events: [{ type: "progress" }, { type: "workflow", name: "ci" }],
  }, "llm"), /tool/);
  assert.throws(() => validateWebhook({
    schema: "jewell-labs.self-hosted.event.v1",
    plugin: "llm",
    events: [{ type: "tool" }, { type: "workflow", name: "ci" }, { type: "harness" }],
  }, "llm"), /event/);
  assert.throws(() => validateWebhook({
    schema: "jewell-labs.self-hosted.event.v1",
    plugin: "work",
    events: [{ type: "tool" }, { type: "workflow", name: "clean" }],
  }, "work"), /event/);
  const hooks = await loadWebhooks();
  const byId = Object.fromEntries(hooks.map((hook) => [hook.plugin, hook.events]));
  assert.deepEqual(byId.work, [{ type: "tool" }, { type: "workflow", name: "clean" }, { type: "harness" }]);
  assert.deepEqual(byId.evals, [{ type: "tool" }, { type: "workflow", name: "ci" }, { type: "eval" }]);
  assert.equal(hooks.some((hook) => hook.plugin === "llm"), true);
  assert.equal(hooks.some((hook) => hook.plugin === "decision"), true);
  assert.equal(hooks.some((hook) => hook.plugin === "mesh"), true);
  assert.equal(hooks.filter((hook) => hook.plugin !== "work" && hook.plugin !== "evals").every((hook) => hook.events.length === 2), true);
  assert.throws(() => parseFilter(new URLSearchParams("type=progress"), ""), /event filter/);
  const bus = createBus();
  const seen = [];
  bus.subscribe(parseFilter(new URLSearchParams("plugin=llm"), ""), (event) => seen.push(event));
  bus.publish({ plugin: "decision", type: "tool", name: "decision.models", detail: "ok" });
  const kept = bus.publish({ plugin: "llm", type: "tool", name: "llm.models", detail: "ok" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, kept.id);
  assert.deepEqual(Object.keys(kept), ["id", "at", "plugin", "type", "name", "detail"]);
});

test("two plugin streams and a workflow stream stay apart in a sandbox", async () => {
  const home = await mkdtemp(join(tmpdir(), "events-home-"));
  const store = await mkdtemp(join(tmpdir(), "events-repos-"));
  const state = join(home, ".self-hosted", "state");
  const serverEnv = env({ HOME: home, SELFHOST_STATE: state, GHREF_REF: store });
  const started = await listen(serverEnv);
  const streams = [
    follow(started.port, "plugin=llm&type=tool"),
    follow(started.port, "plugin=decision&type=tool"),
    follow(started.port, "type=workflow&name=ci"),
    follow(started.port, "plugin=llm"),
    follow(started.port, "plugin=sshd&type=workflow&name=not-a-workflow"),
  ];
  try {
    const opened = await Promise.all(streams.map((stream) => stream.ready));
    assert.equal(opened.every((response) => response.status === 200), true);
    assert.equal(opened.every((response) => response.headers.get("content-type").includes("text/event-stream")), true);
    const models = await post(started.port, call(1, "llm.models", {}));
    const decisions = await post(started.port, call(2, "decision.models", {}));
    const llmCi = await post(started.port, call(3, "events.workflow", { plugin: "llm", name: "ci", detail: "started" }));
    const decisionCi = await post(started.port, call(4, "events.workflow", { plugin: "decision", name: "ci", detail: "ok" }));
    assert.equal(models.status, 200);
    assert.equal(JSON.parse(models.text).result.isError, false);
    assert.equal(decisions.status, 200);
    assert.equal(JSON.parse(decisions.text).result.isError, false);
    assert.equal(JSON.parse(llmCi.text).result.isError, false);
    assert.equal(JSON.parse(decisionCi.text).result.isError, false);
    const llmTools = await until(streams[0], 1);
    const decisionTools = await until(streams[1], 1);
    const workflows = await until(streams[2], 2);
    const llmAll = await until(streams[3], 2);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(llmTools.map((event) => [event.plugin, event.type, event.name, event.detail]), [["llm", "tool", "llm.models", "ok"]]);
    assert.deepEqual(decisionTools.map((event) => [event.plugin, event.type, event.name, event.detail]), [["decision", "tool", "decision.models", "ok"]]);
    assert.deepEqual(workflows.map((event) => [event.plugin, event.type, event.name, event.detail]), [
      ["llm", "workflow", "ci", "started"],
      ["decision", "workflow", "ci", "ok"],
    ]);
    assert.equal(llmAll.some((event) => event.plugin !== "llm"), false);
    assert.equal(llmAll.some((event) => event.type === "tool" && event.name === "llm.models"), true);
    assert.equal(llmAll.some((event) => event.type === "workflow" && event.name === "ci"), true);
    assert.equal(streams[4].events.length, 0);
    const listed = await post(started.port, call(5, "events.webhooks", {}));
    const view = JSON.parse(JSON.parse(listed.text).result.content[0].text);
    assert.equal(view.schema, "jewell-labs.self-hosted.event.v1");
    assert.equal(view.stream, "/events");
    assert.equal(view.webhooks.some((hook) => hook.plugin === "llm"), true);
    assert.equal(view.webhooks.some((hook) => hook.plugin === "decision"), true);
    const bad = await fetch(`http://127.0.0.1:${started.port}/events?type=progress`);
    assert.equal(bad.status, 400);
    const refused = await post(started.port, call(6, "events.workflow", { plugin: "llm", name: "ci", detail: "shipped" }));
    assert.equal(refused.status, 200);
    assert.equal(JSON.parse(refused.text).result.isError, true);
    const replay = follow(started.port, "plugin=decision&type=workflow&name=ci");
    const replayed = await replay.ready;
    assert.equal(replayed.status, 200);
    const prior = await until(replay, 1);
    assert.equal(prior[0].detail, "ok");
    const tail = follow(started.port, "plugin=decision&type=workflow&name=ci", { "last-event-id": prior[0].id });
    await tail.ready;
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(tail.events.length, 0);
    await post(started.port, call(7, "events.workflow", { plugin: "decision", name: "ci", detail: "error" }));
    const live = await until(tail, 1);
    assert.equal(live[0].detail, "error");
    assert.equal(live[0].plugin, "decision");
    replay.stop();
    tail.stop();
  } finally {
    for (const stream of streams) stream.stop();
    started.server.closeAllConnections();
    await new Promise((resolve) => started.server.close(resolve));
    await rm(home, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  }
});

test("the event stream uses the same access gate as mcp", async () => {
  const started = await listen(env({
    CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    CF_ACCESS_AUD: "events-aud",
  }));
  try {
    const denied = await fetch(`http://127.0.0.1:${started.port}/events?plugin=llm`);
    assert.equal(denied.status, 401);
    const health = await fetch(`http://127.0.0.1:${started.port}/healthz`);
    assert.equal(health.status, 200);
    const page = await fetch(`http://127.0.0.1:${started.port}/log/`);
    assert.equal(page.status, 401);
  } finally {
    started.server.closeAllConnections();
    await new Promise((resolve) => started.server.close(resolve));
  }
});

test("a cookie opens the log page and the event stream, a query token does not", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "page";
  const dir = await mkdtemp(join(tmpdir(), "events-page-"));
  const jwks = join(dir, "jwks.json");
  await writeFile(jwks, JSON.stringify({ keys: [jwk] }));
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "page" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({
    iss: "https://team.cloudflareaccess.com",
    aud: "events-aud",
    exp: Math.floor(Date.now() / 1000) + 120,
  })).toString("base64url");
  const token = `${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey).toString("base64url")}`;
  const started = await listen(env({
    CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    CF_ACCESS_AUD: "events-aud",
    SELFHOST_ACCESS_JWKS_FILE: jwks,
  }));
  try {
    const cookie = `CF_Authorization=${encodeURIComponent(token)}`;
    const page = await fetch(`http://127.0.0.1:${started.port}/log`, { headers: { cookie }, redirect: "manual" });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), "/log/");
    const html = await fetch(`http://127.0.0.1:${started.port}/log/`, { headers: { cookie } });
    assert.equal(html.status, 200);
    assert.match(await html.text(), /events\.webhooks/);
    const script = await fetch(`http://127.0.0.1:${started.port}/log/app.js`, { headers: { cookie } });
    assert.equal(script.status, 200);
    const source = await script.text();
    assert.match(source, /events\.webhooks/);
    assert.equal(source.includes("/events/stream"), false);
    const query = await fetch(`http://127.0.0.1:${started.port}/events?token=${encodeURIComponent(token)}`);
    assert.equal(query.status, 401);
    const stream = follow(started.port, "plugin=llm&type=workflow&name=ci", { cookie });
    const opened = await stream.ready;
    assert.equal(opened.status, 200);
    const posted = await post(started.port, call(1, "events.workflow", { plugin: "llm", name: "ci", detail: "started" }), {
      "cf-access-jwt-assertion": token,
    });
    assert.equal(posted.status, 200);
    const seen = await until(stream, 1);
    assert.equal(seen[0].plugin, "llm");
    assert.equal(seen[0].type, "workflow");
    assert.equal(seen[0].name, "ci");
    assert.equal(seen[0].detail, "started");
    stream.stop();
  } finally {
    started.server.closeAllConnections();
    await new Promise((resolve) => started.server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
