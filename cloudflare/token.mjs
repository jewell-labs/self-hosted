import { keychainStatus, storeSecret } from "./keychain.mjs";

const update = "cloudflare-token";

function write(body, code) {
  process.stdout.write(`${JSON.stringify(body)}\n`);
  process.exit(code);
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      resolve(null);
      return;
    }
    process.stderr.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = "";
    const onData = (buf) => {
      const text = buf.toString("utf8");
      for (const ch of text) {
        if (ch === "\u0003") {
          cleanup();
          reject(Object.assign(new Error("cancelled"), { reason: "cancelled" }));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          process.stderr.write("\n");
          cleanup();
          resolve(value);
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (ch === "\u001b") continue;
        value += ch;
      }
    };
    function cleanup() {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
    }
    process.stdin.on("data", onData);
  });
}

if (!process.stdin.isTTY) {
  write({ stored: false, reason: "needs-user", update }, 1);
}

try {
  const secret = await readHidden("Cloudflare API token (not echoed): ");
  const saved = await storeSecret(secret, process.env);
  const status = await keychainStatus(process.env);
  const body = { stored: saved.stored === true, usable: status.usable, state: status.state, update };
  if (!saved.stored) body.reason = saved.reason;
  write(body, saved.stored ? 0 : 1);
} catch (error) {
  write({ stored: false, reason: error.reason === "cancelled" ? "cancelled" : "prompt-failed", update }, 1);
}
