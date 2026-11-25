import { dlopen } from "tjs:ffi";

const defs = {
  sh_errname: { args: ["i32"], returns: "string" },
  sh_sleep_ms: { args: ["i32"], returns: "i32" },
  sh_isatty: { args: ["i32"], returns: "i32" },
  sh_write_fd: { args: ["i32", "buffer", "i32"], returns: "i32" },
  sh_read_at: { args: ["string", "buffer", "i32", "i32", "i32"], returns: "i32" },
  sh_write: { args: ["string", "buffer", "i32", "i32"], returns: "i32" },
  sh_chmod: { args: ["string", "i32"], returns: "i32" },
  sh_mkdir: { args: ["string", "i32"], returns: "i32" },
  sh_mkdir_p: { args: ["string"], returns: "i32" },
  sh_unlink: { args: ["string"], returns: "i32" },
  sh_rename: { args: ["string", "string"], returns: "i32" },
  sh_symlink: { args: ["string", "string"], returns: "i32" },
  sh_link: { args: ["string", "string"], returns: "i32" },
  sh_rm_rf: { args: ["string"], returns: "i32" },
  sh_lstat_text: { args: ["string", "buffer", "i32"], returns: "i32" },
  sh_stat_text: { args: ["string", "buffer", "i32"], returns: "i32" },
  sh_realpath: { args: ["string", "buffer", "i32"], returns: "i32" },
  sh_readlink: { args: ["string", "buffer", "i32"], returns: "i32" },
  sh_readdir_size: { args: ["string"], returns: "i32" },
  sh_readdir: { args: ["string", "buffer", "i32"], returns: "i32" },
  sh_open_excl: { args: ["string"], returns: "i32" },
  sh_close: { args: ["i32"], returns: "i32" },
  sh_mkdtemp: { args: ["string", "buffer", "i32"], returns: "i32" },
  sh_getcwd: { args: ["buffer", "i32"], returns: "i32" },
  sh_hostname: { args: ["buffer", "i32"], returns: "i32" },
  sh_ncpu: { args: [], returns: "i32" },
  sh_uname: { args: ["buffer", "i32"], returns: "i32" },
  sh_mem_text: { args: ["buffer", "i32"], returns: "i32" },
  sh_statfs_text: { args: ["string", "buffer", "i32"], returns: "i32" },
  sh_ifaddrs: { args: ["buffer", "i32"], returns: "i32" },
  sh_spawn: { args: ["string", "buffer", "buffer", "string", "i32", "string", "string", "i32", "buffer", "i32"], returns: "i32" },
  sh_spawn_detached: { args: ["string", "buffer", "buffer", "string", "buffer", "i32"], returns: "i32" },
};

function filePath(url) {
  return decodeURIComponent(new URL(url).pathname);
}

function candidates() {
  const env = tjs.env ?? {};
  const list = [];
  if (env.SELFHOST_SYNCIO) list.push(env.SELFHOST_SYNCIO);
  const dir = filePath(new URL("..", import.meta.url));
  list.push(`${dir}syncio.dylib`, `${dir}syncio.so`);
  return list;
}

let lib = null;
let loadedFrom = "";
const errors = [];
for (const path of candidates()) {
  try {
    lib = dlopen(path, defs);
    loadedFrom = path;
    break;
  } catch (error) {
    errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (!lib) throw new Error(`syncio\n${errors.join("\n")}`);

export const io = lib.symbols;
export const syncioPath = loadedFrom;

export function ioError(rc, path) {
  const code = io.sh_errname(-rc) || "EIO";
  const error = new Error(`${code}${path ? `: ${path}` : ""}`);
  error.code = code;
  error.path = path;
  return error;
}

export function check(rc, path) {
  if (rc < 0) throw ioError(rc, path);
  return rc;
}

const decoder = new TextDecoder();

export function textBuf(size = 4096) {
  return new Uint8Array(size);
}

export function cString(buf, length = buf.length) {
  let end = 0;
  const cap = Math.min(length, buf.length);
  while (end < cap && buf[end] !== 0) end += 1;
  return decoder.decode(buf.subarray(0, end));
}

export function sleepSync(ms) {
  check(io.sh_sleep_ms(ms | 0));
}
