// Rendered argv for llama.cpp 1.0. Placeholders are filled from the host.
// Mac Studio M1 Max, 32GB unified memory, single-stream throughput:
// eight performance cores, every layer on Metal, Flash Attention, q8_0 KV,
// context 8192, one slot. A larger context or a second slot spends bandwidth
// on KV instead of weights. mlock is omitted; unified memory does not benefit,
// and locking the working set fights jetsam.

export const LLAMA_PROFILES = {
  "mac-studio-m1-max-32gb": {
    match: { os: ["darwin"], arch: ["arm64"], minMemGb: 24, maxMemGb: 40 },
    port: 8080,
    args: [
      "--host", "127.0.0.1",
      "--port", "8080",
      "--jinja",
      "--flash-attn", "on",
      "--n-gpu-layers", "999",
      "--threads", "8",
      "--threads-batch", "8",
      "--cpu-range", "0-7",
      "--batch-size", "2048",
      "--ubatch-size", "512",
      "--cache-type-k", "q8_0",
      "--cache-type-v", "q8_0",
      "--ctx-size", "8192",
      "--parallel", "1",
      "--cont-batching",
      "--models-max", "1",
      "--models-memory-margin", "4096",
      "--cache-ram", "4096",
      "--sleep-idle-seconds", "600",
      "--no-webui",
      "--metrics",
    ],
  },
  "linux-cuda": {
    match: { os: ["linux"], arch: ["arm64", "x64"], nvidia: true },
    port: 8080,
    args: [
      "--host", "127.0.0.1",
      "--port", "8080",
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
    port: 8080,
    args: [
      "--host", "127.0.0.1",
      "--port", "8080",
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

export function selectLlamaProfile(host) {
  const order = host.nvidia
    ? ["linux-cuda", "mac-studio-m1-max-32gb", "linux-cpu"]
    : ["mac-studio-m1-max-32gb", "linux-cpu", "linux-cuda"];
  for (const id of order) {
    const profile = LLAMA_PROFILES[id];
    if (profileMatches(profile, host)) return { id, ...profile, args: renderArgs(profile.args, host) };
  }
  return null;
}
