import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { adminCall } from "../plugins/cloudflare/admin.mjs";
import { classify, keychainStatus, storeSecret } from "../plugins/cloudflare/keychain.mjs";
import { callTool } from "../lib/mesh.mjs";
import { doctor } from "../lib/doctor.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const token = "cfadmin-test-token-0123456789abcdefghijk";

const securityScript = `#!/bin/sh
set -eu
if [ "\${1:-}" = "find-generic-password" ]; then
  if [ -n "\${SELFHOST_SECURITY_VALUE_FILE:-}" ] && [ -f "$SELFHOST_SECURITY_VALUE_FILE" ]; then
    cat "$SELFHOST_SECURITY_VALUE_FILE"
    printf '\\n'
    exit 0
  fi
  exit 44
fi
if [ "\${1:-}" = "add-generic-password" ]; then
  printf '%s\\n' "$@" > "\${SELFHOST_SECURITY_ARGS_FILE:?}"
  printf 'password data for new item: '
  IFS= read -r first || exit 2
  printf 'retype password for new item: '
  IFS= read -r second || exit 2
  if [ "$first" != "$second" ]; then
    exit 3
  fi
  umask 077
  printf '%s' "$first" > "\${SELFHOST_SECURITY_SINK:?}"
  exit 0
fi
exit 1
`;

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "cf-admin-"));
  const security = join(dir, "security");
  await writeFile(security, securityScript);
  await chmod(security, 0o755);
  const env = {
    ...process.env,
    HOME: dir,
    GHREF_REF: dir,
    SELFHOST_DOCTOR_OFFLINE: "1",
    SELFHOST_SECURITY: security,
    SELFHOST_SECURITY_VALUE_FILE: join(dir, "value"),
    SELFHOST_SECURITY_ARGS_FILE: join(dir, "args"),
    SELFHOST_SECURITY_SINK: join(dir, "sink"),
    SELFHOST_KEYCHAIN_PROMPT: "off",
    SELFHOST_LOG_URL: "",
  };
  return { dir, env };
}

test("keychain state is present or unusable and never includes the secret", async () => {
  assert.equal(classify(token), "usable");
  assert.equal(classify('{"v":1,"key":"envelope-sentinel-value"}'), "envelope");
  assert.equal(classify("a".repeat(37)), "global-key");
  assert.equal(classify("short-token"), "unusable");
  const { dir, env } = await fixture();
  try {
    await writeFile(env.SELFHOST_SECURITY_VALUE_FILE, token);
    const present = await keychainStatus(env);
    assert.equal(present.usable, true);
    assert.equal(present.state, "present");
    assert.equal(present.update, "just cloudflare-token");
    assert.equal(JSON.stringify(present).includes(token), false);
    const viaTool = await callTool("cloudflare.admin", {}, env);
    assert.equal(viaTool.isError, false);
    assert.equal(viaTool.content[0].text.includes(token), false);

    await writeFile(env.SELFHOST_SECURITY_VALUE_FILE, '{"v":1,"key":"envelope-sentinel-value"}');
    const envelope = JSON.parse((await callTool("cloudflare.admin", {}, env)).content[0].text);
    assert.equal(envelope.state, "envelope");
    assert.equal(envelope.usable, false);
    assert.equal(JSON.stringify(envelope).includes("envelope-sentinel-value"), false);

    const report = await doctor(env);
    const finding = report.findings.find((item) => item.id === "cloudflare.admin");
    assert.equal(finding.ok, false);
    assert.equal(finding.detail, "envelope");
    assert.equal(JSON.stringify(report).includes("envelope-sentinel-value"), false);
    assert.equal(JSON.stringify(report).includes(token), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("admin calls use the keychain token and redact it", async () => {
  const { dir, env } = await fixture();
  let fetches = 0;
  try {
    await writeFile(env.SELFHOST_SECURITY_VALUE_FILE, token);
    const result = await adminCall({
      method: "get",
      path: "/client/v4/user/tokens/verify",
      env,
      fetchImpl: async (url, init) => {
        fetches += 1;
        assert.equal(url, "https://api.cloudflare.com/client/v4/user/tokens/verify");
        assert.equal(init.headers.Authorization, `Bearer ${token}`);
        assert.equal(init.redirect, "manual");
        return new Response(JSON.stringify({
          success: true,
          result: { id: "abc", value: token, api_token: token, name: `id ${token} tail` },
        }), { status: 200 });
      },
    });
    assert.equal(fetches, 1);
    assert.equal(result.ok, true);
    assert.equal(result.result.result.value, "[redacted]");
    assert.equal(result.result.result.api_token, "[redacted]");
    assert.equal(result.result.result.name, "id [redacted] tail");
    assert.equal(JSON.stringify(result).includes(token), false);

    const blocked = await adminCall({
      method: "POST",
      path: "/client/v4/user/tokens",
      body: JSON.stringify({ name: token }),
      env,
      fetchImpl: () => {
        fetches += 1;
        throw new Error("fetched");
      },
    });
    assert.equal(blocked.reason, "body");
    assert.equal(fetches, 1);
    assert.equal(JSON.stringify(blocked).includes(token), false);

    const redirect = await adminCall({
      method: "GET",
      path: "/client/v4/zones",
      env,
      fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "https://evil.example/hook" } }),
    });
    assert.equal(redirect.reason, "redirect");
    assert.equal(JSON.stringify(redirect).includes("evil.example"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("apply is jwt gated and the token tool takes no secret argument", async () => {
  const { dir, env } = await fixture();
  try {
    await assert.rejects(
      () => callTool("cloudflare.apply", { method: "GET", path: "/client/v4/user/tokens/verify" }, env),
      /cloudflare access jwt required/,
    );
    await assert.rejects(() => callTool("cloudflare.token", { token }, env), /unexpected argument token/);
    const update = await callTool("cloudflare.token", {}, env);
    assert.equal(update.isError, true);
    assert.match(update.content[0].text, /prompt-disabled/);
    assert.equal(update.content[0].text.includes(token), false);

    await writeFile(env.SELFHOST_SECURITY_VALUE_FILE, token);
    const bad = await callTool("cloudflare.apply", { method: "GET", path: "https://evil.example/client/v4/user" }, env, { jwtVerified: true });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /"reason":"path"/);
    const absent = { ...env };
    await rm(env.SELFHOST_SECURITY_VALUE_FILE);
    const missing = await callTool("cloudflare.apply", { method: "GET", path: "/client/v4/user/tokens/verify" }, absent, { jwtVerified: true });
    assert.match(missing.content[0].text, /"reason":"absent"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("store writes through the keychain prompt and not argv", async () => {
  const { dir, env } = await fixture();
  try {
    const saved = await storeSecret(token, env);
    assert.equal(saved.stored, true);
    const args = await readFile(env.SELFHOST_SECURITY_ARGS_FILE, "utf8");
    assert.equal(args.includes(token), false);
    assert.match(args, /-w\n$/);
    assert.equal(await readFile(env.SELFHOST_SECURITY_SINK, "utf8"), token);
    const rejected = await storeSecret('{"v":1,"key":"envelope-sentinel-value"}', env);
    assert.equal(rejected.stored, false);
    assert.equal(rejected.reason, "envelope");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("token update without a terminal does not prompt", () => {
  const run = spawnSync(process.execPath, [join(repo, "bin/cloudflare-token.mjs")], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /needs-user/);
  assert.doesNotMatch(run.stdout, /token.?:/);
});
