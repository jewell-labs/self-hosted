import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBus } from "../lib/events.mjs";
import { callTool } from "../lib/mesh.mjs";
import { createMcpServer } from "../mcp/server.mjs";
import { buildArgv } from "../work/harness.mjs";
import { loadDescriptors, parseDescriptor, probeOne } from "../work/harnesses.mjs";
import { label, repoName, workPath } from "../work/names.mjs";
import { cleanWork, createWork } from "../work/store.mjs";
import { due } from "../work/routines.mjs";

function env(extra = {}) {
  return {
    ...process.env,
    ...extra,
    CF_ACCESS_TEAM_DOMAIN: "",
    CF_ACCESS_AUD: "",
    ALLOW_PUBLIC_REPO_RUNNER: "",
  };
}

test("slugs and work paths stay inside one directory name", () => {
  assert.equal(repoName("jewell-labs/self-hosted"), "self-hosted");
  assert.equal(label("api", "domain"), "api");
  assert.throws(() => repoName("no-slash"), /org\/name/);
  assert.throws(() => label("Has Space", "domain"), /DNS label/);
  assert.equal(
    workPath("/work", { project: "jewell-labs/self-hosted", harness: "grok", domain: "mesh", slug: "clean-work" }),
    "/work/self-hosted-grok-mesh-clean-work",
  );
});

test("descriptors build argv and a probe accepts only a matching command", async () => {
  const docs = await loadDescriptors();
  const byId = Object.fromEntries(docs.map((doc) => [doc.id, doc]));
  const spec = { cwd: "/work/job", prompt: "do the thing", model: "small", agents: { reviewer: { prompt: "look" } }, args: ["--quiet"] };
  assert.deepEqual(buildArgv(byId.grok, spec).argv, [
    "--cwd", "/work/job", "-p", "do the thing", "--output-format", "streaming-json",
    "--model", "small", "--agents", JSON.stringify(spec.agents), "--quiet",
  ]);
  assert.deepEqual(buildArgv(byId.claude, spec).argv.slice(0, 4), ["-p", "do the thing", "--add-dir", "/work/job"]);
  assert.equal(buildArgv(byId.claude, spec).argv.at(-1), "--quiet");
  const codex = buildArgv(byId.codex, { cwd: "/work/job", prompt: "do the thing", model: "small", args: ["--ephemeral"] });
  assert.deepEqual(codex.argv, ["exec", "--json", "-C", "/work/job", "-m", "small", "--ephemeral", "do the thing"]);
  assert.equal(buildArgv(byId.pi, { cwd: "/work/job", prompt: "do the thing" }).command, "pi");
  const dropped = parseDescriptor("demo.json", JSON.stringify({
    id: "demo",
    command: "demo",
    probe: ["--help"],
    expect: "--json",
    cli: ["--cwd", "{cwd}", "{prompt}"],
  }));
  const ready = await probeOne(dropped, async () => ({ code: 0, out: "usage --json\n", err: "" }));
  const missing = await probeOne(dropped, async () => ({ code: 127, out: "", err: "not found" }));
  assert.equal(ready.ready, true);
  assert.equal(missing.ready, false);
  assert.throws(() => parseDescriptor("demo.json", "{\"id\":\"other\"}"), /id/);
});

test("create stays under the work root and clean skips young and live directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "work-"));
  const home = await mkdtemp(join(tmpdir(), "work-home-"));
  const base = env({ SELFHOST_WORK_ROOT: root, HOME: home, SELFHOST_HOME: home });
  try {
    await assert.rejects(() => createWork({
      project: "not/configured",
      harness: "grok",
      domain: "mesh",
      slug: "one",
    }, base, async () => "sha"), /not in github-repos/);
    const created = await createWork({
      project: "jewell-labs/self-hosted",
      harness: "grok",
      domain: "mesh",
      slug: "one",
    }, base, async (spec) => {
      assert.equal(spec.remote, "https://github.com/jewell-labs/self-hosted.git");
      assert.equal(spec.branch, "main");
      assert.equal(spec.dir, join(root, "self-hosted-grok-mesh-one"));
      await mkdir(spec.dir, { recursive: true });
      return "abc123";
    });
    const meta = JSON.parse(await readFile(join(created.dir, "meta.json"), "utf8"));
    assert.equal(meta.head, "abc123");
    assert.equal(meta.branch, "main");
    const old = join(root, "old-job");
    const young = join(root, "young-job");
    await mkdir(old, { recursive: true });
    await mkdir(young, { recursive: true });
    const now = Date.now();
    await writeFile(join(old, "meta.json"), JSON.stringify({ createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() }));
    await writeFile(join(young, "meta.json"), JSON.stringify({ createdAt: new Date(now - 60 * 1000).toISOString() }));
    await writeFile(join(root, "stray"), "nope");
    const first = await cleanWork(base, { now, live: new Set([old]), rm: async () => { throw new Error("live was removed"); } });
    assert.equal(first.removed.length, 0);
    assert.equal(first.kept.some((item) => item.reason === "live"), true);
    assert.equal(first.kept.some((item) => item.reason === "young"), true);
    const removed = [];
    const second = await cleanWork(base, { now, live: new Set(), rm: async (dir) => { removed.push(dir); } });
    assert.deepEqual(removed, [old]);
    assert.equal(second.kept.some((item) => item.reason === "no meta"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("harness lines do not evict control events", () => {
  const bus = createBus();
  for (let i = 0; i < 205; i += 1) bus.publish({ plugin: "llm", type: "tool", name: "llm.models", detail: "ok" });
  for (let i = 0; i < 30; i += 1) {
    bus.publish({ plugin: "work", type: "harness", name: "grok", detail: "ok", body: `{"i":${i}}` });
  }
  const replay = bus.subscribe({ plugin: null, type: null, name: null, since: "0" }, () => {}).replay;
  const control = replay.filter((event) => event.type === "tool");
  const lines = replay.filter((event) => event.type === "harness");
  assert.equal(control.length, 200);
  assert.equal(lines.length, 30);
  assert.equal(lines[0].body, "{\"i\":0}");
  assert.equal(due("1d", null, Date.now()), true);
  assert.equal(due("1d", new Date().toISOString(), Date.now()), false);
});

test("the mesh lists projects and refuses a create without a jwt", async () => {
  const base = env();
  const listed = await callTool("work.list", {}, base);
  assert.equal(listed.isError, false);
  assert.match(listed.content[0].text, /jewell-labs\/self-hosted/);
  await assert.rejects(() => callTool("work.create", {
    project: "jewell-labs/self-hosted",
    harness: "grok",
    domain: "mesh",
    slug: "nope",
  }, base), /jwt/);
  await assert.rejects(() => callTool("work.clean", {}, base), /jwt/);
  await assert.rejects(() => callTool("harness.run", {
    harness: "grok",
    transport: "cli",
    cwd: "/tmp",
    prompt: "hi",
  }, base), /jwt/);
  const harnesses = await callTool("harness.list", {}, base);
  const body = JSON.parse(harnesses.content[0].text);
  assert.equal(body.harnesses.some((item) => item.id === "grok"), true);
  assert.equal(body.harnesses.some((item) => item.id === "pi"), true);
});

test("a harness line is visible on the event stream", async () => {
  const started = createMcpServer(env({ BIND_HOST: "127.0.0.1", SELFHOST_LOG_URL: "", SELFHOST_LOG_JWT: "" }));
  await new Promise((resolve) => started.server.listen(0, "127.0.0.1", resolve));
  const port = started.server.address().port;
  const ac = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/events?type=harness&name=grok`, {
      headers: { accept: "text/event-stream" },
      signal: ac.signal,
    });
    assert.equal(response.ok, true);
    started.bus.publish({ plugin: "work", type: "harness", name: "grok", detail: "ok", body: "{\"type\":\"item\"}" });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 2000;
    while (!buf.includes("item") && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    assert.match(buf, /"body":"\{\\"type\\":\\"item\\"\}"/);
  } finally {
    ac.abort();
    await new Promise((resolve) => started.server.close(resolve));
  }
});
