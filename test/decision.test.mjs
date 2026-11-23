import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decisionSlots, expandSteps, loadDecisionCatalog } from "../decision/registry.mjs";
import { callTool } from "../lib/mesh.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const catalog = {
  schema: "jewell-labs.self-hosted.decision.v1",
  models: [
    { id: "route", kind: "model", file: "route.gguf" },
    { id: "commit", kind: "model", file: "commit.gguf" },
    { id: "ship", kind: "compound", steps: ["route", "commit"] },
    { id: "release", kind: "compound", steps: ["ship", "commit"] },
  ],
};

test("decision slots scale with memory and ignore the llm server", () => {
  assert.equal(decisionSlots(15), 0);
  assert.equal(decisionSlots(24), 1);
  assert.equal(decisionSlots(32), 2);
  assert.equal(decisionSlots(64), 6);
  assert.equal(decisionSlots(256), 30);
});

test("compound models expand in order and cycles are refused", () => {
  const models = loadDecisionCatalog(JSON.stringify(catalog));
  assert.deepEqual(expandSteps(models, "release").map((model) => model.id), ["route", "commit", "commit"]);
  assert.throws(() => loadDecisionCatalog(JSON.stringify({
    schema: catalog.schema,
    models: [
      { id: "a", kind: "compound", steps: ["b"] },
      { id: "b", kind: "compound", steps: ["a"] },
    ],
  })), /cycle/);
  assert.throws(() => loadDecisionCatalog(JSON.stringify({
    schema: catalog.schema,
    models: [{ id: "route", kind: "model", file: "../weights.gguf" }],
  })), /file/);
});

test("decision.call plans a compound without starting a router", async () => {
  const home = await mkdtemp(join(tmpdir(), "decision-home-"));
  const file = join(home, "catalog.json");
  await writeFile(file, `${JSON.stringify(catalog)}\n`);
  const env = {
    ...process.env,
    HOME: home,
    SELFHOST_STATE: join(home, ".self-hosted", "state"),
    SELFHOST_DECISION_CATALOG: file,
    SELFHOST_DECISION_URL: "",
    SELFHOST_LOG_URL: "",
    GHREF_REF: home,
  };
  try {
    const listed = await callTool("decision.models", {}, env);
    const body = JSON.parse(listed.content[0].text);
    assert.equal(body.models.length, 4);
    assert.equal(body.port, 8090);
    assert.equal(body.modelsDir.endsWith("/models/gguf"), true);
    const planned = await callTool("decision.call", { model: "release", text: "ship it" }, env);
    const plan = JSON.parse(planned.content[0].text);
    assert.deepEqual(plan.steps.map((step) => step.id), ["route", "commit", "commit"]);
    if (plan.slots < 1) assert.equal(plan.reason, "no-slots");
    else {
      assert.equal(plan.ran, false);
      assert.equal(plan.reason, "router-stopped");
    }
    assert.equal(planned.content[0].text.includes("ship it"), false);
    const setup = spawnSync(process.execPath, [join(repo, "bin/setup.mjs"), "decision"], { cwd: repo, env, encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stderr);
    const check = spawnSync(process.execPath, [join(repo, "bin/check.mjs"), "decision"], { cwd: repo, env, encoding: "utf8" });
    assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
