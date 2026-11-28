import { initArgv, process } from "../runtime/node/process.js";
import { Buffer } from "../runtime/node/buffer.js";
import { dirname, isAbsolute, resolve } from "../runtime/node/path.js";
import { fileURLToPath, pathToFileURL } from "../runtime/node/url.js";

const coreDir = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dirname(coreDir);
const args = tjs.args;
const scriptArg = args[3];
if (!scriptArg) {
  console.error("usage: core/bin/selfhost <script.mjs> [args]");
  tjs.exit(2);
}
globalThis.process = process;
globalThis.Buffer = Buffer;
const script = isAbsolute(scriptArg) ? resolve(scriptArg) : resolve(root, scriptArg);
initArgv(script, args.slice(4));
if (!process.env.SELFHOST_RUN) process.env.SELFHOST_RUN = fileURLToPath(import.meta.url);
if (typeof queueMicrotask !== "function") {
  globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
}
if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

const nodeRoot = pathToFileURL(resolve(coreDir, "runtime/node")).href.replace(/\/$/, "");
tjs.setImportMap({
  imports: {
    "node:fs": `${nodeRoot}/fs.js`,
    "node:fs/promises": `${nodeRoot}/fs-promises.js`,
    "node:path": `${nodeRoot}/path.js`,
    "node:url": `${nodeRoot}/url.js`,
    "node:os": `${nodeRoot}/os.js`,
    "node:crypto": `${nodeRoot}/crypto.js`,
    "node:child_process": `${nodeRoot}/child_process.js`,
    "node:util": `${nodeRoot}/util.js`,
    "node:http": `${nodeRoot}/http.js`,
    "node:net": `${nodeRoot}/net.js`,
    "node:readline": `${nodeRoot}/readline.js`,
    "node:readline/promises": `${nodeRoot}/readline.js`,
    "node:process": `${nodeRoot}/process.js`,
  },
});

await import(pathToFileURL(script).href);
