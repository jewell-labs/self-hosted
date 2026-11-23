import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { writeSyncInside } from "../lib/jail.mjs";
import { homeDir } from "../lib/paths.mjs";
import { createServer, connect as netConnect } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicy, stateDir } from "./host.mjs";

export function bridgeAddress(ifaces = networkInterfaces()) {
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!name.startsWith("bridge")) continue;
    for (const addr of addrs ?? []) {
      if (String(addr.family) === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

function readInt(file) {
  try {
    const value = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function recordedProxy(dir = stateDir()) {
  const port = readInt(join(dir, "proxy.port"));
  const pid = readInt(join(dir, "proxy.pid"));
  if (port === null || pid === null || port >= 65536) return null;
  return { port, pid };
}

export function tcpOpen(host, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port, timeout: timeoutMs });
    let settled = false;
    const done = (up) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(up);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ensureForward() {
  const address = bridgeAddress();
  const { guestPort } = loadPolicy();
  if (!address) return { address: null, started: false };
  if (await tcpOpen(address, guestPort)) return { address, started: false };
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
  for (let i = 0; i < 20; i++) {
    if (await tcpOpen(address, guestPort)) return { address, started: true };
    await sleep(50);
  }
  return { address: null, started: false };
}

function serve() {
  const address = bridgeAddress();
  if (!address) return;
  const { guestPort } = loadPolicy();
  const server = createServer((socket) => {
    const proxy = recordedProxy();
    const upstream = netConnect({ host: "127.0.0.1", port: proxy?.port ?? 443 });
    socket.pipe(upstream);
    upstream.pipe(socket);
    const close = () => {
      socket.destroy();
      upstream.destroy();
    };
    socket.on("error", close);
    upstream.on("error", close);
    socket.on("close", () => upstream.destroy());
  });
  server.on("error", (error) => process.exit(error.code === "EADDRINUSE" ? 0 : 1));
  server.listen(guestPort, address, () => {
    try {
      writeSyncInside(homeDir(), join(stateDir(), "guest-forward.pid"), String(process.pid));
    } catch {
      // The listener is up. The pid file is only a marker.
    }
  });
}

if (process.argv[1]?.endsWith("forward.mjs") && process.argv[2] === "serve") serve();
