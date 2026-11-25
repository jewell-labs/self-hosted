import { readFileSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { stateDir } from "./host.mjs";

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

export async function ensureForward() {
  const address = bridgeAddress();
  if (!address) return { address: null, started: false };
  const proxy = recordedProxy();
  if (!proxy || !(await tcpOpen("127.0.0.1", proxy.port))) return { address: null, started: false };
  return { address, started: false };
}
