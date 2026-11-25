import { check, cString, io, textBuf } from "./syncio.js";

function uname() {
  const buf = textBuf(256);
  check(io.sh_uname(buf, buf.length));
  const [sysname, machine] = cString(buf).split(" ");
  const system = sysname === "Darwin" ? "darwin" : sysname === "Linux" ? "linux" : sysname.toLowerCase();
  let arch = machine;
  if (machine === "aarch64" || machine === "arm64") arch = "arm64";
  if (machine === "x86_64") arch = "x64";
  return { system, arch };
}

const name = uname();

export function platform() {
  return name.system;
}

export function arch() {
  return name.arch;
}

export function hostname() {
  const buf = textBuf(256);
  check(io.sh_hostname(buf, buf.length));
  return cString(buf);
}

export function cpus() {
  const count = io.sh_ncpu();
  return Array.from({ length: count > 0 ? count : 1 }, () => ({}));
}

function memory() {
  const buf = textBuf(128);
  check(io.sh_mem_text(buf, buf.length));
  const [total, free] = cString(buf).trim().split(" ").map(Number);
  return { total, free };
}

export function totalmem() {
  return memory().total;
}

export function freemem() {
  return memory().free;
}

export function homedir() {
  return globalThis.process?.env?.HOME || tjs.homeDir || "/";
}

export function tmpdir() {
  return globalThis.process?.env?.TMPDIR || "/tmp";
}

export function networkInterfaces() {
  const buf = textBuf(65536);
  const rc = io.sh_ifaddrs(buf, buf.length);
  check(rc);
  const map = {};
  for (const line of cString(buf, rc).split("\n")) {
    if (!line) continue;
    const [name, address, internal] = line.split("\t");
    const row = { address, family: "IPv4", internal: internal === "1" };
    map[name] = map[name] ?? [];
    map[name].push(row);
  }
  return map;
}

export default { platform, arch, hostname, cpus, totalmem, freemem, homedir, tmpdir, networkInterfaces };
