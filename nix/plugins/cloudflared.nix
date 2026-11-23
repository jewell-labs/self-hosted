{ plugin, cloudflared, coreutils, writeShellApplication }:
let
  tunnel = writeShellApplication {
    name = "cloudflared-tunnel";
    runtimeInputs = [ cloudflared coreutils ];
    text = ''
      token_file="''${CLOUDFLARED_TOKEN_FILE:-$HOME/.cloudflared/token}"
      if [[ ! -f $token_file ]]; then
        echo "cloudflared: missing $token_file" >&2
        exit 1
      fi
      mode=$(stat -f '%Lp' "$token_file" 2>/dev/null || stat -c '%a' "$token_file")
      if [[ $mode != "600" ]]; then
        echo "cloudflared: $token_file must be mode 0600 (is $mode)" >&2
        exit 1
      fi
      exec cloudflared tunnel --no-autoupdate run --token-file "$token_file"
    '';
  };
in
plugin {
  id = "cloudflared";
  summary = "Cloudflare Tunnel unit that reads the token from a mode 0600 file, never from git.";
  runtimeInputs = [ cloudflared ];
  mainProgram = "cloudflared-tunnel";
  installPhase = ''
    ln -s ${tunnel}/bin/cloudflared-tunnel $out/bin/cloudflared-tunnel
    ln -s ${cloudflared}/bin/cloudflared $out/bin/cloudflared
  '';
}
