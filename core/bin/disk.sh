#!/bin/sh
# Measure with du from this shell, then classify with node.
# A du process started by node blocks on a macOS privacy prompt.
cd "$(dirname "$0")/.." || exit 1
node=/opt/homebrew/bin/node
if [ ! -x "$node" ]; then
  node=node
fi
sizes=$(mktemp)
err=$(mktemp)
out=$(mktemp)
node_err=$(mktemp)
trap 'status=$?; rm -f "$sizes" "$err" "$out" "$node_err"; exit "$status"' EXIT
while true; do
  "$node" core/bin/disk.mjs --sizes "$sizes" --du-err "$err" >"$out" 2>"$node_err"
  code=$?
  if [ "$code" -ne 2 ]; then
    cat "$node_err" >&2
    cat "$out"
    exit "$code"
  fi
  path=$(sed -n 's/^measure //p' "$out" | head -1)
  if [ -z "$path" ]; then
    echo "disk measure request was empty" >&2
    exit 1
  fi
  printf 'measuring %s\n' "$path" >&2
  if ! python3 -c 'import subprocess, sys
path, outp, errp = sys.argv[1:4]
err = open(errp, "a")
proc = subprocess.Popen(["du", "-kx", "-d", "1", path], stdout=subprocess.PIPE, stderr=err)
try:
    out, _ = proc.communicate(timeout=90)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.communicate()
    sys.exit(1)
text = out.decode()
found = False
for line in text.splitlines():
    parts = line.split(None, 1)
    if len(parts) == 2 and parts[1] == path:
        found = True
        break
if not found:
    sys.exit(1)
with open(outp, "a") as handle:
    handle.write(text)
    if text and not text.endswith("\n"):
        handle.write("\n")
    handle.write("# %s\n" % path)
' "$path" "$sizes" "$err"; then
    echo "disk measure produced no size for $path" >&2
    exit 1
  fi
done
