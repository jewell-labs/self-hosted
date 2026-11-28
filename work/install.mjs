import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../core/lib/discover.mjs";
import { layout, pluginDir } from "../core/lib/paths.mjs";
import { loadDescriptors } from "./harnesses.mjs";

function sh(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export async function installWrappers(env = process.env) {
  const root = env.SELFHOST_ROOT ?? repoRoot();
  const bin = join(pluginDir("work", env), "bin");
  const commandDir = layout(env).bin;
  await mkdir(bin, { recursive: true });
  await mkdir(commandDir, { recursive: true });
  const docs = await loadDescriptors(root);
  const wrap = join(root, "work/wrap.mjs");
  const launcher = join(root, "core/bin/selfhost");
  const written = [];
  for (const doc of docs) {
    const script = `#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATH=$(printf '%s' "$PATH" | tr ':' '\\n' | grep -vxF "$here" | paste -sd: -) || true
exec ${sh(launcher)} ${sh(wrap)} ${sh(doc.id)} "$@"
`;
    const dest = join(bin, doc.id);
    await writeFile(dest, script, { mode: 0o755 });
    const command = join(commandDir, doc.id);
    await unlink(command).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    await writeFile(command, script, { mode: 0o755 });
    written.push(dest);
  }
  return written;
}
