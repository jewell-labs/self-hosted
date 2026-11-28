// Weight library. Downloads, deletes, and logs stay inside the home from core/home/policy.json.
import { readdir, readFile, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import { DECISION_SCHEMA, loadDecisionCatalog, readDecisionModels } from "./decision-catalog.mjs";
import { homeDir, layout } from "./paths.mjs";
import { loadHomePolicy, realInside, writeInside } from "./jail.mjs";
import { repoRoot } from "./discover.mjs";

const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,180}\.gguf$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const REV_RE = /^[A-Za-z0-9._-]{1,40}$/;

export function admitDownload({ freeBytes, sizeBytes, reserveBytes, maxBytes }) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "size";
  if (sizeBytes > maxBytes) return "max";
  if (freeBytes - sizeBytes < reserveBytes) return "reserve";
  return "";
}

export function weightFile(name) {
  if (typeof name !== "string" || !FILE_RE.test(name)) throw new Error("file");
  return name;
}

export function huggingfaceUrl(repo, file, revision = "main") {
  if (!REPO_RE.test(repo) || !REV_RE.test(revision)) throw new Error("repo");
  return `https://huggingface.co/${repo}/resolve/${revision}/${weightFile(file)}`;
}

function stem(file) {
  return file.slice(0, -".gguf".length);
}

async function catalogModels(env) {
  try {
    return readDecisionModels(env);
  } catch {
    return [];
  }
}

export async function listWeights(env = process.env) {
  const policy = await loadHomePolicy(env.SELFHOST_ROOT ?? repoRoot());
  const home = homeDir(env);
  const dir = await realInside(home, layout(env).gguf);
  let names = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".gguf"));
  } catch {
    names = [];
  }
  const decision = new Set((await catalogModels(env)).filter((model) => model.kind === "model").map((model) => model.file));
  const files = [];
  for (const name of names.sort()) {
    const info = await stat(join(dir, name));
    files.push({ file: name, bytes: info.size, role: decision.has(name) ? "decision" : "llm" });
  }
  let freeBytes = 0;
  try {
    const space = await statfs(home);
    freeBytes = Number(space.bavail) * Number(space.bsize);
  } catch {
    freeBytes = 0;
  }
  return {
    weights: policy.weights,
    files,
    freeBytes,
    reserveBytes: policy.diskReserveBytes,
    maxDownloadBytes: policy.maxDownloadBytes,
  };
}

export async function readConfig(env, file) {
  const name = weightFile(file);
  const home = homeDir(env);
  const path = await realInside(home, join(layout(env).gguf, name));
  const handle = await readFile(path);
  const bytes = handle.length;
  const head = handle.subarray(0, Math.min(bytes, 256 * 1024));
  return { file: name, bytes, ...parseGguf(head) };
}

function parseGguf(buf) {
  if (buf.length < 24 || buf.toString("utf8", 0, 4) !== "GGUF") return { parsed: false };
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 8;
  const readU64 = () => {
    const value = view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 2 ** 32;
    offset += 8;
    return value;
  };
  const readU32 = () => {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  try {
    readU64();
    const count = readU64();
    const meta = {};
    let truncated = false;
    for (let i = 0; i < count; i += 1) {
      if (offset + 8 > buf.length) {
        truncated = true;
        break;
      }
      const keyLen = readU64();
      if (keyLen > 1024 || offset + keyLen > buf.length) {
        truncated = true;
        break;
      }
      const key = buf.toString("utf8", offset, offset + keyLen);
      offset += keyLen;
      const type = readU32();
      const value = readValue(view, buf, type, () => offset, (next) => { offset = next; });
      if (value === undefined) {
        truncated = true;
        break;
      }
      if (/general\.(architecture|name|file_type)$|context_length$|block_count$|embedding_length$/.test(key)) meta[key] = value;
    }
    return { parsed: true, truncated, metadata: meta };
  } catch {
    return { parsed: false };
  }
}

function readValue(view, buf, type, getOffset, setOffset) {
  const offset = getOffset();
  const need = (n) => {
    if (offset + n > buf.length) return false;
    setOffset(offset + n);
    return true;
  };
  if (type === 8) {
    if (offset + 8 > buf.length) return undefined;
    const len = view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 2 ** 32;
    if (len > 4096 || offset + 8 + len > buf.length) return undefined;
    setOffset(offset + 8 + len);
    return buf.toString("utf8", offset + 8, offset + 8 + len);
  }
  if (type === 9) {
    if (offset + 12 > buf.length) return undefined;
    const inner = view.getUint32(offset, true);
    const count = view.getUint32(offset + 4, true) + view.getUint32(offset + 8, true) * 2 ** 32;
    if (count > 8) return undefined;
    setOffset(offset + 12);
    const values = [];
    for (let i = 0; i < count; i += 1) {
      const value = readValue(view, buf, inner, getOffset, setOffset);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }
  const width = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 }[type];
  if (!width || !need(width)) return undefined;
  if (type === 4 || type === 5) return view.getUint32(offset, true);
  if (type === 10 || type === 11) return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 2 ** 32;
  if (type === 6) return view.getFloat32(offset, true);
  if (type === 7) return view.getUint8(offset) === 1;
  return view.getUint8(offset);
}

async function freeBytes(home) {
  const space = await statfs(home);
  return Number(space.bavail) * Number(space.bsize);
}

export async function downloadWeight(env, spec, fetchImpl = globalThis.fetch) {
  const policy = await loadHomePolicy(env.SELFHOST_ROOT ?? repoRoot());
  const file = weightFile(spec.file);
  const url = huggingfaceUrl(spec.repo, file, spec.revision ?? "main");
  const home = homeDir(env);
  const dest = await realInside(home, join(layout(env).gguf, file));
  try {
    await stat(dest);
    return { ok: false, reason: "exists", file };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const head = await fetchImpl(url, { method: "HEAD" });
  if (!head.ok) return { ok: false, reason: "source", file };
  const size = Number(head.headers.get("content-length"));
  const reason = admitDownload({
    freeBytes: await freeBytes(home),
    sizeBytes: size,
    reserveBytes: policy.diskReserveBytes,
    maxBytes: policy.maxDownloadBytes,
  });
  if (reason) return { ok: false, reason, file, bytes: Number.isFinite(size) ? size : 0 };
  const response = await fetchImpl(url);
  if (!response.ok) return { ok: false, reason: "source", file };
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length !== size) return { ok: false, reason: "size", file };
  const partial = await realInside(home, join(layout(env).gguf, `.${file}.partial`));
  await writeInside(home, partial, body);
  const { rename } = await import("node:fs/promises");
  await rename(partial, dest);
  await realInside(home, dest);
  return { ok: true, file, bytes: body.length };
}

async function hostCatalog(env) {
  const path = join(layout(env).decision, "catalog.json");
  try {
    return { path, models: loadDecisionCatalog(await readFile(path, "utf8")) };
  } catch (error) {
    if (error.code === "ENOENT") return { path, models: [] };
    throw error;
  }
}

async function writeHostCatalog(env, models) {
  const home = homeDir(env);
  const path = join(layout(env).decision, "catalog.json");
  const doc = { schema: DECISION_SCHEMA, models };
  loadDecisionCatalog(JSON.stringify(doc));
  await writeInside(home, path, `${JSON.stringify(doc, null, 2)}\n`);
}

export async function addDecisionModel(env, id, file) {
  weightFile(file);
  const current = await hostCatalog(env);
  const merged = current.models.filter((model) => model.id !== id);
  merged.push({ id, kind: "model", file });
  await writeHostCatalog(env, merged);
  return { id, file };
}

export async function removeWeight(env, file) {
  const name = weightFile(file);
  const users = (await catalogModels(env)).filter((model) => model.kind === "model" && model.file === name);
  if (users.length > 0) return { ok: false, reason: "decision", file: name, ids: users.map((model) => model.id) };
  const home = homeDir(env);
  const path = await realInside(home, join(layout(env).gguf, name));
  const { rm } = await import("node:fs/promises");
  await rm(path);
  return { ok: true, file: name };
}

export async function removeDecisionModel(env, id) {
  const models = await catalogModels(env);
  const model = models.find((item) => item.id === id && item.kind === "model");
  if (!model) return { ok: false, reason: "model", id };
  const referenced = models.filter((item) => item.kind === "compound" && item.steps.includes(id));
  if (referenced.length > 0) return { ok: false, reason: "referenced", id };
  const host = await hostCatalog(env);
  if (!host.models.some((item) => item.id === id)) return { ok: false, reason: "repo-catalog", id };
  await writeHostCatalog(env, host.models.filter((item) => item.id !== id));
  const still = (await catalogModels(env)).some((item) => item.kind === "model" && item.file === model.file);
  if (!still) await removeWeight(env, model.file);
  return { ok: true, id, file: model.file };
}

export async function recordUsage(env, event) {
  const policy = await loadHomePolicy(env.SELFHOST_ROOT ?? repoRoot());
  const home = homeDir(env);
  const path = join(homeDir(env), policy.usageLog);
  let lines = [];
  try {
    const text = await readFile(await realInside(home, path), "utf8");
    lines = text.split("\n").filter(Boolean);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const row = {
    t: new Date().toISOString(),
    plugin: event.plugin,
    model: event.model,
    event: event.event,
    ok: event.ok === true,
    ms: Math.max(0, Math.round(event.ms ?? 0)),
  };
  lines.push(JSON.stringify(row));
  const kept = lines.slice(-policy.usageKeep);
  await writeInside(home, path, `${kept.join("\n")}\n`);
}

export async function readUsage(env, plugin) {
  const policy = await loadHomePolicy(env.SELFHOST_ROOT ?? repoRoot());
  const path = join(homeDir(env), policy.usageLog);
  try {
    const text = await readFile(await realInside(homeDir(env), path), "utf8");
    const rows = text.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((row) => row.plugin === plugin);
    return rows.slice(-50);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function pick(seed, items, count) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const pool = [...items];
  const chosen = [];
  while (pool.length > 0 && chosen.length < count) {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    chosen.push(pool.splice((hash >>> 0) % pool.length, 1)[0]);
  }
  return chosen;
}

async function complete(url, model, text, fetchImpl) {
  const started = Date.now();
  const response = await fetchImpl(`${url.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: text }], max_tokens: 16 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return { ok: false, ms: Date.now() - started };
  const body = await response.json();
  const out = body?.choices?.[0]?.message?.content;
  if (typeof out !== "string") return { ok: false, ms: Date.now() - started };
  return { ok: true, text: out.slice(0, 200), ms: Date.now() - started };
}

export async function sampleFleet(env, { plugin, candidate, fleet, seed, url, fetchImpl = globalThis.fetch }) {
  const policy = await loadHomePolicy(env.SELFHOST_ROOT ?? repoRoot());
  const others = pick(String(seed ?? ""), fleet.filter((item) => item !== candidate), 2);
  const compared = [candidate, ...others];
  if (!url) {
    return { keep: false, ran: false, reason: "router-stopped", compared, replace: [] };
  }
  const results = [];
  for (const model of compared) {
    const probes = [];
    for (const probe of policy.probes) {
      const result = await complete(url, model, probe.text, fetchImpl);
      const pass = result.ok && result.text.toLowerCase().includes(String(probe.expect).toLowerCase());
      probes.push({ id: probe.id, pass, ms: result.ms });
      await recordUsage(env, { plugin, model, event: `probe.${probe.id}`, ok: pass, ms: result.ms });
    }
    results.push({ model, pass: probes.every((probe) => probe.pass), probes });
  }
  const candidateResult = results[0];
  const failed = results.slice(1).filter((item) => !item.pass);
  const replace = candidateResult.pass && failed.length > 0 ? [failed[0].model] : [];
  return {
    keep: candidateResult.pass,
    ran: true,
    compared,
    replace,
    results: results.map((item) => ({ model: item.model, pass: item.pass })),
  };
}

export function modelStem(file) {
  return stem(weightFile(file));
}
