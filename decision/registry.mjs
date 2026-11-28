import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readHost } from "../core/lib/host.mjs";
import { layout } from "../core/lib/paths.mjs";
import { DECISION_SCHEMA, decisionSlots, loadDecisionCatalog, readDecisionModels } from "../core/lib/decision-catalog.mjs";

export { DECISION_SCHEMA, decisionSlots, loadDecisionCatalog, readDecisionModels };

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const DECISION_PORT = "port {decision}";

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
