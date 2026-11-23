import { classify, keychainStatus, readSecret, redact } from "./keychain.mjs";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const PATH_RE = /^\/client\/v4\/[A-Za-z0-9._~%/-]+(?:\?[A-Za-z0-9._~%=&+-]*)?$/;
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

export function adminRequest(method, path, body) {
  const verb = typeof method === "string" ? method.toUpperCase() : "";
  if (!METHODS.has(verb)) return { ok: false, reason: "method" };
  if (typeof path !== "string" || !PATH_RE.test(path) || path.includes("..") || path.includes("//")) {
    return { ok: false, reason: "path" };
  }
  if (body !== undefined && body !== "") {
    if (!BODY_METHODS.has(verb) || typeof body !== "string" || body.length > 65_536) return { ok: false, reason: "body" };
    try {
      JSON.parse(body);
    } catch {
      return { ok: false, reason: "body" };
    }
  }
  return { ok: true, method: verb, path, body: body || "" };
}

export async function adminCall({ method, path, body, env = process.env, fetchImpl = globalThis.fetch, secret }) {
  const request = adminRequest(method, path, body);
  if (!request.ok) return { ...request, update: "just cloudflare-token" };
  let token = secret;
  if (token === undefined) {
    const status = await keychainStatus(env);
    if (!status.usable) return { ok: false, reason: status.state, usable: false, update: status.update };
    const loaded = await readSecret(env);
    if (!loaded.ok || classify(loaded.secret) !== "usable") {
      return { ok: false, reason: loaded.reason ?? "unreadable", usable: false, update: status.update };
    }
    token = loaded.secret;
  }
  if (request.body && request.body.includes(token)) return { ok: false, reason: "body", update: "just cloudflare-token" };
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
  const init = { method: request.method, headers, redirect: "manual" };
  if (request.body) {
    headers["Content-Type"] = "application/json";
    init.body = request.body;
  }
  let response;
  try {
    response = await fetchImpl(`https://api.cloudflare.com${request.path}`, init);
  } catch {
    return { ok: false, reason: "request", update: "just cloudflare-token" };
  }
  if (response.status >= 300 && response.status < 400) {
    return { ok: false, status: response.status, reason: "redirect", update: "just cloudflare-token" };
  }
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { text };
  }
  const result = redact(parsed, token);
  const payload = JSON.stringify(result);
  if (token && payload.includes(token)) return { ok: false, status: response.status, reason: "redaction" };
  return { ok: response.ok && parsed?.success !== false, status: response.status, result };
}
