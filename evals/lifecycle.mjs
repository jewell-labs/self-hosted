import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listPackages, repoRootFromHere } from "../core/lib/lifecycle.mjs";
import { containerEnv } from "../core/lib/paths.mjs";

const root = repoRootFromHere();
const llamaUrl = (process.env.LLM_URL ?? process.env.LLAMA_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const image = process.env.PROOF_IMAGE ?? "docker.io/library/node:22-bookworm";
const name = "selfhost-lifecycle";

function failLaunch(message) {
  console.error("eval launch failed:");
  console.error(message);
  process.exit(1);
}

function findContainer() {
  if (process.env.CONTAINER_BIN) return process.env.CONTAINER_BIN;
  const which = spawnSync("/bin/sh", ["-c", "command -v container"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  if (existsSync("/opt/homebrew/bin/container")) return "/opt/homebrew/bin/container";
  return "";
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: containerEnv({ ...process.env, CONTAINER_APP_ROOT: "" }) });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("exit", (code) => resolve({ code: code ?? 1, out, err }));
    child.on("error", (error) => reject(error));
  });
}

async function exec(containerBin, args) {
  const result = await run(containerBin, ["exec", name, ...args]);
  if (result.code !== 0) {
    throw new Error(result.err.trim() || result.out.trim() || `exit ${result.code}`);
  }
  return result.out;
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("model did not return JSON");
  return JSON.parse(text.slice(start, end + 1));
}

async function ask(model, agents, phrase) {
  const response = await fetch(`${llamaUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: "system", content: agents },
        { role: "user", content: phrase },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`llama ${response.status}`);
  const parsed = JSON.parse(body);
  return extractJson(parsed.choices?.[0]?.message?.content ?? "");
}

const containerBin = findContainer();
if (!containerBin) failLaunch("container runtime not found");

let model = process.env.LLM_MODEL ?? process.env.LLAMA_MODEL ?? "";
try {
  const health = await fetch(`${llamaUrl}/health`, { signal: AbortSignal.timeout(5000) });
  if (!health.ok) failLaunch(`llama health ${health.status}`);
  if (!model) {
    const listed = await fetch(`${llamaUrl}/v1/models`, { signal: AbortSignal.timeout(5000) });
    if (!listed.ok) failLaunch(`llama models ${listed.status}`);
    const body = await listed.json();
    const rows = body.data ?? body.models ?? [];
    const ids = rows.map((row) => typeof row === "string" ? row : row?.id ?? row?.name ?? "").filter(Boolean);
    const ordered = [...ids.filter((id) => /micro/i.test(id)), ...ids.filter((id) => !/micro/i.test(id))];
    let reason = "llama models returned no id";
    for (const id of ordered) {
      const probe = await fetch(`${llamaUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: id, temperature: 0, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
        signal: AbortSignal.timeout(180000),
      });
      await probe.arrayBuffer();
      if (probe.status === 501) {
        reason = `${id} does not generate text`;
        continue;
      }
      if (!probe.ok) {
        reason = `${id} ${probe.status}`;
        continue;
      }
      model = id;
      break;
    }
    if (!model) failLaunch(reason);
  }
} catch (error) {
  if (error?.code === "ERR_LAUNCH") throw error;
  failLaunch(error instanceof Error ? error.message : String(error));
}

let failed = false;
let started = false;
try {
  await run(containerBin, ["delete", "--force", name]);
  started = true;
  const created = await run(containerBin, [
    "run", "-d", "--name", name, "--workdir", "/work",
    "--cpus", "2", "--memory", "2G",
    "--entrypoint", "sleep",
    "--mount", `type=bind,source=${root},target=/work`,
    image, "infinity",
  ]);
  if (created.code !== 0) failLaunch(`${created.out}${created.err}`.trim());
  console.log(`model ${model}`);
  for (const id of listPackages(root)) {
    const agents = readFileSync(join(root, id, "AGENTS.md"), "utf8");
    const expectedSetup = `node ${id}/setup.mjs`;
    const expectedDown = `node ${id}/teardown.mjs`;
    let setupCommand = "";
    for (let attempt = 1; attempt <= 2 && setupCommand !== expectedSetup; attempt += 1) {
      try {
        const answer = await ask(model, agents, "set yourself up");
        setupCommand = answer.command ?? "";
      } catch (error) {
        setupCommand = "";
        if (attempt === 2) setupCommand = error instanceof Error ? error.message : "";
      }
    }
    if (setupCommand !== expectedSetup) {
      console.log(`plugin ${id} setup=fail teardown=fail bytes=unknown`);
      failed = true;
      continue;
    }
    const payload = `/tmp/selfhost-home/${id}/assets/payload`;
    const marker = `keep-${id}`;
    try {
      await exec(containerBin, ["node", "-e", `const fs=require("node:fs"); const path=${JSON.stringify(payload)}; fs.mkdirSync(require("node:path").dirname(path),{recursive:true}); fs.writeFileSync(path, ${JSON.stringify(marker)});`]);
      const before = await exec(containerBin, ["node", "-e", `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(payload)}))`]);
      await exec(containerBin, ["env", "SELFHOST_HOME=/tmp/selfhost-home", "SELFHOST_ROOT=/work", "node", `/work/${id}/setup.mjs`]);
      const log = await exec(containerBin, ["node", "-e", `process.stdout.write(require("node:fs").readFileSync("/tmp/selfhost-home/logs/events.jsonl","utf8"))`]);
      const healthy = log.trim().split("\n").map((line) => JSON.parse(line)).some((event) => event.plugin === id && event.type === "healthcheck" && event.name === "healthcheck" && event.detail === "ok");
      if (!healthy) throw new Error("healthcheck missing");
      let downCommand = "";
      for (let attempt = 1; attempt <= 2 && downCommand !== expectedDown; attempt += 1) {
        try {
          const answer = await ask(model, agents, "tear yourself down");
          downCommand = answer.command ?? "";
        } catch (error) {
          downCommand = "";
          if (attempt === 2) downCommand = error instanceof Error ? error.message : "";
        }
      }
      if (downCommand !== expectedDown) throw new Error("teardown command");
      const downOut = await exec(containerBin, ["env", "SELFHOST_HOME=/tmp/selfhost-home", "SELFHOST_ROOT=/work", "node", `/work/${id}/teardown.mjs`]);
      const ended = JSON.parse(downOut.trim().split("\n").pop());
      const after = await exec(containerBin, ["node", "-e", `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(payload)}))`]);
      const same = before === marker && after === marker && ended.status === "down" && ended.healthcheck === "down";
      if (!same) throw new Error(`status ${ended.status} bytes ${after === marker ? "same" : "changed"}`);
      console.log(`plugin ${id} setup=ok teardown=down bytes=same`);
    } catch (error) {
      console.log(`plugin ${id} setup=fail teardown=fail bytes=unknown`);
      console.error(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      failed = true;
    }
  }
} catch (error) {
  if (!started) failLaunch(error instanceof Error ? error.message : String(error));
  throw error;
} finally {
  if (started) await run(containerBin, ["delete", "--force", name]);
}
if (failed) process.exit(1);
console.log("lifecycle eval ok");
