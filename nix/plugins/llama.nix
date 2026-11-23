{ plugin, llama-cpp }:
plugin {
  id = "llama";
  summary = "llama.cpp server tuned for single-stream throughput. One resident model.";
  runtimeInputs = [ llama-cpp ];
  mainProgram = "setup";
  installPhase = ''
    ln -s ${llama-cpp}/bin/llama-server $out/bin/llama-server
    mkdir -p $out/share/selfhost
    cat > $out/share/selfhost/llama-note.txt <<'EOF'
    Weights stay outside the Nix store. Set SELFHOST_MODELS_DIR.
    SELFHOST_ACTIVATE=1 is required before this package writes a service unit.
    Hosts under 64GB keep a single llama-server.
    EOF
  '';
  setupBody = ''
    if [[ "''${SELFHOST_ACTIVATE:-}" == "1" ]]; then
      echo "llama-server ${llama-cpp}/bin/llama-server"
      echo "profile $SELFHOST_STATE/llama.json"
      echo "Weights stay in SELFHOST_MODELS_DIR. This command does not bootstrap launchd or systemd."
    fi
  '';
}
