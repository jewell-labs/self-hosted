import { mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../lib/discover.mjs";
import { layout, pluginDir } from "../lib/paths.mjs";
import { loadDescriptors } from "./harnesses.mjs";

function sh(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export async function installWrappers(env = process.env) {
  const root = env.SELFHOST_ROOT ?? repoRoot();
  const bin = join(pluginDir("work", env), "bin");
  const linkDir = layout(env).bin;
  await mkdir(bin, { recursive: true });
  await mkdir(linkDir, { recursive: true });
  const docs = await loadDescriptors(root);
  const wrap = join(root, "work/wrap.mjs");
  const launcher = join(root, "bin/selfhost");
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
    const link = join(linkDir, doc.id);
    await unlink(link).catch(() => {});
    await symlink(dest, link);
    written.push(dest);
  }
  return written;
}
