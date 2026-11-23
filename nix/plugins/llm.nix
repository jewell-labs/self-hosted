{ plugin, llama-cpp }:
plugin {
  id = "llm";
  summary = "One llama.cpp server for this host. One resident model. Weights are the shared ~/.self-hosted/models/gguf library.";
  runtimeInputs = [ llama-cpp ];
  mainProgram = "setup";
  installPhase = ''
    ln -s ${llama-cpp}/bin/llama-server $out/bin/llama-server
  '';
}
