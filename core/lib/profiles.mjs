// Rendered argv for llama.cpp. Placeholders are filled from the host.
// Apple silicon keeps every layer on the GPU. Thread count comes from the host.

export const LLAMA_PROFILES = {
  "darwin-arm64": {
    match: { os: ["darwin"], arch: ["arm64"] },
    port: "llm",
    args: [
      "--host", "127.0.0.1",
      "--port", "{{port}}",
      "--jinja",
      "--flash-attn", "on",
      "--n-gpu-layers", "999",
      "--threads", "{{threads}}",
      "--threads-batch", "{{threads}}",
      "--batch-size", "2048",
      "--ubatch-size", "512",
      "--cache-type-k", "q8_0",
      "--cache-type-v", "q8_0",
      "--ctx-size", "8192",
      "--parallel", "1",
      "--cont-batching",
      "--models-max", "1",
      "--no-webui",
      "--metrics",
    ],
  },
  "linux-cuda": {
    match: { os: ["linux"], arch: ["arm64", "x64"], nvidia: true },
    port: "llm",
    args: [
      "--host", "127.0.0.1",
      "--port", "{{port}}",
      "--jinja",
      "--flash-attn", "on",
      "--n-gpu-layers", "999",
      "--threads", "{{threads}}",
      "--batch-size", "2048",
      "--ubatch-size", "512",
      "--cache-type-k", "q8_0",
      "--cache-type-v", "q8_0",
      "--ctx-size", "8192",
      "--parallel", "1",
      "--cont-batching",
      "--models-max", "1",
      "--no-webui",
      "--metrics",
    ],
  },
  "linux-cpu": {
    match: { os: ["linux"], arch: ["arm64", "x64"] },
    port: "llm",
    args: [
      "--host", "127.0.0.1",
      "--port", "{{port}}",
      "--jinja",
      "--flash-attn", "off",
      "--n-gpu-layers", "0",
      "--threads", "{{threads}}",
      "--threads-batch", "{{threads}}",
      "--batch-size", "512",
      "--ubatch-size", "256",
      "--ctx-size", "4096",
      "--parallel", "1",
      "--models-max", "1",
      "--no-webui",
      "--metrics",
    ],
  },
};

export function renderArgs(args, host) {
  return args.map((part) => part.replaceAll("{{threads}}", String(Math.max(1, host.cpus))));
}

function profileMatches(profile, host) {
  const match = profile.match;
  if (!match.os.includes(host.os) || !match.arch.includes(host.arch)) return false;
  if (match.nvidia === true && !host.nvidia) return false;
  if (match.minMemGb !== undefined && host.memGb < match.minMemGb) return false;
  if (match.maxMemGb !== undefined && host.memGb > match.maxMemGb) return false;
  return true;
}

export function selectLlmProfile(host) {
  const order = host.nvidia
    ? ["linux-cuda", "darwin-arm64", "linux-cpu"]
    : ["darwin-arm64", "linux-cpu", "linux-cuda"];
  for (const id of order) {
    const profile = LLAMA_PROFILES[id];
    if (profileMatches(profile, host)) return { id, ...profile, args: renderArgs(profile.args, host) };
  }
  return null;
}
