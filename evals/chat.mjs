export async function chat(url, model, messages, { maxTokens, topK, seed, timeoutMs, fetchImpl }) {
  const payload = { model, messages, max_tokens: maxTokens, temperature: 0 };
  if (topK !== undefined) payload.top_k = topK;
  if (seed !== undefined) payload.seed = seed;
  const fetchFn = fetchImpl ?? globalThis.fetch;
  let response;
  try {
    response = await fetchFn(`${String(url).replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false };
  }
  if (!response?.ok) return { ok: false };
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false };
  }
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.length === 0) return { ok: false };
  return { ok: true, text };
}
