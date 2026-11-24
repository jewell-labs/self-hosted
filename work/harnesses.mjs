import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../lib/discover.mjs";

const ID_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const COMMAND_RE = /^[A-Za-z0-9][A-Za-z0-9.+_-]*$/;

function stringList(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${field} must be a string array`);
  }
  return value;
}

export function parseDescriptor(file, text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not json`);
  }
  const id = file.replace(/\.json$/, "");
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${file} is not a descriptor`);
  if (doc.id !== id || !ID_RE.test(id)) throw new Error(`${file} id`);
  if (typeof doc.command !== "string" || !COMMAND_RE.test(doc.command)) throw new Error(`${file} command`);
  stringList(doc.probe, `${file} probe`);
  stringList(doc.cli, `${file} cli`);
  if (!doc.cli.includes("{cwd}") || !doc.cli.includes("{prompt}")) throw new Error(`${file} cli needs {cwd} and {prompt}`);
  if (typeof doc.expect !== "string" || doc.expect.length === 0) throw new Error(`${file} expect`);
  if (doc.model !== undefined) stringList(doc.model, `${file} model`);
  if (doc.agents !== undefined) stringList(doc.agents, `${file} agents`);
  if (doc.acp !== undefined) stringList(doc.acp, `${file} acp`);
  if (doc.acpCommand !== undefined && (typeof doc.acpCommand !== "string" || !COMMAND_RE.test(doc.acpCommand))) {
    throw new Error(`${file} acpCommand`);
  }
  if (doc.dirFlag !== undefined && (typeof doc.dirFlag !== "string" || doc.dirFlag.length === 0)) throw new Error(`${file} dirFlag`);
  if (doc.argsBeforePrompt !== undefined && typeof doc.argsBeforePrompt !== "boolean") throw new Error(`${file} argsBeforePrompt`);
  return doc;
}

export async function loadDescriptors(root = repoRoot()) {
  const dir = join(root, "work/harnesses");
  let files = [];
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const docs = [];
  for (const file of files) {
    docs.push(parseDescriptor(file, await readFile(join(dir, file), "utf8")));
  }
  return docs;
}

export function runProcess(command, argv, { env, cwd, input, timeoutMs = 0, onLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let stdout = "";
    let stderr = "";
    const take = (buf, chunk, stream) => {
      const text = buf + chunk.toString();
      const lines = text.split("\n");
      const rest = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 0) onLine?.(line, stream);
      }
      return rest;
    };
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      out += text;
      stdout = take(stdout, text, "stdout");
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      err += text;
      stderr = take(stderr, text, "stderr");
    });
    const timer = timeoutMs > 0 ? setTimeout(() => child.kill(), timeoutMs) : null;
    if (input) child.stdin.end(input);
    else child.stdin.end();
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, out, err: err || error.message });
    });
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      if (stdout.length > 0) onLine?.(stdout, "stdout");
      if (stderr.length > 0) onLine?.(stderr, "stderr");
      resolve({ code: code ?? 1, out, err });
    });
  });
}

export async function probeOne(doc, run = runProcess) {
  try {
    const result = await run(doc.command, doc.probe, { timeoutMs: 8000 });
    const text = `${result.out ?? ""}${result.err ?? ""}`;
    const ready = result.code === 0 && text.includes(doc.expect);
    return { id: doc.id, command: doc.command, ready, reason: ready ? "ok" : "probe failed" };
  } catch (error) {
    return { id: doc.id, command: doc.command, ready: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function discoverHarnesses(root = repoRoot(), run = runProcess) {
  const dir = join(root, "work/harnesses");
  let files = [];
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const found = [];
  for (const file of files) {
    try {
      const doc = parseDescriptor(file, await readFile(join(dir, file), "utf8"));
      found.push(await probeOne(doc, run));
    } catch (error) {
      found.push({ id: file.replace(/\.json$/, ""), ready: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return found;
}
