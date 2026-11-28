import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chat } from "./chat.mjs";
import { gradeHierarchy, gradeProbe, hierarchySystem, hierarchyUser } from "./grade.mjs";
import { loadHomePolicy } from "../core/lib/jail.mjs";

async function readAgents(root) {
  try {
    return await readFile(join(root, "AGENTS.md"), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return readFile(join(root, "Agents.md"), "utf8");
  }
}

async function readHarnesses(root) {
  const dir = join(root, "work/harnesses");
  let files = [];
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const docs = [];
  for (const file of files) {
    const doc = JSON.parse(await readFile(join(dir, file), "utf8"));
    if (!doc || typeof doc.id !== "string" || typeof doc.command !== "string") {
      throw new Error(`${file} is not a descriptor`);
    }
    docs.push({ id: doc.id, command: doc.command });
  }
  return docs;
}

export async function evaluateAll(ids, ctx) {
  const root = ctx.root;
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
  const wantHierarchy = ids.includes("llm-hierarchy");
  const wantDecision = ids.includes("decision-core");
  const agents = !wantHierarchy ? "" : (ctx.agents ?? await readAgents(root));
  const harnesses = !wantHierarchy ? [] : (ctx.harnesses ?? await readHarnesses(root));
  const probes = !wantDecision ? [] : (ctx.probes ?? (await loadHomePolicy(root)).probes);
  const results = [];
  for (const id of ids) {
    if (id === "llm-hierarchy") results.push(await evalHierarchy({ ...ctx, agents, harnesses, fetchImpl }));
    else if (id === "decision-core") results.push(await evalDecision({ ...ctx, probes, fetchImpl }));
    else results.push({ id, detail: "error", body: "container" });
  }
  return results;
}

async function evalHierarchy(ctx) {
  const id = "llm-hierarchy";
  if (!ctx.model) return { id, detail: "error", body: "model" };
  if (!ctx.llmUrl) return { id, detail: "error", body: "router" };
  if (!Array.isArray(ctx.harnesses) || ctx.harnesses.length === 0) return { id, detail: "error", body: "grade" };
  const user = hierarchyUser();
  const failed = [];
  for (const doc of ctx.harnesses) {
    const result = await chat(ctx.llmUrl, ctx.model, [
      { role: "system", content: hierarchySystem(ctx.agents, doc.command) },
      { role: "user", content: user },
    ], { maxTokens: 48, topK: 1, seed: 1, timeoutMs: 60_000, fetchImpl: ctx.fetchImpl });
    if (!result.ok || !gradeHierarchy(result.text, doc.command)) failed.push(doc.id);
  }
  if (failed.length > 0) return { id, detail: "error", body: "grade", failed };
  return { id, detail: "ok", body: "ok" };
}

async function evalDecision(ctx) {
  const id = "decision-core";
  if (!ctx.decisionModel) return { id, detail: "error", body: "model" };
  if (!ctx.decisionUrl) return { id, detail: "error", body: "router" };
  if (!Array.isArray(ctx.probes) || ctx.probes.length === 0) return { id, detail: "error", body: "grade" };
  for (const probe of ctx.probes) {
    const result = await chat(ctx.decisionUrl, ctx.decisionModel, [
      { role: "user", content: probe.text },
    ], { maxTokens: 16, timeoutMs: 20_000, fetchImpl: ctx.fetchImpl });
    if (!result.ok || !gradeProbe(result.text, probe.expect)) return { id, detail: "error", body: "grade" };
  }
  return { id, detail: "ok", body: "ok" };
}
