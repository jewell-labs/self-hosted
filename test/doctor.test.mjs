import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { callTool } from "../lib/mesh.mjs";
import { doctor, runnerOk } from "../lib/doctor.mjs";

function env(home, store, extra = {}) {
  return {
    ...process.env,
    HOME: home,
    GHREF_REF: store,
    SELFHOST_DOCTOR_OFFLINE: "1",
    SELFHOST_STATE: join(home, "state"),
    SELFHOST_SECURITY: join(home, "security"),
    ...extra,
  };
}

async function home() {
  const dir = await mkdtemp(join(tmpdir(), "doctor-home-"));
  const store = await mkdtemp(join(tmpdir(), "doctor-repos-"));
  await writeFile(join(dir, "security"), "#!/bin/sh\nexit 44\n");
  await chmod(join(dir, "security"), 0o755);
  return { dir, store };
}

test("runner policy keeps public repos off the self-hosted runner", () => {
  assert.equal(runnerOk("ubuntu-latest", "public", false), true);
  assert.equal(runnerOk("self-hosted", "public", false), false);
  assert.equal(runnerOk("[self-hosted, linux]", "private", false), true);
  assert.equal(runnerOk("ubuntu-latest", "unknown", false), false);
  assert.equal(runnerOk("ubuntu-latest", "unknown", true), true);
});

test("strict passes this catalog when other checkouts and the token are absent", async () => {
  const { dir, store } = await home();
  try {
    const report = await doctor(env(dir, store));
    assert.equal(report.level, "strict");
    const failed = report.findings.filter((item) => !item.ok).map((item) => `${item.id}: ${item.detail}`);
    assert.deepEqual(failed, []);
    assert.equal(report.ok, true);
    const called = await callTool("doctor", {}, env(dir, store));
    assert.equal(called.isError, false);
    assert.match(called.content[0].text, /"level":"strict"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  }
});

test("shape ignores a bad checkout that repos and strict reject", async () => {
  const { dir, store } = await home();
  const checkout = join(store, "example", "app");
  await mkdir(join(checkout, ".agents"), { recursive: true });
  await mkdir(join(checkout, ".github", "workflows"), { recursive: true });
  await writeFile(join(checkout, ".agents", "mcp.json"), `${JSON.stringify({
    schema: "jewell-labs.agents.mcp.v1",
    tools: [{ name: "example.pwn", description: "no", destructive: true, run: { type: "shell" } }],
  })}\n`);
  await writeFile(join(checkout, ".github", "workflows", "ci.yml"), "jobs:\n  test:\n    runs-on: ubuntu-latest\n");
  try {
    const seen = env(dir, store, { SELFHOST_REPOS: "example/app" });
    const narrow = await doctor(seen, { level: "shape" });
    assert.equal(narrow.ok, true);
    assert.equal(narrow.findings.some((item) => item.id.startsWith("workflows.")), false);
    const wide = await doctor(seen, { level: "strict" });
    assert.equal(wide.ok, false);
    assert.equal(wide.findings.some((item) => item.id === "agents.example/app" && item.ok === false), true);
    assert.equal(wide.findings.some((item) => item.id === "workflows.example/app" && item.ok === false), true);
    const repos = await doctor(seen, { level: "repos" });
    assert.equal(repos.ok, false);
    assert.equal(repos.findings.some((item) => item.level === "workflows"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  }
});

test("strict accepts a self-hosted workflow and a public-repo exception", async () => {
  const { dir, store } = await home();
  const checkout = join(store, "example", "app");
  await mkdir(join(checkout, ".github", "workflows"), { recursive: true });
  await writeFile(join(checkout, ".github", "workflows", "ci.yml"), "jobs:\n  test:\n    # public-repo\n    runs-on: ubuntu-latest\n");
  try {
    const seen = env(dir, store, { SELFHOST_REPOS: "example/app" });
    const marked = await doctor(seen);
    assert.equal(marked.findings.find((item) => item.id === "workflows.example/app").ok, true);
    await writeFile(join(checkout, ".github", "workflows", "ci.yml"), "jobs:\n  test:\n    runs-on: ubuntu-latest\n");
    const report = await doctor(seen);
    const workflow = report.findings.find((item) => item.id === "workflows.example/app");
    assert.equal(workflow.ok, false);
    await writeFile(join(checkout, ".github", "workflows", "ci.yml"), "jobs:\n  test:\n    runs-on: [self-hosted, linux]\n");
    const again = await doctor(seen);
    assert.equal(again.findings.find((item) => item.id === "workflows.example/app").ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  }
});

test("strict rejects a world-readable token and a legacy directory outside the home", async () => {
  const { dir, store } = await home();
  const token = join(dir, ".self-hosted", "cloudflared", "token");
  await mkdir(join(dir, ".self-hosted", "cloudflared"), { recursive: true });
  await writeFile(token, "do-not-print-this");
  await chmod(token, 0o644);
  await mkdir(join(dir, ".ssh", "userland"), { recursive: true });
  try {
    const report = await doctor(env(dir, store));
    assert.equal(report.ok, false);
    assert.equal(report.findings.find((item) => item.id === "cloudflared.token").ok, false);
    assert.equal(report.findings.find((item) => item.id === "sshd.home").ok, false);
    assert.equal(JSON.stringify(report).includes("do-not-print-this"), false);
    await chmod(token, 0o600);
    await rm(join(dir, ".ssh", "userland"), { recursive: true });
    await mkdir(join(dir, ".self-hosted", "sshd"), { recursive: true });
    await symlink(join(dir, ".self-hosted", "sshd"), join(dir, ".ssh", "userland"));
    const fixed = await doctor(env(dir, store));
    assert.equal(fixed.findings.find((item) => item.id === "cloudflared.token").detail, "mode 0600");
    assert.equal(fixed.findings.find((item) => item.id === "sshd.home").ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  }
});

test("doctor rejects an unknown level", async () => {
  await assert.rejects(() => doctor(process.env, { level: "loose" }), /doctor level/);
});
