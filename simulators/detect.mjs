import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const UDID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSimctl(raw) {
  const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
  const found = [];
  for (const [runtime, devices] of Object.entries(doc.devices ?? {})) {
    if (!Array.isArray(devices)) continue;
    for (const device of devices) {
      if (!device || device.isAvailable === false) continue;
      if (typeof device.udid !== "string" || !UDID.test(device.udid)) continue;
      if (typeof device.name !== "string" || device.name.length === 0) continue;
      found.push({
        udid: device.udid.toUpperCase(),
        name: device.name,
        runtime,
        state: typeof device.state === "string" ? device.state : "Shutdown",
      });
    }
  }
  found.sort((a, b) => a.udid.localeCompare(b.udid));
  return found;
}

export async function detectSimulators(env = process.env) {
  if (env.SELFHOST_SIMCTL_FILE) return parseSimctl(await readFile(env.SELFHOST_SIMCTL_FILE, "utf8"));
  if (process.platform !== "darwin") return [];
  try {
    const { stdout } = await execFileAsync("xcrun", ["simctl", "list", "devices", "available", "-j"], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return parseSimctl(stdout);
  } catch {
    return [];
  }
}

export function knownSimulator(udid, devices) {
  if (typeof udid !== "string" || !UDID.test(udid)) return null;
  return devices.find((device) => device.udid === udid.toUpperCase()) ?? null;
}
