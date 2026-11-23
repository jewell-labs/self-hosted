import { accessConfig, verifyAccessJwt } from "./access.mjs";

function denied(message) {
  return new Response(`${message}\n`, {
    status: 401,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

// Same CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD as MCP. No second audience.
// Access at the edge turns the shared service token into this JWT.
// SELFHOST_LOG_DEV=1 is the only open mode, and it is for a local wrangler session.
export async function authorize(request, env) {
  const config = accessConfig(env);
  if (!config.required) {
    if (env.SELFHOST_LOG_DEV === "1") return null;
    return denied("cloudflare access required");
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion") ?? "";
  if (!token) return denied("cloudflare access jwt required");
  try {
    await verifyAccessJwt(token, config, env);
    return null;
  } catch {
    return denied("cloudflare access jwt required");
  }
}
