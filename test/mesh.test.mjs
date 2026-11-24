import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { callTool, loadMesh, validateTool } from "../lib/mesh.mjs";
import { createMcpServer } from "../mcp/server.mjs";

function b64url(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString("base64url");
}

function baseEnv(extra = {}) {
  return {
    ...process.env,
    ...extra,
    BIND_HOST: "127.0.0.1",
    ALLOW_PUBLIC_REPO_RUNNER: "",
    CF_ACCESS_TEAM_DOMAIN: extra.CF_ACCESS_TEAM_DOMAIN ?? "",
    CF_ACCESS_AUD: extra.CF_ACCESS_AUD ?? "",
    SELFHOST_ACCESS_JWKS_FILE: extra.SELFHOST_ACCESS_JWKS_FILE ?? "",
  };
}

async function post(port, body, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

async function withServer(env, fn) {
  const { server } = createMcpServer(env);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("trusted declarations reject a shell run and a mismatched plugin", () => {
  const tool = {
    name: "llama.setup",
    description: "not a shell command",
    destructive: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: { type: "shell", command: "true" },
  };
  assert.throws(() => validateTool(tool, { pluginId: "llama", infra: false }), /run/);
  assert.throws(() => validateTool({ ...tool, run: { type: "setup", plugin: "sshd" } }, { pluginId: "llama", infra: false }), /plugin/);
});

test("mesh lists plugin tools, keeps external commands unexecuted, and hides secrets", async () => {
  const store = await mkdtemp(join(tmpdir(), "mesh-repos-"));
  const state = await mkdtemp(join(tmpdir(), "mesh-state-"));
  const sentinel = join(store, "touched");
  const checkout = join(store, "example", "app");
  await mkdir(join(checkout, ".agents"), { recursive: true });
  await mkdir(join(checkout, "plugins", "evil", ".agents"), { recursive: true });
  await writeFile(join(checkout, ".agents", "mcp.json"), `${JSON.stringify({
    schema: "jewell-labs.agents.mcp.v1",
    tools: [{
      name: "example.pwn",
      description: "should not run",
      destructive: true,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: { type: "shell", command: sentinel },
    }],
  })}\n`);
  await mkdir(join(checkout, "plugins", "declared", ".agents"), { recursive: true });
  await writeFile(join(checkout, "plugins", "declared", ".agents", "mcp.json"), `${JSON.stringify({
    mcpServers: { portless: { command: "node", args: ["ops/ci/portless-mcp.ts"] } },
  })}\n`);
  await writeFile(join(checkout, "plugins", "evil", ".agents", "mcp.json"), `${JSON.stringify({
    schema: "jewell-labs.agents.mcp.v1",
    tools: [{ name: "evil.run", description: "hidden", destructive: true, run: { type: "shell" } }],
  }, null, 2).replace("hidden", "hidden cfast_abc")}\n`);
  const env = baseEnv({ GHREF_REF: store, SELFHOST_STATE: state, SELFHOST_REPOS: "example/app" });
  try {
    const mesh = await loadMesh(env);
    const declared = mesh.tools.find((tool) => tool.name === "portless");
    assert.equal(declared.callable, false);
    assert.equal(declared.run.type, "unknown");
    const external = mesh.tools.find((tool) => tool.name === "example.pwn");
    assert.equal(external.callable, false);
    assert.equal(external.run.type, "shell");
    assert.equal(mesh.tools.some((tool) => tool.name === "evil.run"), false);
    assert.equal(mesh.skipped.some((item) => item.reason === "secret material"), true);
    const runner = mesh.tools.find((tool) => tool.name === "actions-runner.setup");
    assert.equal(runner.destructive, true);
    assert.equal(runner.callable, true);
    assert.equal(mesh.tools.filter((tool) => tool.trusted && tool.run.type === "setup").length, 14);
    const listed = await callTool("mesh.list", {}, env, { mesh });
    assert.equal(listed.isError, false);
    assert.equal(listed.content[0].text.includes("cfast_abc"), false);
    assert.equal(listed.content[0].text.includes("portless-mcp"), false);
    const view = JSON.parse(listed.content[0].text);
    assert.equal(view.access.freePlanUserSeats, 50);
    assert.equal(view.access.serviceTokenLimit, 50);
    assert.deepEqual(view.endpointSuffixes, []);
    assert.equal(view.access.serviceTokensDoNotConsumeSeats, true);
    const skill = await callTool("mesh.skill", { name: "mesh" }, env, { mesh });
    assert.match(skill.content[0].text, /mesh\.list/);
    assert.doesNotMatch(skill.content[0].text, /\b50\b/);
    await assert.rejects(() => callTool("mesh.skill", { name: "../mcp" }, env, { mesh }), /skill name/);
    const ran = await callTool("example.pwn", {}, env, { mesh });
    assert.equal(ran.isError, true);
    assert.match(ran.content[0].text, /not executed/);
    assert.equal(existsSync(sentinel), false);
  } finally {
    await rm(store, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
});

test("loopback serves a read-only setup and refuses a destructive setup without a jwt", async () => {
  const home = await mkdtemp(join(tmpdir(), "mesh-http-"));
  const state = join(home, ".self-hosted", "state");
  const store = await mkdtemp(join(tmpdir(), "mesh-empty-"));
  const env = baseEnv({ HOME: home, SELFHOST_STATE: state, GHREF_REF: store });
  try {
    await withServer(env, async (port) => {
      const listed = await post(port, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      assert.equal(listed.status, 200);
      const tools = JSON.parse(listed.text).result.tools;
      assert.equal(tools.some((tool) => tool.name === "discover"), true);
      const destructive = tools.find((tool) => tool.name === "actions-runner.setup");
      assert.equal(destructive.annotations.destructiveHint, true);
      const setup = await post(port, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "llm.setup", arguments: {} } });
      assert.equal(setup.status, 200);
      const setupBody = JSON.parse(setup.text);
      assert.equal(setupBody.result.isError, false);
      assert.match(setupBody.result.content[0].text, /llm\.json/);
      const denied = await post(port, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "actions-runner.setup", arguments: {} } });
      assert.equal(denied.status, 401);
      assert.match(denied.text, /cloudflare access jwt required/);
    });
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  }
});

test("a verified access jwt lets the destructive tool run, and the public repo still refuses it", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "mesh";
  const dir = await mkdtemp(join(tmpdir(), "mesh-jwt-"));
  const state = await mkdtemp(join(tmpdir(), "mesh-jwt-state-"));
  const jwks = join(dir, "jwks.json");
  await writeFile(jwks, JSON.stringify({ keys: [jwk] }));
  const env = baseEnv({
    SELFHOST_STATE: state,
    GHREF_REF: dir,
    CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    CF_ACCESS_AUD: "mesh-aud",
    SELFHOST_ACCESS_JWKS_FILE: jwks,
  });
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "mesh" }));
  const body = b64url(JSON.stringify({
    iss: "https://team.cloudflareaccess.com",
    aud: "mesh-aud",
    exp: Math.floor(Date.now() / 1000) + 300,
  }));
  const token = `${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey).toString("base64url")}`;
  try {
    await withServer(env, async (port) => {
      const denied = await post(port, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "actions-runner.setup", arguments: {} } });
      assert.equal(denied.status, 401);
      const allowed = await post(
        port,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "actions-runner.setup", arguments: {} } },
        { "cf-access-jwt-assertion": token },
      );
      assert.equal(allowed.status, 200);
      const parsed = JSON.parse(allowed.text);
      assert.equal(parsed.result.isError, true);
      assert.match(parsed.result.content[0].text, /refusing actions-runner/);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
});
