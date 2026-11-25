import { Buffer } from "./buffer.js";
import { mkdtempSync, readFileSync, rmSync } from "./fs.js";
import { check, cString, io, ioError, textBuf } from "./syncio.js";
import { custom } from "./util.js";

const encoder = new TextEncoder();
const SIGNALS = { 1: "SIGHUP", 2: "SIGINT", 9: "SIGKILL", 13: "SIGPIPE", 14: "SIGALRM", 15: "SIGTERM" };

class Emitter {
  constructor() {
    this._events = new Map();
  }
  on(name, fn) {
    const list = this._events.get(name) ?? [];
    list.push(fn);
    this._events.set(name, list);
    return this;
  }
  once(name, fn) {
    const wrap = (...args) => {
      this.off(name, wrap);
      fn(...args);
    };
    return this.on(name, wrap);
  }
  off(name, fn) {
    const list = (this._events.get(name) ?? []).filter((item) => item !== fn);
    this._events.set(name, list);
    return this;
  }
  emit(name, ...args) {
    for (const fn of [...(this._events.get(name) ?? [])]) fn(...args);
  }
}

function pack(list) {
  let total = 1;
  const parts = list.map((item) => encoder.encode(String(item)));
  for (const part of parts) total += part.length + 1;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
    out[offset] = 0;
    offset += 1;
  }
  return out;
}

function packEnv(env) {
  if (!env) return new Uint8Array([0]);
  const rows = [];
  for (const [key, value] of Object.entries(env)) {
    if (value == null) continue;
    rows.push(`${key}=${value}`);
  }
  return rows.length === 0 ? new Uint8Array([0]) : pack(rows);
}

function prepareArgv(command, args) {
  const list = [command, ...(args ?? [])];
  const script = args?.[0];
  const runtime = command === globalThis.process.execPath || String(command).endsWith("/tjs");
  if (runtime && typeof script === "string" && script.endsWith(".mjs") && script !== "run" && args[0] !== "run") {
    const run = globalThis.process.env.SELFHOST_RUN;
    if (!run) throw Object.assign(new Error("SELFHOST_RUN"), { code: "EINVAL" });
    return [command, "run", run, ...args];
  }
  return list;
}

function signalName(number) {
  if (!number) return null;
  return SIGNALS[number] ?? `SIG${number}`;
}

function parseStatus(buf) {
  const [code, signal, pid, timedOut] = cString(buf).trim().split(" ").map(Number);
  return { code, signal, pid, timedOut: timedOut === 1 };
}

function stdioOf(stdio, fallback) {
  if (stdio == null) return fallback;
  if (typeof stdio === "string") return [stdio, stdio, stdio];
  return [0, 1, 2].map((index) => stdio[index] ?? "pipe");
}

function captureMode(stdio) {
  if (stdio.every((slot) => slot === "inherit")) return 0;
  if (stdio.every((slot) => slot === "ignore")) return 2;
  return 1;
}

function runCaptured(command, args, options) {
  const argv = prepareArgv(command, args);
  const stdio = stdioOf(options.stdio, ["pipe", "pipe", "pipe"]);
  const mode = captureMode(stdio);
  const status = textBuf(128);
  const timeout = options.timeout ?? 0;
  const env = packEnv(options.env ?? globalThis.process.env);
  const cwd = options.cwd ?? "";
  let dir = "";
  let outPath = "";
  let errPath = "";
  if (mode === 1) {
    dir = mkdtempSync(`${globalThis.process.env.TMPDIR || "/tmp"}/selfhost-spawn-`);
    outPath = `${dir}/out`;
    errPath = `${dir}/err`;
  }
  const rc = io.sh_spawn(argv[0], pack(argv), env, cwd, mode, outPath, errPath, timeout | 0, status, status.length);
  const parsed = parseStatus(status);
  let stdout = null;
  let stderr = null;
  if (mode === 1) {
    const readOrEmpty = (file) => {
      try { return readFileSync(file); } catch { return Buffer.from([]); }
    };
    const outBytes = readOrEmpty(outPath);
    const errBytes = readOrEmpty(errPath);
    rmSync(dir, { recursive: true, force: true });
    const encoding = options.encoding && options.encoding !== "buffer" ? options.encoding : null;
    stdout = encoding ? outBytes.toString(encoding) : outBytes;
    stderr = encoding ? errBytes.toString(encoding) : errBytes;
    const max = options.maxBuffer;
    if (typeof max === "number" && (outBytes.length > max || errBytes.length > max)) {
      const error = new Error("maxBuffer");
      error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      error.stdout = stdout;
      error.stderr = stderr;
      return { status: parsed.code, signal: signalName(parsed.signal), pid: parsed.pid, stdout, stderr, error };
    }
  }
  if (rc < 0 && io.sh_errname(-rc) !== "ETIMEDOUT") {
    const error = ioError(rc, command);
    return { status: null, signal: null, pid: parsed.pid || undefined, stdout: stdout ?? "", stderr: stderr ?? "", error };
  }
  if (parsed.timedOut || (rc < 0 && io.sh_errname(-rc) === "ETIMEDOUT")) {
    const error = Object.assign(new Error("timeout"), { code: "ETIMEDOUT", killed: true, signal: "SIGKILL" });
    error.stdout = stdout ?? "";
    error.stderr = stderr ?? "";
    return { status: null, signal: "SIGKILL", pid: parsed.pid, stdout: stdout ?? "", stderr: stderr ?? "", error };
  }
  return {
    status: parsed.signal ? null : parsed.code,
    signal: signalName(parsed.signal),
    pid: parsed.pid,
    stdout,
    stderr,
    error: null,
  };
}

export function spawnSync(command, args, options = {}) {
  return runCaptured(command, args ?? [], options);
}

function failed(result, command) {
  if (!result.error && result.status === 0 && !result.signal) return null;
  const error = result.error ?? Object.assign(new Error(`Command failed: ${command}`), { code: result.status ?? result.signal });
  error.stdout = result.stdout ?? "";
  error.stderr = result.stderr ?? "";
  error.status = result.status;
  error.signal = result.signal;
  return error;
}

export function execFileSync(command, args, options = {}) {
  const result = runCaptured(command, args ?? [], { ...options, stdio: ["ignore", "pipe", "pipe"] });
  const error = failed(result, command);
  if (error) throw error;
  return result.stdout ?? "";
}

function takeExec(args, opts, callback) {
  let list = [];
  let options = {};
  let cb = callback;
  if (typeof args === "function") {
    cb = args;
  } else if (Array.isArray(args)) {
    list = args;
    if (typeof opts === "function") cb = opts;
    else if (opts && typeof opts === "object") options = opts;
  } else if (args && typeof args === "object") {
    options = args;
    if (typeof opts === "function") cb = opts;
  }
  if (typeof opts === "function") cb = opts;
  return { list, options, cb };
}

function runAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let timer = null;
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const outBytes = Buffer.concat(stdout);
      const errBytes = Buffer.concat(stderr);
      const encoding = options.encoding && options.encoding !== "buffer" ? options.encoding : null;
      const out = encoding ? outBytes.toString(encoding) : outBytes;
      const err = encoding ? errBytes.toString(encoding) : errBytes;
      const max = options.maxBuffer;
      if (!error && typeof max === "number" && (outBytes.length > max || errBytes.length > max)) {
        error = new Error("maxBuffer");
        error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      }
      if (!error && code !== 0) {
        error = new Error(`Command failed: ${command}`);
        error.code = code ?? "EIO";
      }
      if (error) {
        error.stdout = out;
        error.stderr = err;
        reject(error);
        return;
      }
      resolve({ stdout: out, stderr: err });
    };
    timer = options.timeout ? setTimeout(() => {
      child.kill("SIGKILL");
      const error = new Error("timeout");
      error.code = "ETIMEDOUT";
      error.killed = true;
      finish(error, null);
    }, options.timeout) : null;
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => finish(error, null));
    child.on("exit", (code) => finish(null, code ?? 1));
  });
}

export function execFile(command, args, opts, callback) {
  const { list, options, cb } = takeExec(args, opts, callback);
  const promise = runAsync(command, list, options);
  if (cb) {
    promise.then(
      (result) => cb(null, result.stdout, result.stderr),
      (error) => cb(error, error.stdout ?? "", error.stderr ?? ""),
    );
  }
  return promise;
}

execFile[custom] = (command, args, opts) => {
  const { list, options } = takeExec(args, opts, undefined);
  return runAsync(command, list, options);
};

function toBytes(value) {
  if (value == null) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value;
  return encoder.encode(String(value));
}

function wrapSpawn(proc, stdio) {
  const child = new Emitter();
  child.pid = proc.pid;
  child.stdout = new Emitter();
  child.stderr = new Emitter();
  child.stdin = { end() {} };
  child.kill = (signal = "SIGTERM") => {
    try { proc.kill(signal); } catch (error) { child.emit("error", error); }
  };
  child.unref = () => {};
  if (stdio[0] === "pipe" && proc.stdin?.getWriter) {
    const writer = proc.stdin.getWriter();
    child.stdin.end = (data) => {
      const bytes = toBytes(data);
      writer.write(bytes).then(() => writer.close()).catch((error) => child.emit("error", error));
    };
  }
  const pump = async (stream, emitter) => {
    if (!stream?.getReader) return;
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        emitter.emit("data", Buffer.from(value));
      }
    } catch (error) {
      emitter.emit("error", error);
    }
  };
  const pumps = [];
  if (stdio[1] === "pipe") pumps.push(pump(proc.stdout, child.stdout));
  if (stdio[2] === "pipe") pumps.push(pump(proc.stderr, child.stderr));
  Promise.all([proc.wait(), ...pumps]).then(([status]) => {
    const signaled = status.term_signal && status.term_signal !== 0;
    const code = signaled ? null : (status.exit_status ?? status.exitCode ?? 0);
    child.emit("exit", code);
    child.emit("close", code);
  }).catch((error) => child.emit("error", error));
  return child;
}

export function spawn(command, args, options = {}) {
  let list = args;
  let opts = options;
  if (args && !Array.isArray(args) && typeof args === "object") {
    opts = args;
    list = [];
  }
  const argv = prepareArgv(command, list ?? []);
  const stdio = stdioOf(opts.stdio, ["pipe", "pipe", "pipe"]);
  if (opts.detached) {
    const status = textBuf(128);
    const rc = io.sh_spawn_detached(argv[0], pack(argv), packEnv(opts.env ?? globalThis.process.env), opts.cwd ?? "", status, status.length);
    const child = new Emitter();
    child.stdout = new Emitter();
    child.stderr = new Emitter();
    child.stdin = { end() {} };
    child.unref = () => {};
    child.kill = () => {};
    if (rc < 0) {
      const error = ioError(rc, command);
      queueMicrotask(() => child.emit("error", error));
      return child;
    }
    child.pid = parseStatus(status).pid;
    return child;
  }
  try {
    const spec = {
      stdin: stdio[0],
      stdout: stdio[1],
      stderr: stdio[2],
      env: opts.env ?? globalThis.process.env,
    };
    if (opts.cwd) spec.cwd = opts.cwd;
    return wrapSpawn(tjs.spawn(argv, spec), stdio);
  } catch (error) {
    const child = new Emitter();
    child.stdout = new Emitter();
    child.stderr = new Emitter();
    child.stdin = { end() {} };
    child.kill = () => {};
    child.unref = () => {};
    queueMicrotask(() => child.emit("error", error));
    return child;
  }
}

export default { spawn, spawnSync, execFile, execFileSync };
