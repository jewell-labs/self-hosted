import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bridgeAddress, ensureForward, recordedProxy } from "./forward.mjs";
import { caPath, dnsLabel, loadPolicy, localDevHost, portRef, prefixFor, readCheckout, stateDir, urlLines } from "./host.mjs";

const execFileAsync = promisify(execFile);
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

async function binaryVersion() {
  try {
    const { stdout } = await execFileAsync("portless", ["--version"], { timeout: 5_000 });
    const match = stdout.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : stdout.trim();
  } catch {
    return null;
  }
}

export async function portlessStatus() {
  const policy = loadPolicy();
  return {
    text: JSON.stringify({
      version: policy.version,
      installed: await binaryVersion(),
      proxy: policy.proxy,
      services: policy.services.map((name) => portRef(name)),
      stateDir: stateDir(),
      caFile: caPath(),
      recordedProxy: recordedProxy(),
      bridge: bridgeAddress(),
    }),
    isError: false,
  };
}

export async function portlessUrls(args, env) {
  const services = Array.isArray(args.services) ? args.services : null;
  if (!services || services.length < 1 || services.length > 8 || services.some((service) => typeof service !== "string" || !LABEL.test(service))) {
    return { text: "services must be 1 to 8 DNS labels", isError: true };
  }
  let prefix = typeof args.prefix === "string" ? args.prefix : "";
  if (prefix && !LABEL.test(prefix)) return { text: "prefix must be a DNS label", isError: true };
  if (!prefix && typeof args.repo === "string") {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.repo)) return { text: "repo must be owner/name", isError: true };
    const { join } = await import("node:path");
    const { layout } = await import("../core/lib/paths.mjs");
    const root = join(env.GHREF_REF ?? layout(env).github, args.repo);
    try {
      prefix = prefixFor(await readCheckout(root));
    } catch {
      return { text: "repo checkout is not available", isError: true };
    }
  }
  if (!prefix || prefix !== dnsLabel(prefix)) return { text: "prefix or repo is required", isError: true };
  const bridge = bridgeAddress();
  return { text: JSON.stringify({ prefix, lines: urlLines(prefix, services, bridge), local: services.every((service) => localDevHost(`${prefix}.${service}.localhost`)) }), isError: false };
}

export async function portlessForward() {
  const result = await ensureForward();
  if (!result.address) return { text: "guest down", isError: false };
  return { text: JSON.stringify(result), isError: false };
}
