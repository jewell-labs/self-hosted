import { authorize } from "./gate.mjs";

export async function handleLogRequest(request, env, api) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  const url = new URL(request.url);
  if (url.pathname === "/events" && request.method === "POST") return postEvent(request, api);
  if (url.pathname === "/events" && request.method === "GET") return getEvents(url, api);
  if (url.pathname === "/events/stream" && request.method === "GET") {
    const last = request.headers.get("Last-Event-ID") ?? url.searchParams.get("since") ?? "0";
    return api.stream(last, url.searchParams.get("plugin") ?? "");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return text("method", 405);
  }
  return api.assets(request);
}

async function postEvent(request, api) {
  let body;
  try {
    body = await request.json();
  } catch {
    return text("bad json", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return text("bad json", 400);
  try {
    const row = await api.append({
      plugin: body.plugin,
      level: body.level,
      event: body.event,
      detail: body.detail,
    });
    return Response.json(row, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return text(error.message || "bad event", 400);
  }
}

async function getEvents(url, api) {
  try {
    const events = await api.recent({
      since: url.searchParams.get("since") ?? "0",
      limit: url.searchParams.get("limit") ?? "200",
      plugin: url.searchParams.get("plugin") ?? "",
    });
    return Response.json({ events }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return text(error.message || "bad query", 400);
  }
}

function text(message, status) {
  return new Response(`${message}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
