import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const KEYCHAIN_SERVICE = "cloudflare";
export const KEYCHAIN_ACCOUNT = "default";
export const KEYCHAIN_UPDATE = "cloudflare-token";

const SECRET_KEYS = new Set([
  "access_token",
  "api_key",
  "api_token",
  "authorization",
  "bearer",
  "client_secret",
  "oauth_token",
  "password",
  "private_key",
  "refresh_token",
  "secret",
  "token",
]);

function command(env) {
  const override = env.SELFHOST_SECURITY ?? "";
  if (override) return override;
  if (process.platform !== "darwin") return "";
  return "/usr/bin/security";
}

export function classify(secret) {
  const value = String(secret ?? "").trim();
  if (!value) return "absent";
  if (value.startsWith("{")) return "envelope";
  if (/^[0-9a-fA-F]{37}$/.test(value)) return "global-key";
  if (/^[A-Za-z0-9_-]{40,128}$/.test(value)) return "usable";
  return "unusable";
}

function scrub(text, secret) {
  let out = String(text ?? "");
  if (secret) out = out.split(secret).join("[redacted]");
  return out.slice(0, 240);
}

export function redact(value, secret) {
  if (typeof value === "string") {
    let out = secret ? value.split(secret).join("[redacted]") : value;
    if (classify(out) === "usable" || classify(out) === "global-key") return "[redacted]";
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secret));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEYS.has(key.toLowerCase())) out[key] = "[redacted]";
      else if (key.toLowerCase() === "value" && typeof item === "string" && classify(item) !== "unusable" && classify(item) !== "absent") out[key] = "[redacted]";
      else out[key] = redact(item, secret);
    }
    return out;
  }
  return value;
}

export async function readSecret(env) {
  const bin = command(env);
  if (!bin) return { ok: false, reason: "unavailable" };
  try {
    const { stdout } = await execFileAsync(bin, ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"], {
      timeout: 5_000,
      maxBuffer: 8_192,
      encoding: "utf8",
      env,
    });
    const secret = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
    return { ok: true, secret };
  } catch (error) {
    const status = typeof error.code === "number" ? error.code : null;
    return { ok: false, reason: status === 44 ? "absent" : "unreadable" };
  }
}

export async function keychainStatus(env = process.env) {
  const base = {
    mechanism: "macos-keychain",
    service: KEYCHAIN_SERVICE,
    account: KEYCHAIN_ACCOUNT,
    update: KEYCHAIN_UPDATE,
  };
  const got = await readSecret(env);
  if (!got.ok) return { ...base, state: got.reason, usable: false };
  const kind = classify(got.secret);
  return { ...base, state: kind === "usable" ? "present" : kind, usable: kind === "usable" };
}

export async function storeSecret(secret, env = process.env) {
  const value = String(secret ?? "").trim();
  const kind = classify(value);
  if (kind !== "usable") return { stored: false, reason: kind };
  const bin = command(env);
  if (!bin) return { stored: false, reason: "unavailable" };
  const script = fileURLToPath(new URL("./keychain_set.py", import.meta.url));
  const child = spawn("/usr/bin/python3", [script], {
    env: { ...env, SELFHOST_SECURITY: bin },
    stdio: ["pipe", "ignore", "pipe"],
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.stdin.end(value);
  const code = await new Promise((resolve) => child.once("close", resolve));
  if (code === 0) return { stored: true };
  const err = scrub(Buffer.concat(stderr).toString("utf8"), value);
  if (err.includes("no prompt")) return { stored: false, reason: "no-prompt" };
  return { stored: false, reason: "store-failed" };
}

export async function promptDialog() {
  const source = [
    'set answer to display dialog "Paste the Cloudflare API token. It is stored in the login keychain and is not returned to the agent." default answer "" with hidden answer',
    "text returned of answer",
  ].join("\n");
  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", source], {
      timeout: 300_000,
      maxBuffer: 4_096,
      encoding: "utf8",
    });
    return stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  } catch (error) {
    const text = scrub(`${error.stderr ?? ""}\n${error.message ?? ""}`, "");
    const cancelled = /cancel/i.test(text);
    const failure = new Error(cancelled ? "cancelled" : "prompt-failed");
    failure.reason = cancelled ? "cancelled" : "prompt-failed";
    throw failure;
  }
}
