const SKEW_SEC = 60;
const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map();

function b64urlBytes(segment) {
  const pad = segment.length % 4 === 0 ? "" : "=".repeat(4 - (segment.length % 4));
  const bin = atob(segment.replaceAll("-", "+").replaceAll("_", "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(segment) {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(segment)));
}

export function accessConfig(env = process.env) {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN ?? "";
  const aud = env.CF_ACCESS_AUD ?? "";
  const jwksFile = env.SELFHOST_ACCESS_JWKS_FILE ?? "";
  const required = teamDomain !== "" && aud !== "";
  return { teamDomain, aud, jwksFile, required };
}

export async function fetchJwks(url, env = process.env) {
  const file = env.SELFHOST_ACCESS_JWKS_FILE;
  const key = file ? `file:${file}` : `url:${url}`;
  const hit = jwksCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < JWKS_TTL_MS) return hit.value;
  let value;
  if (file) {
    const { readFile } = await import("node:fs/promises");
    value = JSON.parse(await readFile(file, "utf8"));
  } else {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`jwks ${response.status}`);
    value = await response.json();
  }
  jwksCache.set(key, { at: now, value });
  return value;
}

export async function verifyAccessJwt(token, config, env = process.env, now = Date.now()) {
  if (!config.required) throw new Error("access is not configured");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed jwt");
  const [h, p, s] = parts;
  const header = b64urlJson(h);
  const payload = b64urlJson(p);
  if (header.alg !== "RS256") throw new Error("alg");
  const issuer = `https://${config.teamDomain}`;
  if (payload.iss !== issuer) throw new Error("iss");
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(config.aud)) throw new Error("aud");
  if (typeof payload.exp !== "number" || payload.exp < now / 1000 - SKEW_SEC) throw new Error("exp");
  if (typeof payload.nbf === "number" && payload.nbf > now / 1000 + SKEW_SEC) throw new Error("nbf");
  const jwks = await fetchJwks(`https://${config.teamDomain}/cdn-cgi/access/certs`, env);
  const jwk = (jwks.keys ?? []).find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("sig");
  return payload;
}
