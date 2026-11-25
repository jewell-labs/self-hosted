import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readHost } from "../lib/host.mjs";
import { layout } from "../lib/paths.mjs";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const DECISION_SCHEMA = "jewell-labs.self-hosted.decision.v1";
export const DECISION_PORT = "port {decision}";
const ID_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const LLM_RESERVE_GB = 16;
const PER_MODEL_GB = 8;

export function decisionSlots(memGb) {
  return Math.max(0, Math.floor((Number(memGb) - LLM_RESERVE_GB) / PER_MODEL_GB));
}

export function loadDecisionCatalog(text) {
  const doc = JSON.parse(text);
  if (!doc || doc.schema !== DECISION_SCHEMA || !Array.isArray(doc.models)) throw new Error("decision catalog");
  const models = [];
  const seen = new Set();
  for (const model of doc.models) {
    const id = model?.id;
    if (typeof id !== "string" || !ID_RE.test(id) || seen.has(id)) throw new Error(`decision model ${id ?? ""}`);
    seen.add(id);
    if (model.kind === "model") {
      const file = model.file;
      if (typeof file !== "string" || file.includes("..") || file.startsWith("/") || file.includes("\\") || !file.endsWith(".gguf")) {
        throw new Error(`decision file ${id}`);
      }
      models.push({ id, kind: "model", file });
    } else if (model.kind === "compound") {
      const steps = model.steps;
      if (!Array.isArray(steps) || steps.length === 0 || steps.some((step) => typeof step !== "string" || !ID_RE.test(step))) {
        throw new Error(`decision steps ${id}`);
      }
      models.push({ id, kind: "compound", steps: [...steps] });
    } else {
      throw new Error(`decision kind ${id}`);
    }
  }
  assertAcyclic(models);
  return models;
}

function assertAcyclic(models) {
  const byId = new Map(models.map((model) => [model.id, model]));
  for (const model of models) {
    if (model.kind !== "compound") continue;
    for (const step of model.steps) {
      if (!byId.has(step)) throw new Error(`decision step ${model.id} ${step}`);
    }
  }
  const walk = (id, stack) => {
    const model = byId.get(id);
    if (!model || model.kind !== "compound") return;
    if (stack.includes(id)) throw new Error(`decision cycle ${id}`);
    for (const step of model.steps) walk(step, [...stack, id]);
  };
  for (const model of models) walk(model.id, []);
}

export function expandSteps(models, id) {
  const byId = new Map(models.map((model) => [model.id, model]));
  const walk = (current, stack) => {
    const model = byId.get(current);
    if (!model) throw new Error(`decision model ${current}`);
    if (stack.includes(current)) throw new Error(`decision cycle ${current}`);
    if (model.kind === "model") return [model];
    return model.steps.flatMap((step) => walk(step, [...stack, current]));
  };
  return walk(id, []);
}

function readCatalogFile(path) {
  return loadDecisionCatalog(readFileSync(path, "utf8"));
}

export function readDecisionModels(env = process.env, root = env.SELFHOST_ROOT ?? defaultRoot) {
  const override = env.SELFHOST_DECISION_CATALOG ?? "";
  if (override) return readCatalogFile(override);
  const base = readCatalogFile(join(root, "decision/catalog.json"));
  const hostPath = join(layout(env).decision, "catalog.json");
  try {
    const extra = readCatalogFile(hostPath);
    const byId = new Map(base.map((model) => [model.id, model]));
    for (const model of extra) byId.set(model.id, model);
    const models = [...byId.values()];
    assertAcyclic(models);
    return models;
  } catch (error) {
    if (error.code === "ENOENT") return base;
    throw error;
  }
}

export function decisionUnit(env = process.env, root = env.SELFHOST_ROOT ?? defaultRoot) {
  const host = readHost(env);
  const models = readDecisionModels(env, root);
  const slots = decisionSlots(host.memGb);
  const paths = layout(env);
  return {
    schema: DECISION_SCHEMA,
    slots,
    port: DECISION_PORT,
    modelsDir: paths.decisionModels,
    models,
    router: {
      bin: "llama-server",
      args: [
        "--host", "127.0.0.1",
        "--port", "{{port}}",
        "--models-dir", paths.decisionModels,
        "--models-max", String(slots),
        "--parallel", "1",
        "--ctx-size", "4096",
        "--no-webui",
      ],
    },
  };
}
