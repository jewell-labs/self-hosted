import { readHost } from "../core/lib/host.mjs";
import {
  addDecisionModel,
  downloadWeight,
  listWeights,
  readConfig,
  readUsage,
  recordUsage,
  removeDecisionModel,
  sampleFleet,
} from "../core/lib/models.mjs";
import { DECISION_SCHEMA, decisionSlots, decisionUnit, expandSteps, loadDecisionCatalog, readDecisionModels } from "./registry.mjs";

export function decisionModels(env = process.env) {
  const unit = decisionUnit(env);
  return {
    text: JSON.stringify({
      slots: unit.slots,
      port: unit.port,
      modelsDir: unit.modelsDir,
      models: unit.models,
    }),
    isError: false,
  };
}

async function complete(url, model, text) {
  const response = await fetch(`${url.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: text }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) return { ok: false };
  const body = await response.json();
  const out = body?.choices?.[0]?.message?.content;
  if (typeof out !== "string") return { ok: false };
  return { ok: true, text: out };
}

export async function decisionCall(args, env = process.env) {
  const text = args?.text;
  if (typeof text !== "string" || text.length === 0 || text.length > 8_000) {
    return { text: JSON.stringify({ ok: false, reason: "text" }), isError: true };
  }
  let models;
  try {
    models = readDecisionModels(env);
  } catch {
    return { text: JSON.stringify({ ok: false, reason: "catalog" }), isError: true };
  }
  let expanded;
  try {
    expanded = expandSteps(models, args.model);
  } catch {
    return { text: JSON.stringify({ ok: false, reason: "model" }), isError: true };
  }
  const slots = decisionSlots(readHost(env).memGb);
  const steps = expanded.map((step) => ({ id: step.id, file: step.file }));
  if (slots < 1) {
    return { text: JSON.stringify({ ok: false, reason: "no-slots", slots, steps }), isError: true };
  }
  const url = env.SELFHOST_DECISION_URL ?? "";
  if (!url) {
    return { text: JSON.stringify({ ok: true, ran: false, reason: "router-stopped", slots, steps }), isError: false };
  }
  const ran = [];
  let current = text;
  const started = Date.now();
  for (const step of steps) {
    const result = await complete(url, step.id, current);
    if (!result.ok) {
      await recordUsage(env, { plugin: "decision", model: args.model, event: "call", ok: false, ms: Date.now() - started }).catch(() => {});
      return { text: JSON.stringify({ ok: false, reason: "router", slots, steps: ran }), isError: true };
    }
    ran.push({ id: step.id, text: result.text });
    current = result.text;
  }
  await recordUsage(env, { plugin: "decision", model: args.model, event: "call", ok: true, ms: Date.now() - started }).catch(() => {});
  return { text: JSON.stringify({ ok: true, ran: true, slots, steps: ran }), isError: false };
}

export async function decisionConfig(args, env = process.env) {
  let models;
  try {
    models = readDecisionModels(env);
  } catch {
    return { text: JSON.stringify({ ok: false, reason: "catalog" }), isError: true };
  }
  const model = models.find((item) => item.id === args.id);
  if (!model) return { text: JSON.stringify({ ok: false, reason: "model" }), isError: true };
  if (model.kind === "compound") return { text: JSON.stringify({ id: model.id, kind: "compound", steps: model.steps }), isError: false };
  try {
    const config = await readConfig(env, model.file);
    return { text: JSON.stringify({ id: model.id, kind: "model", ...config }), isError: false };
  } catch {
    return { text: JSON.stringify({ ok: false, reason: "file", id: model.id, file: model.file }), isError: true };
  }
}

export async function decisionUsage(env = process.env) {
  return { text: JSON.stringify({ events: await readUsage(env, "decision") }), isError: false };
}

export async function decisionDownload(args, env = process.env) {
  try {
    loadDecisionCatalog(JSON.stringify({ schema: DECISION_SCHEMA, models: [{ id: args.id, kind: "model", file: args.file }] }));
  } catch {
    return { text: JSON.stringify({ ok: false, reason: "id" }), isError: true };
  }
  try {
    const saved = await downloadWeight(env, args);
    if (!saved.ok) return { text: JSON.stringify(saved), isError: true };
    const added = await addDecisionModel(env, args.id, saved.file);
    return { text: JSON.stringify({ ok: true, ...added, bytes: saved.bytes }), isError: false };
  } catch {
    return { text: JSON.stringify({ ok: false, reason: "file" }), isError: true };
  }
}

export async function decisionRemove(args, env = process.env) {
  try {
    const result = await removeDecisionModel(env, args.id);
    return { text: JSON.stringify(result), isError: result.ok === false };
  } catch {
    return { text: JSON.stringify({ ok: false, reason: "model" }), isError: true };
  }
}

export async function decisionSample(args, env = process.env) {
  let models;
  try {
    models = readDecisionModels(env);
  } catch {
    return { text: JSON.stringify({ ok: false, reason: "catalog" }), isError: true };
  }
  const ids = models.filter((model) => model.kind === "model").map((model) => model.id);
  if (!ids.includes(args.id)) return { text: JSON.stringify({ ok: false, reason: "model" }), isError: true };
  const library = await listWeights(env);
  const result = await sampleFleet(env, {
    plugin: "decision",
    candidate: args.id,
    fleet: ids,
    seed: args.seed,
    url: env.SELFHOST_DECISION_URL ?? "",
  });
  return { text: JSON.stringify({ ...result, freeBytes: library.freeBytes, reserveBytes: library.reserveBytes }), isError: false };
}
