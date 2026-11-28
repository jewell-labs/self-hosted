// The proxy listens on the container gateway address only. It never binds 0.0.0.0.
import { execFile as execFileCb } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import { containerEnv } from "../core/lib/paths.mjs";

const execFileAsync = promisify(execFileCb);

export const IMAGE = "node:24.11.1-bookworm-slim";
export const RUN_NAME = "selfhost-evals";
export const ROUTE_NAME = "selfhost-evals-route";
const NAME_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const BODIES = new Set(["ok", "model", "router", "grade", "gateway", "container"]);

export function gatewayFromRoute(text) {
  const lines = String(text ?? "").split(/\n/).map((line) => line.trim()).filter((line) => line !== "");
  for (const line of lines) {
    const cols = line.split(/\s+/);
    if (cols[1] !== "00000000") continue;
    const gateway = cols[2] ?? "";
    if (!/^[0-9a-fA-F]{8}$/.test(gateway) || gateway === "00000000") continue;
    const value = Number.parseInt(gateway, 16);
    return `${value & 255}.${(value >> 8) & 255}.${(value >> 16) & 255}.${(value >> 24) & 255}`;
  }
  return null;
}

export function loopbackPort(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") return null;
  const port = url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

export function rewriteLoopback(value, gateway) {
  const port = loopbackPort(value);
  if (port === null) return String(value ?? "").replace(/\/$/, "");
  if (!gateway) return "";
  const url = new URL(value);
  url.hostname = gateway;
  return url.toString().replace(/\/$/, "");
}

export function alignResults(ids, results) {
  const byId = new Map();
  for (const item of results ?? []) {
    if (!item || typeof item.id !== "string" || !ids.includes(item.id)) continue;
    const detail = item.detail === "ok" ? "ok" : "error";
    const body = BODIES.has(item.body) ? item.body : "container";
    if (detail === "ok" && body !== "ok") continue;
    const row = { id: item.id, detail, body };
    if (Array.isArray(item.failed)) {
      const failed = item.failed.filter((name) => typeof name === "string" && NAME_RE.test(name) && name.length <= 80).slice(0, 16);
      if (failed.length > 0) row.failed = failed;
    }
    byId.set(item.id, row);
  }
  return ids.map((id) => byId.get(id) ?? { id, detail: "error", body: "container" });
}

export function parseEvalOutput(stdout) {
  const lines = String(stdout ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith("{")) continue;
    try {
      const doc = JSON.parse(lines[index]);
      if (doc && Array.isArray(doc.results)) return doc.results;
    } catch {
      // A container progress line is not the result.
    }
  }
  return null;
}

export function listenProxy(host, port) {
  if (host === "0.0.0.0" || host === "::") return Promise.reject(new Error("refusing open bind"));
  const server = net.createServer((socket) => {
    const upstream = net.connect({ host: "127.0.0.1", port });
    const drop = () => {
      socket.destroy();
      upstream.destroy();
    };
    socket.on("error", drop);
    upstream.on("error", drop);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  return new Promise((resolve, reject) => {
    const fail = (error) => {
      server.close();
      reject(error);
    };
    server.once("error", fail);
    server.listen(port, host, () => {
      server.off("error", fail);
      resolve({
        close() {
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

function missed(ids, body) {
  return { isolated: false, results: ids.map((id) => ({ id, detail: "error", body })) };
}

function launchEnv() {
  return containerEnv({ ...process.env, CONTAINER_APP_ROOT: "" });
}

async function run(execImpl, bin, args, timeout) {
  try {
    return await execImpl(bin, args, { timeout, encoding: "utf8", maxBuffer: 1024 * 1024, env: launchEnv() });
  } catch (error) {
    return { stdout: error?.stdout ?? "", stderr: error?.stderr ?? "", failed: true };
  }
}

async function containerBin(spec, execImpl) {
  if (typeof spec.container === "string" && spec.container !== "") return spec.container;
  const found = await run(execImpl, "which", ["container"], 5_000);
  const bin = String(found.stdout ?? "").trim().split("\n")[0];
  return bin || null;
}

export async function runIsolated(spec, opts = {}) {
  const ids = spec.ids;
  const execImpl = opts.execFile ?? execFileAsync;
  const listen = opts.listen ?? listenProxy;
  const bin = await containerBin(spec, execImpl);
  if (!bin) return missed(ids, "container");
  if (typeof spec.root !== "string" || spec.root === "" || spec.root.includes(",") || spec.root.includes("\n")) {
    return missed(ids, "container");
  }
  const ports = [];
  for (const value of [spec.llmUrl, spec.decisionUrl]) {
    const port = loopbackPort(value);
    if (port !== null && !ports.includes(port)) ports.push(port);
  }
  const proxies = [];
  try {
    await run(execImpl, bin, ["rm", "-f", ROUTE_NAME], 15_000);
    await run(execImpl, bin, ["rm", "-f", RUN_NAME], 15_000);
    let gateway = null;
    if (ports.length > 0) {
      const route = await run(execImpl, bin, [
        "run", "--rm", "--name", ROUTE_NAME,
        "--progress", "none",
        "--cpus", "1",
        "--memory", "256M",
        IMAGE,
        "cat", "/proc/net/route",
      ], 60_000);
      gateway = gatewayFromRoute(route.stdout);
      if (!gateway) return missed(ids, "gateway");
      try {
        for (const port of ports) proxies.push(await listen(gateway, port));
      } catch {
        return missed(ids, "gateway");
      }
    }
    const env = {
      HOME: "/tmp",
      SELFHOST_ROOT: "/src",
      SELFHOST_EVAL_IDS: ids.join(","),
      SELFHOST_EVAL_MODEL: spec.model ?? "",
      SELFHOST_EVAL_DECISION_MODEL: spec.decisionModel ?? "",
      SELFHOST_LLM_URL: rewriteLoopback(spec.llmUrl ?? "", gateway),
      SELFHOST_DECISION_URL: rewriteLoopback(spec.decisionUrl ?? "", gateway),
    };
    for (const value of Object.values(env)) {
      if (String(value).includes("\n") || String(value).includes("\0")) return missed(ids, "container");
    }
    const child = await run(execImpl, bin, [
      "run", "--rm", "--name", RUN_NAME,
      "--progress", "none",
      "--cpus", "2",
      "--memory", "1G",
      "--workdir", "/src",
      "--tmpfs", "/tmp",
      ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      "--mount", `type=bind,source=${spec.root},target=/src,readonly`,
      IMAGE,
      "core/bin/selfhost", "evals/cli.mjs",
    ], 180_000);
    const parsed = parseEvalOutput(child.stdout);
    if (!parsed) return missed(ids, "container");
    return { isolated: true, results: alignResults(ids, parsed) };
  } finally {
    for (const proxy of proxies) {
      await proxy.close().catch(() => {});
    }
  }
}
