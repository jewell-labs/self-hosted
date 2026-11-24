import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../lib/discover.mjs";
import { layout } from "../lib/paths.mjs";
import { loadDescriptors } from "./harnesses.mjs";

function sh(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export async function installWrappers(env = process.env) {
  const root = env.SELFHOST_ROOT ?? repoRoot();
  const bin = layout(env).bin;
  await mkdir(bin, { recursive: true });
  const docs = await loadDescriptors(root);
  const wrap = join(root, "work/wrap.mjs");
  const written = [];
  for (const doc of docs) {
    const script = `#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATH=$(printf '%s' "$PATH" | tr ':' '\\n' | grep -vxF "$here" | paste -sd: -) || true
exec ${sh(process.execPath)} ${sh(wrap)} ${sh(doc.id)} "$@"
`;
    const dest = join(bin, doc.id);
    await writeFile(dest, script, { mode: 0o755 });
    written.push(dest);
  }
  return written;
}
