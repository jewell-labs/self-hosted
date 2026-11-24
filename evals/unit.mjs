export const EVAL_SCHEMA = "jewell-labs.self-hosted.evals.v1";
export const EVAL_IDS = Object.freeze(["llm-hierarchy", "decision-core"]);

export function evalUnit() {
  return { schema: EVAL_SCHEMA, ids: [...EVAL_IDS] };
}

export function selectedIds(id) {
  if (id === undefined || id === "") return [...EVAL_IDS];
  if (typeof id !== "string" || !EVAL_IDS.includes(id)) return null;
  return [id];
}
