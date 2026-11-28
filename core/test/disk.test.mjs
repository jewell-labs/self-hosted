import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, diskContext, judge, loadDu, scanRoots } from "../lib/disk.mjs";

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "selfhost-disk-"));
  const shared = join(home, "Shared");
  const env = {
    HOME: home,
    SELFHOST_HOME: join(home, ".self-hosted"),
    SELFHOST_SHARED: shared,
    SELFHOST_DISK_MIN: "100",
  };
  const keep = ["llm/models", "agent-desktop", "containers"];
  const ctx = diskContext(env, keep);
  return {
    home,
    ctx,
    async cleanup() {
      await rm(home, { recursive: true, force: true });
    },
  };
}

test("keep paths are the owned store and a stray directory fails", async () => {
  const fix = await fixture();
  try {
    await mkdir(join(fix.ctx.root, "llm/models/gguf"), { recursive: true });
    await writeFile(join(fix.ctx.root, "llm/models/gguf/weight.gguf"), "weight");
    assert.equal(classify(join(fix.ctx.root, "llm/models"), fix.ctx), "kept");
    assert.equal(classify(join(fix.ctx.root, "llm/models/gguf"), fix.ctx), "kept");
    assert.equal(classify(join(fix.home, "Library/Developer/CoreSimulator"), fix.ctx), "pinned");
    assert.equal(classify(join(fix.home, "Library/Application Support/com.apple.wallpaper"), fix.ctx), "pinned");
    assert.equal(classify(join(fix.home, "Library/Application Support/Google"), fix.ctx), "tool");
    assert.equal(classify(join(fix.home, "Library/Caches/lima"), fix.ctx), "orphan");
    assert.equal(classify(join(fix.home, ".codex"), fix.ctx), "tool");
    assert.equal(classify(join(fix.home, "mystery"), fix.ctx), "");

    const models = join(fix.ctx.root, "llm/models");
    const desktop = join(fix.ctx.root, "agent-desktop");
    const library = join(fix.home, "Library");
    const developer = join(library, "Developer");
    const coresim = join(developer, "CoreSimulator");
    const mystery = join(fix.home, "mystery");
    const sizes = new Map([
      [fix.home, 800],
      [fix.ctx.root, 400],
      [join(fix.ctx.root, "llm"), 250],
      [models, 200],
      [desktop, 50],
      [library, 200],
      [developer, 150],
      [coresim, 150],
      [mystery, 180],
    ]);
    const kids = new Map([
      [fix.home, [fix.ctx.root, library, mystery]],
      [fix.ctx.root, [join(fix.ctx.root, "llm"), desktop]],
      [join(fix.ctx.root, "llm"), [models]],
      [library, [developer]],
      [developer, [coresim]],
    ]);
    const rows = scanRoots(fix.ctx, (path) => sizes.get(path) ?? 0, (path) => kids.get(path) ?? []);
    assert.ok(rows.some((row) => row.class === "kept" && row.path === models));
    assert.ok(rows.some((row) => row.class === "pinned" && row.path === coresim));
    assert.ok(rows.some((row) => row.class === "" && row.path === mystery));
    assert.equal(judge(rows, { inside: 250, outside: 0 }).ok, false);
    const explained = rows.filter((row) => row.class !== "");
    assert.equal(judge(explained, { inside: 250, outside: 0 }).ok, true);
    assert.equal(judge([], { inside: 100, outside: 50 }).ok, false);
    assert.equal(judge([], { inside: 1000, outside: 5 }).ok, true);
  } finally {
    await fix.cleanup();
  }
});

test("loadDu keeps paths that contain spaces and records measured directories", () => {
  const loaded = loadDu("# /h/Library\n10\t/h/my models\n20\t/h/Library\n");
  assert.equal(loaded.expanded.has("/h/Library"), true);
  assert.equal(loaded.sizes.get("/h/my models"), 10240);
  assert.equal(loaded.sizes.get("/h/Library"), 20480);
});

test("a real .agent-desktop directory is unclassified", async () => {
  const fix = await fixture();
  try {
    const desk = join(fix.home, ".agent-desktop");
    await mkdir(desk);
    const rows = scanRoots(fix.ctx, () => 0, () => []);
    assert.ok(rows.some((row) => row.path === desk && row.class === ""));
  } finally {
    await fix.cleanup();
  }
});

test("scanRoots requires a size function", async () => {
  const fix = await fixture();
  try {
    assert.throws(() => scanRoots(fix.ctx), /disk size/);
  } finally {
    await fix.cleanup();
  }
});
