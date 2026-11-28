function eventsUrl(env) {
  const base = env.SELFHOST_LOG_URL ?? "";
  if (!base) return "";
  return base.endsWith("/events") ? base : `${base.replace(/\/$/, "")}/events`;
}

function accessHeaders(env) {
  const headers = {};
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET;
  }
  if (env.SELFHOST_LOG_JWT) headers["Cf-Access-Jwt-Assertion"] = env.SELFHOST_LOG_JWT;
  return headers;
}

export async function publishEvent(env, event) {
  const url = eventsUrl(env);
  if (!url) return { stored: false };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...accessHeaders(env) },
      body: JSON.stringify({
        plugin: event.plugin,
        level: event.level,
        event: event.event,
        detail: event.detail ?? "",
      }),
      signal: AbortSignal.timeout(2_000),
    });
    return { stored: response.ok };
  } catch {
    return { stored: false };
  }
}
