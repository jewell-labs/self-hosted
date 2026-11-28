import { execFile } from "node:child_process";
import { lstat, mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRootFromHere } from "../lib/lifecycle.mjs";

const exec = promisify(execFile);
const repo = repoRootFromHere();

async function assertNoSymlinks(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    assert.equal(entry.isSymbolicLink(), false, path);
    if (entry.isDirectory()) await assertNoSymlinks(path);
  }
}

test("installWrappers writes regular files into the home bin", async () => {
  const home = await mkdtemp(join(tmpdir(), "selfhost-wrap-"));
  const store = join(home, ".self-hosted");
  try {
    const { installWrappers } = await import(pathToFileURL(join(repo, "work/install.mjs")).href);
    const written = await installWrappers({
      ...process.env,
      HOME: home,
      SELFHOST_HOME: store,
      SELFHOST_ROOT: repo,
    });
    assert.equal(written.length > 0, true);
    for (const dest of written) {
      const id = dest.split("/").at(-1);
      const command = join(store, "bin", id);
      const placed = await lstat(command);
      assert.equal(placed.isSymbolicLink(), false, command);
      assert.equal(placed.isFile(), true, command);
      const owned = await lstat(dest);
      assert.equal(owned.isSymbolicLink(), false, dest);
      const text = await readFile(command, "utf8");
      assert.equal(text.includes("work/wrap.mjs"), true);
      assert.equal(text.includes(id), true);
    }
    await assertNoSymlinks(store);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("adopt moves a legacy directory and leaves the old path absent", async () => {
  const home = await mkdtemp(join(tmpdir(), "selfhost-adopt-"));
  const store = join(home, ".self-hosted");
  const legacy = join(home, "local", "models");
  try {
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "payload"), "weights-stay");
    const run = await exec(process.execPath, [join(repo, "core/bin/adopt.mjs")], {
      cwd: repo,
      env: { ...process.env, HOME: home, SELFHOST_HOME: store },
    });
    assert.equal(run.stderr, "");
    await assert.rejects(lstat(legacy));
    assert.equal(await readFile(join(store, "llm", "models", "payload"), "utf8"), "weights-stay");
    const record = JSON.parse(await readFile(join(store, "launchd", "links.json"), "utf8"));
    assert.deepEqual(record.links, []);
    await assertNoSymlinks(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("adopt unlinks a legacy path that already points at the store", async () => {
  const home = await mkdtemp(join(tmpdir(), "selfhost-adopt-link-"));
  const store = join(home, ".self-hosted");
  const dest = join(store, "agent-desktop");
  const legacy = join(home, ".agent-desktop");
  try {
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, "payload"), "sandbox-stay");
    await symlink(dest, legacy);
    const run = await exec(process.execPath, [join(repo, "core/bin/adopt.mjs")], {
      cwd: repo,
      env: { ...process.env, HOME: home, SELFHOST_HOME: store },
    });
    assert.equal(run.stderr, "");
    await assert.rejects(lstat(legacy));
    assert.equal(await readFile(join(dest, "payload"), "utf8"), "sandbox-stay");
    await assertNoSymlinks(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
