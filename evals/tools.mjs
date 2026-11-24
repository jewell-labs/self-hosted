import { readDecisionModels } from "../decision/registry.mjs";
import { repoRoot } from "../lib/discover.mjs";
import { alignResults, runIsolated } from "./isolate.mjs";
import { evalUnit, selectedIds } from "./unit.mjs";

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/;

export function coreDecisionId(models) {
  const weights = (models ?? []).filter((model) => model.kind === "model");
  const core = weights.find((model) => model.id === "core");
  return (core ?? weights[0])?.id ?? "";
}

export function llmModelId(args, env) {
  const raw = typeof args?.model === "string" && args.model !== "" ? args.model : (env.LLM_MODEL || env.LLAMA_MODEL || "");
  if (typeof raw !== "string") return "";
  const model = raw.trim();
  if (!MODEL_RE.test(model) || model.includes("..")) return "";
  return model;
}

function httpUrl(value) {
  if (typeof value !== "string" || value === "") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return value.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export async function evalSpec(args, env, ids) {
  let decisionModel = "";
  try {
    decisionModel = coreDecisionId(readDecisionModels(env));
  } catch {
    decisionModel = "";
  }
  return {
    ids,
    model: llmModelId(args, env),
    llmUrl: httpUrl(env.LLM_URL || env.LLAMA_URL || env.SELFHOST_LLM_URL || ""),
    decisionUrl: httpUrl(env.SELFHOST_DECISION_URL || ""),
    decisionModel,
    root: env.SELFHOST_ROOT ?? repoRoot(),
    container: typeof env.SELFHOST_CONTAINER === "string" ? env.SELFHOST_CONTAINER : "",
  };
}

function publishEval(bus, name, detail, body) {
  if (!bus) return;
  const input = { plugin: "evals", type: "eval", name, detail };
  if (body) input.body = body;
  bus.publish(input);
}

export function evalsList() {
  return {
    text: JSON.stringify({
      schema: evalUnit().schema,
      ids: [
        { id: "llm-hierarchy", kind: "llm" },
        { id: "decision-core", kind: "decision" },
      ],
    }),
    isError: false,
  };
}

export async function evalsRun(args, env = process.env, opts = {}) {
  const ids = selectedIds(args?.id);
  if (!ids) return { text: JSON.stringify({ ok: false, reason: "id" }), isError: true };
  for (const id of ids) publishEval(opts.bus, id, "started");
  const spec = await evalSpec(args, env, ids);
  const isolate = opts.isolate ?? runIsolated;
  let outcome;
  try {
    outcome = await isolate(spec, { execFile: opts.execFile, listen: opts.listen });
  } catch {
    outcome = { isolated: false, results: ids.map((id) => ({ id, detail: "error", body: "container" })) };
  }
  const results = alignResults(ids, outcome?.results);
  for (const result of results) publishEval(opts.bus, result.id, result.detail, result.body);
  return {
    text: JSON.stringify({ isolated: outcome?.isolated === true, results }),
    isError: results.some((result) => result.detail !== "ok"),
  };
}
