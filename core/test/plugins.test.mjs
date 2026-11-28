import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { packageIds, pluginFindings } from "../lib/plugins.mjs";
import { uninstallPlugin } from "../lib/uninstall.mjs";
import { repoRootFromHere } from "../lib/lifecycle.mjs";

const repo = repoRootFromHere();

const MANIFEST = {
  id: "sample",
  summary: "A sample package.",
  proofRequired: false,
  match: { os: ["darwin", "linux"], arch: ["arm64", "x64"] },
  assets: [{ path: "assets", scope: "home", kind: "payload" }],
  events: [{ type: "healthcheck", name: "healthcheck" }],
};

const EVENT = {
  schema: "jewell-labs.self-hosted.event.v1",
  plugin: "sample",
  events: [{ type: "healthcheck", name: "healthcheck" }],
};

const CLEANUP = { schema: "jewell-labs.self-hosted.cleanup.v1", keep: ["models"] };

async function writePackage(root, id, doc = MANIFEST, cleanup = CLEANUP) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  const body = { ...doc, id };
  await writeFile(join(dir, "plugin.json"), `${JSON.stringify(body, null, 2)}\n`);
  await writeFile(join(dir, "event.json"), `${JSON.stringify({ ...EVENT, plugin: id }, null, 2)}\n`);
  await writeFile(join(dir, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`);
  await writeFile(join(dir, "README.md"), `# ${id}\n`);
  await writeFile(join(dir, "AGENTS.md"), `# ${id}\n`);
  await writeFile(join(dir, "setup.mjs"), "export {}\n");
  await writeFile(join(dir, "teardown.mjs"), "export {}\n");
  await writeFile(join(dir, "uninstall.mjs"), "export {}\n");
  await writeFile(join(root, "README.md"), "# root\n");
  await writeFile(join(root, "AGENTS.md"), "# agents\n");
}

test("the shipped tree meets the package requirements", () => {
  const findings = pluginFindings(repo);
  assert.deepEqual(findings, [], findings.map((item) => `${item.file} ${item.message}`).join("\n"));
  assert.equal(packageIds(repo).includes("plugins"), false);
  assert.equal(packageIds(repo).includes("catalog"), false);
});

test("a package directory without uninstall.mjs fails the requirement", async () => {
  const root = await mkdtemp(join(tmpdir(), "selfhost-pkg-"));
  try {
    await writePackage(root, "sample");
    assert.deepEqual(pluginFindings(root), []);
    await rm(join(root, "sample", "uninstall.mjs"));
    const findings = pluginFindings(root);
    assert.equal(findings.some((item) => item.file === "sample/uninstall.mjs"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall removes one package home and leaves its keep path and its sibling", async () => {
  const home = await mkdtemp(join(tmpdir(), "selfhost-user-"));
  const store = join(home, ".self-hosted");
  const root = await mkdtemp(join(tmpdir(), "selfhost-repo-"));
  const env = { ...process.env, HOME: home, SELFHOST_HOME: store, SELFHOST_ROOT: root };
  try {
    await writePackage(root, "sample");
    await mkdir(join(store, "sample", "models"), { recursive: true });
    await mkdir(join(store, "sample", "run"), { recursive: true });
    await mkdir(join(store, "other"), { recursive: true });
    await writeFile(join(store, "sample", "models", "weight.bin"), "weights-stay");
    await writeFile(join(store, "sample", "run", "pid"), "1");
    await writeFile(join(store, "other", "marker"), "stay");
    const result = uninstallPlugin("sample", env, root);
    assert.equal(result.status, 0, result.message);
    assert.equal(await readFile(join(store, "sample", "models", "weight.bin"), "utf8"), "weights-stay");
    await assert.rejects(readFile(join(store, "sample", "run", "pid")));
    assert.equal(await readFile(join(store, "other", "marker"), "utf8"), "stay");
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
