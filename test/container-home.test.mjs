import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, lstat, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { containerAppRoot, containerEnv, layout } from "../lib/paths.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));

test("an unmigrated Apple container store stays on the default root", () => {
  const env = { HOME: "/tmp/selfhost-user", SELFHOST_HOME: "/tmp/selfhost-user/.self-hosted" };
  const paths = layout(env);
  const stat = (path) => {
    assert.equal(path, paths.legacy.containers);
    return { isDirectory: () => true, isSymbolicLink: () => false };
  };
  assert.equal(containerAppRoot(env, stat), "");
  assert.equal(containerEnv(env, stat), env);
});

test("a new or linked store uses ~/.self-hosted/containers", () => {
  const env = { HOME: "/tmp/selfhost-user", SELFHOST_HOME: "/tmp/selfhost-user/.self-hosted" };
  const missing = () => {
    const error = new Error("missing");
    error.code = "ENOENT";
    throw error;
  };
  const linked = () => ({ isDirectory: () => false, isSymbolicLink: () => true });
  assert.equal(containerAppRoot(env, missing), layout(env).containers);
  assert.equal(containerEnv(env, missing).CONTAINER_APP_ROOT, layout(env).containers);
  assert.equal(containerAppRoot(env, linked), layout(env).containers);
  const pinned = { ...env, CONTAINER_APP_ROOT: "/elsewhere" };
  assert.equal(containerEnv(pinned, missing).CONTAINER_APP_ROOT, "/elsewhere");
});

test("adopt moves the Apple container store into the home", async () => {
  const home = await mkdtemp(join(tmpdir(), "selfhost-adopt-"));
  const root = join(home, ".self-hosted");
  const legacy = join(home, "Library/Application Support/com.apple.container");
  await mkdir(join(legacy, "images"), { recursive: true });
  await mkdir(join(home, "Library/LaunchAgents"), { recursive: true });
  const marker = join(legacy, "images/node.tar");
  await writeFile(marker, "image");
  try {
    const result = spawnSync(process.execPath, [join(repo, "bin/adopt.mjs")], {
      env: { ...process.env, HOME: home, SELFHOST_HOME: root },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(root, "containers/images/node.tar"), "utf8"), "image");
    assert.equal((await lstat(legacy)).isSymbolicLink(), true);
    assert.equal(await readlink(legacy), join(root, "containers"));
    const again = spawnSync(process.execPath, [join(repo, "bin/adopt.mjs")], {
      env: { ...process.env, HOME: home, SELFHOST_HOME: root },
      encoding: "utf8",
    });
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
