import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { admitDownload, downloadWeight, huggingfaceUrl } from "../lib/models.mjs";
import { loadHomePolicy, realInside, scanHome, writeInside } from "../lib/jail.mjs";
import { callTool } from "../lib/mesh.mjs";

test("github, ghref, and containers are allowed home directories", async () => {
  const policy = await loadHomePolicy();
  assert.equal(policy.allowed.includes("github"), true);
  assert.equal(policy.allowed.includes("ghref"), true);
  assert.equal(policy.allowed.includes("containers"), true);
  assert.equal(policy.heavy.includes("containers"), true);
  assert.equal(policy.heavy.includes("models"), true);
});

test("downloads stay inside the reserve and the home", async () => {
  assert.equal(admitDownload({ freeBytes: 30, sizeBytes: 20, reserveBytes: 20, maxBytes: 40 }), "reserve");
  assert.equal(admitDownload({ freeBytes: 80, sizeBytes: 20, reserveBytes: 20, maxBytes: 40 }), "");
  assert.throws(() => huggingfaceUrl("../org/name", "model.gguf"), /repo/);
  assert.throws(() => huggingfaceUrl("org/name", "../model.gguf"), /file/);
  const home = await mkdtemp(join(tmpdir(), "library-home-"));
  const root = join(home, ".self-hosted");
  await mkdir(join(root, "models", "gguf"), { recursive: true });
  const env = { ...process.env, HOME: home, SELFHOST_DECISION_URL: "", LLM_URL: "", LLAMA_URL: "" };
  try {
    await assert.rejects(writeInside(root, join(home, "outside.txt"), "no"), /outside/);
    await symlink(home, join(root, "escape"));
    const scanned = await scanHome(env);
    assert.equal(scanned.ok, false);
    assert.match(scanned.detail, /escape/);
    const saved = await downloadWeight(env, { repo: "org/name", file: "tiny.gguf" }, async () => new Response(Buffer.from("gguf-bytes"), {
      status: 200,
      headers: { "content-length": String(Buffer.byteLength("gguf-bytes")) },
    }));
    assert.equal(saved.ok, true);
    await assert.rejects(realInside(root, join(home, "outside.txt")), /outside/);
    const listed = await callTool("llm.models", {}, env);
    const body = JSON.parse(listed.content[0].text);
    assert.deepEqual(body.files.map((file) => file.file), ["tiny.gguf"]);
    const sample = await callTool("llm.sample", { file: "tiny.gguf", seed: "2026-11-23T16" }, env);
    const plan = JSON.parse(sample.content[0].text);
    assert.equal(plan.keep, false);
    assert.equal(plan.reason, "router-stopped");
    assert.equal(plan.ran, false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
