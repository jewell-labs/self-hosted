import { lstat } from "node:fs/promises";
import { adminCall } from "./admin.mjs";
import { KEYCHAIN_UPDATE, keychainStatus, promptDialog, storeSecret } from "./keychain.mjs";
import { readEvents } from "./log-client.mjs";
import { cloudflareUnit } from "./unit.mjs";

async function modeOf(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile()) return "other";
    return (stat.mode & 0o777).toString(8);
  } catch {
    return "absent";
  }
}

export function cloudflareAccess(env = process.env) {
  const unit = cloudflareUnit(env);
  return {
    text: JSON.stringify({ access: unit.access, tunnel: unit.tunnel }),
    isError: false,
  };
}

export async function cloudflareAuth(env = process.env) {
  const unit = cloudflareUnit(env);
  const body = {
    ...unit.auth,
    idMode: await modeOf(unit.auth.idFile),
    secretMode: await modeOf(unit.auth.secretFile),
    limits: unit.limits,
  };
  return { text: JSON.stringify(body), isError: false };
}

export async function cloudflareLogs(env = process.env) {
  const body = await readEvents(env);
  return { text: JSON.stringify(body), isError: body.ok === false };
}

export async function cloudflareAdmin(env = process.env) {
  return { text: JSON.stringify(await keychainStatus(env)), isError: false };
}

export async function cloudflareApply(args, env = process.env) {
  const result = await adminCall({ method: args.method, path: args.path, body: args.body, env });
  return { text: JSON.stringify(result), isError: result.ok !== true };
}

export async function cloudflareToken(env = process.env) {
  if (env.SELFHOST_KEYCHAIN_PROMPT === "off") {
    return { text: JSON.stringify({ stored: false, reason: "prompt-disabled", update: KEYCHAIN_UPDATE }), isError: true };
  }
  try {
    const saved = await storeSecret(await promptDialog(), env);
    const status = await keychainStatus(env);
    const body = { stored: saved.stored === true, usable: status.usable, state: status.state, update: KEYCHAIN_UPDATE };
    if (!saved.stored) body.reason = saved.reason;
    return { text: JSON.stringify(body), isError: saved.stored !== true };
  } catch (error) {
    const reason = error.reason === "cancelled" ? "cancelled" : "prompt-failed";
    return { text: JSON.stringify({ stored: false, reason, update: KEYCHAIN_UPDATE }), isError: true };
  }
}
