import { readHost } from "../lib/host.mjs";
import { selectLlmProfile } from "../lib/profiles.mjs";
import {
  downloadWeight,
  listWeights,
  modelStem,
  readConfig,
  readUsage,
  removeWeight,
  sampleFleet,
} from "../lib/models.mjs";

function json(body, isError = false) {
  return { text: JSON.stringify(body), isError };
}

export async function llmModels(env = process.env) {
  const library = await listWeights(env);
  const host = readHost(env);
  return json({
    ...library,
    files: library.files.filter((file) => file.role === "llm"),
    profile: selectLlmProfile(host)?.id ?? null,
    memGb: host.memGb,
  });
}

export async function llmConfig(args, env = process.env) {
  try {
    return json(await readConfig(env, args.file));
  } catch {
    return json({ ok: false, reason: "file" }, true);
  }
}

export async function llmUsage(env = process.env) {
  return json({ events: await readUsage(env, "llm") });
}

export async function llmDownload(args, env = process.env) {
  try {
    const result = await downloadWeight(env, args);
    return json(result, result.ok === false);
  } catch {
    return json({ ok: false, reason: "file" }, true);
  }
}

export async function llmRemove(args, env = process.env) {
  try {
    const result = await removeWeight(env, args.file);
    return json(result, result.ok === false);
  } catch {
    return json({ ok: false, reason: "file" }, true);
  }
}

export async function llmSample(args, env = process.env) {
  let library;
  try {
    library = await listWeights(env);
  } catch {
    return json({ ok: false, reason: "library" }, true);
  }
  const file = args.file;
  if (!library.files.some((item) => item.file === file && item.role === "llm")) {
    return json({ ok: false, reason: "file" }, true);
  }
  const fleet = library.files.filter((item) => item.role === "llm").map((item) => modelStem(item.file));
  const url = env.LLM_URL ?? env.LLAMA_URL ?? "";
  const result = await sampleFleet(env, {
    plugin: "llm",
    candidate: modelStem(file),
    fleet,
    seed: args.seed,
    url,
  });
  return json(result, false);
}
