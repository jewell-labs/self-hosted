import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { containerAppRoot, containerEnv, layout } from "../lib/paths.mjs";

test("container store stays the plugin directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "selfhost-paths-"));
  try {
    const env = { HOME: home, SELFHOST_HOME: join(home, ".self-hosted") };
    const legacy = join(home, "Library", "Application Support", "com.apple.container");
    await mkdir(legacy, { recursive: true });
    const store = layout(env).containers;
    assert.equal(containerAppRoot(env), store);
    assert.equal(containerEnv(env).CONTAINER_APP_ROOT, store);
    const preset = containerEnv({ ...env, CONTAINER_APP_ROOT: join(home, "elsewhere") });
    assert.equal(preset.CONTAINER_APP_ROOT, join(home, "elsewhere"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
