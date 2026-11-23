import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectSimulators, knownSimulator } from "./detect.mjs";
import { localDevUrl } from "../portless/host.mjs";

const execFileAsync = promisify(execFile);

async function simctl(args) {
  try {
    const { stdout, stderr } = await execFileAsync("xcrun", ["simctl", ...args], { timeout: 60_000 });
    return { text: `${stdout}${stderr}`.trim(), isError: false };
  } catch (error) {
    const stdout = error.stdout?.toString?.() ?? "";
    const stderr = error.stderr?.toString?.() ?? "";
    const text = `${stdout}${stderr}`.trim();
    if (text.includes("current state: Booted") || text.includes("current state: Shutdown")) return { text, isError: false };
    return { text: text || "simctl failed", isError: true };
  }
}

export async function simulatorList(env) {
  const available = await detectSimulators(env);
  return { text: JSON.stringify({ available, claim: "all" }), isError: false };
}

async function one(env, udid) {
  const available = await detectSimulators(env);
  const device = knownSimulator(udid, available);
  if (!device) return { device: null, text: available.length === 0 ? "no simulators" : "unknown simulator" };
  return { device, text: "" };
}

export async function simulatorBoot(args, env) {
  const picked = await one(env, args.udid);
  if (!picked.device) return { text: picked.text, isError: true };
  return simctl(["boot", picked.device.udid]);
}

export async function simulatorShutdown(args, env) {
  const picked = await one(env, args.udid);
  if (!picked.device) return { text: picked.text, isError: true };
  return simctl(["shutdown", picked.device.udid]);
}

export async function simulatorOpen(args, env) {
  const picked = await one(env, args.udid);
  if (!picked.device) return { text: picked.text, isError: true };
  const url = localDevUrl(args.url);
  if (!url) return { text: "url must be a local http or https address", isError: true };
  return simctl(["openurl", picked.device.udid, url]);
}
