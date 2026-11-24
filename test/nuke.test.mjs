import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat, chmod, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const labels = [
  "com.jewell-labs.llama-server",
  "com.jewell-labs.cloudflared",
  "com.jewell-labs.cloudflared-studio",
  "com.jewell-labs.userland-sshd",
  "com.jewell-labs.routines",
  "local.ghref",
  "com.dpi.llama-server",
];

function launchctlScript({ stuck }) {
  return `#!/bin/sh
printf '%s\\n' "$*" >> "$SELFHOST_LAUNCHCTL_LOG"
label=\${2##*/}
if [ "$1" = bootout ]; then
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
  if [ -n "$SELFHOST_STUCK" ]; then exit 0; fi
  grep -vx "$label" "$SELFHOST_LOADED" > "$SELFHOST_LOADED.next" || true
  mv "$SELFHOST_LOADED.next" "$SELFHOST_LOADED"
  exit 0
fi
if [ "$1" = print ]; then
  if [ -n "$SELFHOST_STUCK" ]; then exit 0; fi
  if grep -qx "$label" "$SELFHOST_LOADED"; then exit 0; fi
  exit 1
fi
exit 0
`;
}

async function fixture(stuck) {
  const home = await mkdtemp(join(tmpdir(), "selfhost-nuke-"));
  const root = join(home, ".self-hosted");
  const agents = join(home, "Library/LaunchAgents");
  await mkdir(join(root, "models/gguf"), { recursive: true });
  await mkdir(join(root, "agent-desktop/sandbox"), { recursive: true });
  await mkdir(join(root, "state"), { recursive: true });
  await mkdir(join(root, "cloudflared"), { recursive: true });
  await mkdir(join(root, "sshd"), { recursive: true });
  await mkdir(join(root, "github/example"), { recursive: true });
  await mkdir(join(root, "ghref"), { recursive: true });
  await mkdir(join(root, "portless"), { recursive: true });
  await mkdir(join(root, "logs"), { recursive: true });
  await mkdir(join(root, "bin"), { recursive: true });
  await mkdir(join(root, "launchd"), { recursive: true });
  await mkdir(agents, { recursive: true });
  await mkdir(join(home, "Library/Logs"), { recursive: true });
  await mkdir(join(home, ".local/bin"), { recursive: true });
  await mkdir(join(home, "local"), { recursive: true });
  await writeFile(join(root, "models/gguf/weight.gguf"), "keep-weight");
  await writeFile(join(root, "agent-desktop/sandbox/marker"), "keep-sandbox");
  await writeFile(join(root, "state/host.json"), "remove-me");
  await writeFile(join(root, "cloudflared/token"), "not-a-real-token", { mode: 0o600 });
  await writeFile(join(root, "sshd/ssh_host_ed25519_key"), "not-a-real-key");
  await writeFile(join(root, "github/example/README"), "checkout");
  await writeFile(join(root, "logs/ghref.log"), "log");
  await writeFile(join(root, "bin/ghref"), "#!/bin/sh\nexit 0\n");
  await writeFile(join(home, "outside.txt"), "leave-me");
  await symlink(join(root, "state/host.json"), join(root, "state/linked-outside"));
  await writeFile(join(home, ".local/bin/cloudflared-tunnel"), "#!/bin/sh\nexec cloudflared tunnel --no-autoupdate run --token-file \"$HOME/.cloudflared/token\"\n");
  await symlink(join(root, "bin/ghref"), join(home, ".local/bin/ghref"));
  await symlink(join(root, "models"), join(home, "local/models"));
  await symlink(join(root, "agent-desktop"), join(home, ".agent-desktop"));
  await symlink(join(root, "cloudflared"), join(home, ".cloudflared"));
  await symlink(join(root, "logs/ghref.log"), join(home, "Library/Logs/ghref.log"));
  await symlink(join(home, "outside.txt"), join(home, "unrelated"));
  const recorded = [
    { path: join(home, "local/models"), target: join(root, "models") },
    { path: join(home, ".agent-desktop"), target: join(root, "agent-desktop") },
    { path: join(home, ".cloudflared"), target: join(root, "cloudflared") },
    { path: join(home, "Library/Logs/ghref.log"), target: join(root, "logs/ghref.log") },
    { path: join(home, "important"), target: join(root, "state") },
  ];
  await mkdir(join(home, "important"), { recursive: true });
  await writeFile(join(home, "important/keep.txt"), "real-directory");
  await writeFile(join(root, "launchd/links.json"), `${JSON.stringify({ schema: "jewell-labs.self-hosted.links.v1", links: recorded }, null, 2)}\n`);
  await writeFile(join(root, "launchd/labels.json"), `${JSON.stringify({ labels }, null, 2)}\n`);
  for (const label of labels) await writeFile(join(agents, `${label}.plist`), `<plist>${label}</plist>`);
  const log = join(home, "launchctl.log");
  const loaded = join(home, "loaded");
  await writeFile(loaded, `${labels.join("\n")}\n`);
  const bin = join(home, "launchctl");
  await writeFile(bin, launchctlScript({ stuck }));
  await chmod(bin, 0o755);
  return { home, root, log, loaded, bin };
}

function run(home, args, extra = {}) {
  return spawnSync(process.execPath, [join(repo, "bin/nuke.mjs"), ...args], {
    env: {
      ...process.env,
      HOME: home,
      SELFHOST_HOME: join(home, ".self-hosted"),
      SELFHOST_LAUNCHCTL: join(home, "launchctl"),
      SELFHOST_LAUNCHCTL_LOG: join(home, "launchctl.log"),
      SELFHOST_LOADED: join(home, "loaded"),
      SELFHOST_LAUNCHD_DOMAIN: "gui/501",
      ...extra,
    },
    encoding: "utf8",
  });
}

test("just nuke keeps weights and the sandbox and clears launch agents", async () => {
  const { home, root, log } = await fixture(false);
  try {
    const result = run(home, []);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /clean/);
    assert.equal(await readFile(join(root, "models/gguf/weight.gguf"), "utf8"), "keep-weight");
    assert.equal(await readFile(join(root, "agent-desktop/sandbox/marker"), "utf8"), "keep-sandbox");
    await assert.rejects(lstat(join(root, "state")));
    await assert.rejects(lstat(join(root, "cloudflared")));
    await assert.rejects(lstat(join(root, "github")));
    await assert.rejects(lstat(join(root, "ghref")));
    await assert.rejects(lstat(join(root, "portless")));
    await assert.rejects(lstat(join(root, "logs")));
    await assert.rejects(lstat(join(root, "bin")));
    assert.equal((await lstat(join(home, "local/models"))).isSymbolicLink(), true);
    assert.equal((await lstat(join(home, ".agent-desktop"))).isSymbolicLink(), true);
    await assert.rejects(lstat(join(home, ".cloudflared")));
    await assert.rejects(lstat(join(home, "Library/Logs/ghref.log")));
    await assert.rejects(lstat(join(home, ".local/bin/ghref")));
    await assert.rejects(lstat(join(home, ".local/bin/cloudflared-tunnel")));
    assert.equal(await readFile(join(home, "important/keep.txt"), "utf8"), "real-directory");
    assert.equal(await readFile(join(home, "outside.txt"), "utf8"), "leave-me");
    assert.equal((await lstat(join(home, "unrelated"))).isSymbolicLink(), true);
    assert.deepEqual((await readdir(root)).sort(), ["agent-desktop", "models"]);
    const calls = await readFile(log, "utf8");
    for (const label of labels) {
      assert.match(calls, new RegExp(`bootout gui/501/${label}`));
      await assert.rejects(lstat(join(home, "Library/LaunchAgents", `${label}.plist`)));
    }
    const loaded = await readFile(join(home, "loaded"), "utf8");
    assert.equal(loaded.trim(), "");
    const again = run(home, []);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(await readFile(join(root, "models/gguf/weight.gguf"), "utf8"), "keep-weight");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("nuke fails while a managed label is still loaded", async () => {
  const { home } = await fixture(false);
  try {
    const result = run(home, [], { SELFHOST_STUCK: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /still loaded: com.jewell-labs.llama-server/);
    assert.match(result.stderr, /still loaded: local.ghref/);
    await assert.rejects(lstat(join(home, "Library/LaunchAgents/local.ghref.plist")));
    assert.equal(await readFile(join(home, ".self-hosted/models/gguf/weight.gguf"), "utf8"), "keep-weight");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("nuke removes plists when launchctl is absent", async () => {
  const { home } = await fixture(false);
  try {
    const result = run(home, [], { SELFHOST_LAUNCHCTL: join(home, "missing-launchctl") });
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(lstat(join(home, "Library/LaunchAgents/com.jewell-labs.llama-server.plist")));
    await assert.rejects(lstat(join(home, ".self-hosted/state")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("nuke-all removes weights, the sandbox, and their symlinks", async () => {
  const { home } = await fixture(false);
  try {
    const result = run(home, ["--all"]);
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(lstat(join(home, ".self-hosted")));
    await assert.rejects(lstat(join(home, "local/models")));
    await assert.rejects(lstat(join(home, ".agent-desktop")));
    await assert.rejects(lstat(join(home, "Library/LaunchAgents/local.ghref.plist")));
    assert.equal(await readFile(join(home, "outside.txt"), "utf8"), "leave-me");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
