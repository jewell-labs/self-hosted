{ plugin, repo, nodejs, writeShellApplication }:
let
  serve = writeShellApplication {
    name = "selfhost-mcp";
    runtimeInputs = [ nodejs ];
    text = ''
      exec node '${repo}/mcp/server.mjs' "$@"
    '';
  };
in
plugin {
  id = "mcp";
  summary = "Serve one MCP tool, discover, on loopback. A non-loopback bind requires Cloudflare Access.";
  proofRequired = true;
  runtimeInputs = [ nodejs ];
  mainProgram = "selfhost-mcp";
  installPhase = ''
    ln -s ${serve}/bin/selfhost-mcp $out/bin/selfhost-mcp
  '';
}
