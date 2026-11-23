import { arch, cpus, freemem, hostname, platform, totalmem } from "node:os";
import { layout } from "./paths.mjs";

export function readHost(env = process.env) {
  const memBytes = totalmem();
  return {
    os: platform(),
    arch: arch(),
    hostname: hostname(),
    cpus: cpus().length,
    memBytes,
    memGb: Math.round((memBytes / 1024 ** 3) * 10) / 10,
    freeGb: Math.round((freemem() / 1024 ** 3) * 10) / 10,
    nvidia: env.SELFHOST_NVIDIA === "1",
    modelsDir: env.SELFHOST_MODELS_DIR ?? layout(env).gguf,
    llmModels: env.SELFHOST_LLM_MODELS ?? layout(env).llmModels,
    decisionModels: env.SELFHOST_DECISION_MODELS ?? layout(env).decisionModels,
    llmUrl: env.LLM_URL ?? env.LLAMA_URL ?? null,
  };
}
