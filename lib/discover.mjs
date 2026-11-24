import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accessConfig } from "./access.mjs";
import { readHost } from "./host.mjs";
import { layout } from "./paths.mjs";
import { decisionSlots, readDecisionModels } from "../decision/registry.mjs";
import { selectLlmProfile } from "./profiles.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function repoRoot() {
  return process.env.SELFHOST_ROOT ?? root;
}

export function loadPrompt() {
  const text = readFileSync(join(root, "prompts/setup-host.md"), "utf8");
  const sha256 = createHash("sha256").update(text).digest("hex");
  return { text, sha256 };
}

function pluginView(plugin, host, access, profile, env) {
  let applicable = true;
  let reason = "host matches";
  const match = plugin.match ?? {};
  if (match.os && !match.os.includes(host.os)) {
    applicable = false;
    reason = `needs ${match.os.join(" or ")}`;
  } else if (match.arch && !match.arch.includes(host.arch)) {
    applicable = false;
    reason = `needs ${match.arch.join(" or ")}`;
  }
  if (plugin.id === "llm" && applicable && profile === null) {
    applicable = false;
    reason = "no llama.cpp profile for this host";
  }
  const view = {
    id: plugin.id,
    summary: plugin.summary,
    applicable,
    reason,
    proofRequired: plugin.proofRequired === true,
    setup: plugin.setup,
    validate: plugin.validate,
  };
  if (plugin.id === "llm" && profile) {
    view.profile = profile.id;
    view.args = profile.args;
    view.port = profile.port;
  }
  if (plugin.id === "decision") {
    view.slots = decisionSlots(host.memGb);
    view.models = readDecisionModels(env).length;
    view.reason = view.slots > 0
      ? `${view.slots} resident decision slots beside the llm server`
      : "registry only; no resident slot beside the llm server";
    if (!applicable) view.reason = reason;
  }
  if (plugin.id === "mcp") {
    view.access = access.required ? "cloudflare-access" : "loopback-only";
  }
  if (plugin.id === "actions-runner") {
    view.publicRunnerAllowed = env.ALLOW_PUBLIC_REPO_RUNNER === "1";
  }
  return view;
}

export function buildDiscovery(env = process.env) {
  const measured = readHost(env);
  const access = accessConfig(env);
  const profile = selectLlmProfile(measured);
  const host = { ...measured };
  delete host.freeGb;
  const paths = layout(env);
  const catalog = JSON.parse(readFileSync(join(root, "catalog/plugins.json"), "utf8"));
  const prompt = loadPrompt();
  const plugins = catalog.plugins.map((plugin) => pluginView(plugin, host, access, profile, env));
  return {
    schema: "jewell-labs.self-hosted.discover.v1",
    repo: "https://github.com/jewell-labs/self-hosted",
    stores: {
      home: paths.root,
      weights: paths.gguf,
      containers: paths.containers,
    },
    host,
    access: {
      required: access.required,
      teamDomain: access.required ? access.teamDomain : null,
      exposure: access.required ? "cloudflare-access" : "loopback-only",
    },
    llmProfile: profile ? { id: profile.id, port: profile.port, args: profile.args } : null,
    plugins,
    setupPrompt: prompt.text,
    setupPromptSha256: prompt.sha256,
  };
}
