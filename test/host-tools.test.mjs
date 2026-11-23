import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { callTool } from "../lib/mesh.mjs";
import { bridgeAddress } from "../portless/forward.mjs";
import { dnsLabel, localDevHost, localDevUrl, prefixFor, urlLines } from "../portless/host.mjs";

function env(extra = {}) {
  return {
    ...process.env,
    ...extra,
    CF_ACCESS_TEAM_DOMAIN: "",
    CF_ACCESS_AUD: "",
    ALLOW_PUBLIC_REPO_RUNNER: "",
    GHREF_REF: extra.GHREF_REF ?? join(tmpdir(), "mesh-empty-host"),
  };
}

test("portless names checkouts without sharing a bare host", () => {
  assert.equal(dnsLabel("Hello World"), "hello-world");
  assert.equal(prefixFor({ linked: true, branch: "task/112-slug", directory: "flagseeker", path: "/anywhere" }), "task-112-slug");
  const left = prefixFor({ linked: false, branch: "main", directory: "app", path: "/a/app" });
  const right = prefixFor({ linked: false, branch: "main", directory: "app", path: "/b/app" });
  assert.notEqual(left, right);
  assert.equal(localDevHost("task.app.localhost"), true);
  assert.equal(localDevHost("evil.com"), false);
  assert.equal(localDevHost("foo.local"), false);
  assert.equal(localDevUrl("https://evil.com"), null);
  assert.match(localDevUrl("https://main.app.localhost/path"), /^https:\/\/main\.app\.localhost\/path$/);
  const lines = urlLines("main", ["app", "docs"], "192.168.64.1");
  assert.equal(lines[0], "app https://main.app.localhost");
  assert.equal(lines[2], "guest https://main.app.localhost:8443");
  assert.match(lines[3], /MAP main\.docs\.localhost 192\.168\.64\.1/);
  assert.equal(urlLines("main", ["app"], null).at(-1), "guest down");
  assert.equal(bridgeAddress({ en0: [{ family: "IPv4", internal: false, address: "10.0.0.8" }] }), null);
  assert.equal(bridgeAddress({ bridge100: [{ family: "IPv4", internal: false, address: "192.168.64.1" }] }), "192.168.64.1");
});

test("simulator and portless tools stay inside the detected set and local URLs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sims-"));
  const state = await mkdtemp(join(tmpdir(), "sims-state-"));
  const fixture = join(dir, "simctl.json");
  const udid = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
  await writeFile(fixture, JSON.stringify({
    devices: {
      "iOS-18-0": [
        { udid, name: "iPhone 16", state: "Shutdown", isAvailable: true },
        { udid: "BBBBBBBB-BBBB-CCCC-DDDD-EEEEEEEEEEEE", name: "hidden", state: "Shutdown", isAvailable: false },
      ],
    },
  }));
  const base = env({ SELFHOST_STATE: state, SELFHOST_SIMCTL_FILE: fixture, GHREF_REF: dir });
  try {
    const listed = await callTool("simulators.list", {}, base);
    const body = JSON.parse(listed.content[0].text);
    assert.deepEqual(body.available.map((device) => device.udid), [udid]);
    await assert.rejects(() => callTool("simulators.boot", { udid }, base), /jwt/);
    const blocked = await callTool("simulators.openurl", { udid, url: "https://evil.com" }, base, { jwtVerified: true });
    assert.equal(blocked.isError, true);
    assert.match(blocked.content[0].text, /local/);
    const urls = await callTool("portless.urls", { services: ["app", "docs"], prefix: "main" }, base);
    assert.equal(urls.isError, false);
    assert.match(urls.content[0].text, /main\.app\.localhost/);
    const status = await callTool("portless.status", {}, base);
    const parsed = JSON.parse(status.content[0].text);
    assert.equal(parsed.version, "0.18.1");
    assert.equal(parsed.guestPort, 8443);
    assert.equal(parsed.proxy, "https");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
});
