{ plugin, llama-cpp }:
plugin {
  id = "llm";
  summary = "One llama.cpp server for this host. One resident model. The GGUF library is ~/.self-hosted/llm/models/gguf. Decision reads that same directory.";
  runtimeInputs = [ llama-cpp ];
  mainProgram = "setup";
  installPhase = ''
    ln -s ${llama-cpp}/bin/llama-server $out/bin/llama-server
  '';
}
