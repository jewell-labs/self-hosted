#!/bin/sh
# Reads the tunnel token from a mode 0600 file. The token is not a flag and not in git.
set -eu
token_file=${CLOUDFLARED_TOKEN_FILE:-"$HOME/.cloudflared/token"}
if [ ! -f "$token_file" ]; then
  echo "cloudflared: missing $token_file" >&2
  exit 1
fi
mode=$(stat -f '%Lp' "$token_file" 2>/dev/null || stat -c '%a' "$token_file")
if [ "$mode" != "600" ]; then
  echo "cloudflared: $token_file must be mode 0600 (is $mode)" >&2
  exit 1
fi
bin=${CLOUDFLARED_BIN:-cloudflared}
exec "$bin" tunnel --no-autoupdate run --token-file "$token_file"
