import { evaluateAll } from "./evaluate.mjs";

const ids = (process.env.SELFHOST_EVAL_IDS ?? "").split(",").map((item) => item.trim()).filter((item) => item !== "");
let results;
try {
  results = await evaluateAll(ids, {
    model: process.env.SELFHOST_EVAL_MODEL ?? "",
    llmUrl: process.env.SELFHOST_LLM_URL ?? "",
    decisionModel: process.env.SELFHOST_EVAL_DECISION_MODEL ?? "",
    decisionUrl: process.env.SELFHOST_DECISION_URL ?? "",
    root: process.env.SELFHOST_ROOT ?? "/src",
  });
} catch {
  results = ids.map((id) => ({ id, detail: "error", body: "container" }));
}
process.stdout.write(`${JSON.stringify({ results })}\n`);
