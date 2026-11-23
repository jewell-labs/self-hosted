import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accessConfig } from "./access.mjs";
import { readHost } from "./host.mjs";
import { selectLlamaProfile } from "./profiles.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function repoRoot() {
  return root;
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
  if (plugin.id === "llama" && applicable && profile === null) {
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
  if (plugin.id === "llama" && profile) {
    view.profile = profile.id;
    view.args = profile.args;
    view.port = profile.port;
  }
  if (plugin.id === "decision") {
    view.secondProcess = host.memGb >= 64;
    view.reason = view.secondProcess
      ? "host has room for a second llama-server"
      : "under 64GB: use the throughput router, do not start a second server";
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
  const host = readHost(env);
  const access = accessConfig(env);
  const profile = selectLlamaProfile(host);
  const catalog = JSON.parse(readFileSync(join(root, "catalog/plugins.json"), "utf8"));
  const prompt = loadPrompt();
  const plugins = catalog.plugins.map((plugin) => pluginView(plugin, host, access, profile, env));
  return {
    schema: "jewell-labs.self-hosted.discover.v1",
    repo: "https://github.com/jewell-labs/self-hosted",
    host,
    access: {
      required: access.required,
      teamDomain: access.required ? access.teamDomain : null,
      exposure: access.required ? "cloudflare-access" : "loopback-only",
    },
    llamaProfile: profile ? { id: profile.id, port: profile.port, args: profile.args } : null,
    plugins,
    setupPrompt: prompt.text,
    setupPromptSha256: prompt.sha256,
  };
}
