import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fetchJwks, verifyAccessJwt } from "../lib/access.mjs";

function b64url(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString("base64url");
}

test("accepts a Cloudflare Access shaped RS256 jwt and rejects a bad audience", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "k1";
  const dir = await mkdtemp(join(tmpdir(), "access-"));
  const jwks = join(dir, "jwks.json");
  await writeFile(jwks, JSON.stringify({ keys: [jwk] }));
  const env = { SELFHOST_ACCESS_JWKS_FILE: jwks };
  const config = { required: true, teamDomain: "team.cloudflareaccess.com", aud: "app-aud", jwksFile: jwks };
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const goodBody = b64url(JSON.stringify({
    iss: "https://team.cloudflareaccess.com",
    aud: "app-aud",
    exp: Math.floor(Date.now() / 1000) + 300,
  }));
  const good = `${header}.${goodBody}.${sign("RSA-SHA256", Buffer.from(`${header}.${goodBody}`), privateKey).toString("base64url")}`;
  const payload = await verifyAccessJwt(good, config, env);
  assert.equal(payload.aud, "app-aud");
  const badBody = b64url(JSON.stringify({
    iss: "https://team.cloudflareaccess.com",
    aud: "other",
    exp: Math.floor(Date.now() / 1000) + 300,
  }));
  const bad = `${header}.${badBody}.${sign("RSA-SHA256", Buffer.from(`${header}.${badBody}`), privateKey).toString("base64url")}`;
  await assert.rejects(() => verifyAccessJwt(bad, config, env), /aud/);
  await rm(dir, { recursive: true, force: true });
});

test("caches a jwks file so a later verify does not reread it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "access-cache-"));
  const jwks = join(dir, "jwks.json");
  await writeFile(jwks, JSON.stringify({ keys: [{ kid: "cached" }] }));
  const env = { SELFHOST_ACCESS_JWKS_FILE: jwks };
  const first = await fetchJwks("https://team.cloudflareaccess.com/cdn-cgi/access/certs", env);
  await rm(dir, { recursive: true, force: true });
  const second = await fetchJwks("https://team.cloudflareaccess.com/cdn-cgi/access/certs", env);
  assert.equal(second.keys[0].kid, "cached");
  assert.equal(first, second);
});
