import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function b64url(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString("base64url");
}

function startServer(root, env) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, ["mcp/server.mjs"], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`server did not listen\n${buf}\n${err}`));
    }, 8_000);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const line = buf.split("\n").find((item) => item.startsWith("{"));
      if (!line || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, info: JSON.parse(line) });
    });
    child.on("exit", (code) => fail(new Error(`server exited ${code}: ${buf} ${err}`)));
  });
}

async function post(port, body, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

export async function proveAccess(root) {
  const dir = await mkdtemp(join(tmpdir(), "selfhost-access-"));
  try {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" });
    jwk.kid = "proof";
    jwk.alg = "RS256";
    jwk.use = "sig";
    const jwksPath = join(dir, "jwks.json");
    await writeFile(jwksPath, JSON.stringify({ keys: [jwk] }));
    const gated = await startServer(root, {
      PORT: "0",
      BIND_HOST: "127.0.0.1",
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUD: "proof-aud",
      SELFHOST_ACCESS_JWKS_FILE: jwksPath,
    });
    try {
      const denied = await post(gated.info.port, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      if (denied.status !== 401) throw new Error(`expected 401 without jwt, got ${denied.status}`);
      const header = b64url(JSON.stringify({ alg: "RS256", kid: "proof", typ: "JWT" }));
      const body = b64url(JSON.stringify({
        iss: "https://team.cloudflareaccess.com",
        aud: "proof-aud",
        exp: Math.floor(Date.now() / 1000) + 600,
        sub: "proof",
      }));
      const sig = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey).toString("base64url");
      const allowed = await post(
        gated.info.port,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "discover", arguments: {} } },
        { "cf-access-jwt-assertion": `${header}.${body}.${sig}` },
      );
      if (allowed.status !== 200) throw new Error(`expected 200 with jwt, got ${allowed.status}`);
    } finally {
      gated.child.kill();
    }
    const refused = spawn(process.execPath, ["mcp/server.mjs"], {
      cwd: root,
      env: { ...process.env, BIND_HOST: "0.0.0.0", PORT: "0", CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "" },
    });
    const code = await new Promise((resolve) => refused.on("exit", resolve));
    if (code === 0) throw new Error("non-loopback bind without access was accepted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
