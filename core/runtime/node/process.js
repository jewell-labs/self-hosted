import { arch, platform } from "./os.js";
import { check, cString, io, textBuf } from "./syncio.js";

const encoder = new TextEncoder();

function stream(fd) {
  return {
    fd,
    isTTY: io.sh_isatty(fd) === 1,
    write(chunk) {
      const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      const payload = bytes.length === 0 ? new Uint8Array(1) : bytes;
      check(io.sh_write_fd(fd, payload, bytes.length));
      return true;
    },
  };
}

const env = {};
for (const [key, value] of Object.entries(tjs.env ?? {})) env[key] = value;

export const stdin = stream(0);
export const stdout = stream(1);
export const stderr = stream(2);

export const process = {
  env,
  stdin,
  stdout,
  stderr,
  argv: [tjs.exePath],
  execPath: tjs.exePath,
  pid: tjs.pid,
  ppid: tjs.ppid,
  platform: platform(),
  arch: arch(),
  exit(code = 0) {
    tjs.exit(code);
  },
  cwd() {
    const buf = textBuf(8192);
    check(io.sh_getcwd(buf, buf.length));
    return cString(buf);
  },
  chdir(dir) {
    tjs.chdir(dir);
  },
};

export function initArgv(script, rest) {
  process.argv = [tjs.exePath, script, ...rest];
  process.execPath = tjs.exePath;
}

export default process;
