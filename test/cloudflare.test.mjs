import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { callTool } from "../lib/mesh.mjs";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

function base(extra = {}) {
  return {
    ...process.env,
    CF_ACCESS_TEAM_DOMAIN: "",
    CF_ACCESS_AUD: "",
    SELFHOST_ACCESS_JWKS_FILE: "",
    ...extra,
  };
}

test("cloudflare access and auth tools hide file contents", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-home-"));
  const secret = join(home, ".self-hosted", "cloudflare", "access", "client-secret");
  await mkdir(join(home, ".self-hosted", "cloudflare", "access"), { recursive: true });
  await writeFile(secret, "do-not-print-this-secret");
  await chmod(secret, 0o600);
  const env = base({ HOME: home, GHREF_REF: await mkdtemp(join(tmpdir(), "cf-repos-")) });
  try {
    const access = await callTool("cloudflare.access", {}, env);
    const auth = await callTool("cloudflare.auth", {}, env);
    assert.equal(access.isError, false);
    assert.equal(auth.isError, false);
    const accessBody = JSON.parse(access.content[0].text);
    const authBody = JSON.parse(auth.content[0].text);
    assert.equal(accessBody.access.destructiveNeedsJwt, true);
    assert.equal(accessBody.access.required, false);
    assert.equal(authBody.mechanism, "cloudflare-access-service-token");
    assert.equal(authBody.oneSharedServiceToken, true);
    assert.equal(authBody.secretMode, "600");
    assert.equal(authBody.idMode, "absent");
    assert.equal(`${access.content[0].text}${auth.content[0].text}`.includes("do-not-print-this-secret"), false);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(env.GHREF_REF, { recursive: true, force: true });
  }
});

test("cloudflare setup and check prove the access gate", async () => {
  const home = await mkdtemp(join(tmpdir(), "cf-check-"));
  const state = join(home, ".self-hosted", "state");
  await mkdir(state, { recursive: true });
  const env = { ...base({ HOME: home }), SELFHOST_STATE: state };
  const run = (script) => spawnSync(process.execPath, [join(repo, "bin", script), "cloudflare"], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
  try {
    const setup = run("setup.mjs");
    assert.equal(setup.status, 0, setup.stderr);
    const check = run("check.mjs");
    assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
    assert.match(check.stdout, /cloudflare ok/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
