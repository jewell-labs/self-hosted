{ plugin, repo, txiki, syncio, writeShellApplication, stdenvNoCC }:
let
  libExt = if stdenvNoCC.isDarwin then "dylib" else "so";
  serve = writeShellApplication {
    name = "selfhost-mcp";
    runtimeInputs = [ txiki ];
    text = ''
      export SELFHOST_RUN=${repo}/bin/run.js
      export SELFHOST_SYNCIO=${syncio}/lib/syncio.${libExt}
      exec ${txiki}/bin/tjs run "$SELFHOST_RUN" ${repo}/mcp/server.mjs "$@"
    '';
  };
in
plugin {
  id = "mcp";
  summary = "Serve mesh MCP tools declared under .agents. A non-loopback bind requires Cloudflare Access, and so does every destructive tool.";
  proofRequired = true;
  runtimeInputs = [ txiki ];
  mainProgram = "selfhost-mcp";
  installPhase = ''
    ln -s ${serve}/bin/selfhost-mcp $out/bin/selfhost-mcp
  '';
}
