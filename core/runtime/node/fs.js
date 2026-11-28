import { Buffer, toBytes } from "./buffer.js";
import { check, cString, io, ioError, textBuf } from "./syncio.js";

function stats(text) {
  const [kind, mode, size, mtime] = text.trim().split(" ");
  return {
    mode: Number(mode),
    size: Number(size),
    mtimeMs: Number(mtime),
    isFile() { return kind === "f"; },
    isDirectory() { return kind === "d"; },
    isSymbolicLink() { return kind === "l"; },
  };
}

function readStat(path, follow) {
  const buf = textBuf(256);
  const rc = follow ? io.sh_stat_text(path, buf, buf.length) : io.sh_lstat_text(path, buf, buf.length);
  check(rc, path);
  return stats(cString(buf));
}

export function lstatSync(path) {
  return readStat(String(path), false);
}

export function statSync(path) {
  return readStat(String(path), true);
}

export function existsSync(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function encodingOf(options) {
  if (typeof options === "string") return options;
  if (options && typeof options.encoding === "string") return options.encoding;
  return null;
}

export function readFileSync(path, options) {
  const file = String(path);
  const chunks = [];
  let offset = 0n;
  for (;;) {
    const buf = new Uint8Array(1024 * 1024);
    const hi = Number(offset >> 32n);
    const lo = Number(offset & 0xffffffffn);
    const rc = io.sh_read_at(file, buf, buf.length, hi, lo);
    check(rc, file);
    if (rc === 0) break;
    chunks.push(buf.subarray(0, rc));
    offset += BigInt(rc);
  }
  const data = Buffer.concat(chunks);
  const encoding = encodingOf(options);
  return encoding ? data.toString(encoding) : data;
}

function writeFlags(options) {
  const flag = typeof options === "object" && options ? options.flag : "";
  if (flag === "a") return 1;
  if (flag === "wx") return 2;
  return 0;
}

export function writeFileSync(path, data, options) {
  const file = String(path);
  const bytes = toBytes(data ?? "");
  const payload = bytes.length === 0 ? new Uint8Array(1) : bytes;
  check(io.sh_write(file, payload, bytes.length, writeFlags(options)), file);
  const mode = typeof options === "object" && options ? options.mode : undefined;
  if (typeof mode === "number") check(io.sh_chmod(file, mode), file);
}

export function chmodSync(path, mode) {
  const file = String(path);
  check(io.sh_chmod(file, Number(mode)), file);
}

export function appendFileSync(path, data) {
  writeFileSync(path, data, { flag: "a" });
}

export function mkdirSync(path, options = {}) {
  const file = String(path);
  if (options.recursive) {
    check(io.sh_mkdir_p(file), file);
    return;
  }
  check(io.sh_mkdir(file, 0o777), file);
}

export function unlinkSync(path) {
  check(io.sh_unlink(String(path)), String(path));
}

export function rmSync(path, options = {}) {
  const file = String(path);
  const rc = options.recursive ? io.sh_rm_rf(file) : io.sh_unlink(file);
  if (rc < 0 && options.force && io.sh_errname(-rc) === "ENOENT") return;
  check(rc, file);
}

export function renameSync(from, to) {
  check(io.sh_rename(String(from), String(to)), String(from));
}

export function linkSync(from, to) {
  check(io.sh_link(String(from), String(to)), String(from));
}

export function symlinkSync(target, path) {
  check(io.sh_symlink(String(target), String(path)), String(path));
}

export function readlinkSync(path) {
  const buf = textBuf(4096);
  const rc = io.sh_readlink(String(path), buf, buf.length);
  check(rc, String(path));
  return cString(buf, rc);
}

export function realpathSync(path) {
  const buf = textBuf(8192);
  check(io.sh_realpath(String(path), buf, buf.length), String(path));
  return cString(buf);
}

class Dirent {
  constructor(name, kind) {
    this.name = name;
    this.kind = kind;
  }
  isFile() { return this.kind === "f"; }
  isDirectory() { return this.kind === "d"; }
  isSymbolicLink() { return this.kind === "l"; }
}

function readDir(path) {
  const file = String(path);
  const need = io.sh_readdir_size(file);
  check(need, file);
  if (need === 0) return [];
  const buf = new Uint8Array(need);
  const rc = io.sh_readdir(file, buf, buf.length);
  check(rc, file);
  const entries = [];
  let offset = 0;
  while (offset < rc) {
    const kind = String.fromCharCode(buf[offset]);
    offset += 1;
    let end = offset;
    while (end < rc && buf[end] !== 0) end += 1;
    entries.push(new Dirent(new TextDecoder().decode(buf.subarray(offset, end)), kind));
    offset = end + 1;
  }
  return entries;
}

export function readdirSync(path, options = {}) {
  const entries = readDir(path);
  if (options.withFileTypes) return entries;
  return entries.map((entry) => entry.name);
}

export function openSync(path, flag) {
  if (flag !== "wx") throw Object.assign(new Error(`open flag ${flag}`), { code: "EINVAL" });
  const fd = io.sh_open_excl(String(path));
  if (fd < 0) throw ioError(fd, String(path));
  return fd;
}

export function closeSync(fd) {
  check(io.sh_close(fd));
}

export function mkdtempSync(prefix) {
  const buf = textBuf(4096);
  check(io.sh_mkdtemp(String(prefix), buf, buf.length), String(prefix));
  return cString(buf);
}

export function statfsSync(path) {
  const buf = textBuf(256);
  check(io.sh_statfs_text(String(path), buf, buf.length), String(path));
  const [bsize, blocks, bfree, bavail] = cString(buf).trim().split(" ").map(Number);
  return { bsize, blocks, bfree, bavail };
}

function promise(fn) {
  return (...args) => {
    try {
      return Promise.resolve(fn(...args));
    } catch (error) {
      return Promise.reject(error);
    }
  };
}

export const promises = {
  readFile: promise(readFileSync),
  writeFile: promise(writeFileSync),
  appendFile: promise(appendFileSync),
  mkdir: promise(mkdirSync),
  readdir: promise(readdirSync),
  rm: promise(rmSync),
  lstat: promise(lstatSync),
  stat: promise(statSync),
  statfs: promise(statfsSync),
  link: promise(linkSync),
  realpath: promise(realpathSync),
  readlink: promise(readlinkSync),
  rename: promise(renameSync),
  symlink: promise(symlinkSync),
  mkdtemp: promise(mkdtempSync),
  unlink: promise(unlinkSync),
};

export default {
  appendFileSync, closeSync, existsSync, lstatSync, linkSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, statfsSync,
  symlinkSync, unlinkSync, writeFileSync, promises,
};
