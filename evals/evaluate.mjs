import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chat } from "./chat.mjs";
import { gradeHierarchy, gradeProbe, hierarchySystem, hierarchyUser } from "./grade.mjs";
import { loadHomePolicy } from "../lib/jail.mjs";
import { loadDescriptors } from "../work/harnesses.mjs";

export async function evaluateAll(ids, ctx) {
  const root = ctx.root;
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
  const wantHierarchy = ids.includes("llm-hierarchy");
  const wantDecision = ids.includes("decision-core");
  const agents = !wantHierarchy ? "" : (ctx.agents ?? await readFile(join(root, "Agents.md"), "utf8"));
  const harnesses = !wantHierarchy ? [] : (ctx.harnesses ?? await loadDescriptors(root));
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
