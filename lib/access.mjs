import { createPublicKey, verify } from "node:crypto";

const SKEW_SEC = 60;
const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map();

function b64urlJson(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
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
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const ok = verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
  if (!ok) throw new Error("sig");
  return payload;
}
