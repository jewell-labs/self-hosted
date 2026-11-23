# NixOS module for the llm server only. Off unless services.jewell-labs-self-hosted.llm.enable is set.
# Decision models use the decision plugin and port 8090. They are not this unit.
# macOS and CUDA argv stay in lib/profiles.mjs.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.jewell-labs-self-hosted.llm;
in
{
  options.services.jewell-labs-self-hosted.llm = {
    enable = lib.mkEnableOption "the self-hosted llm server";
    modelsDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/self-hosted/models/gguf";
      description = "Shared GGUF library. The decision router reads this same directory.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.jewell-labs-llm = {
      description = "self-hosted llm server";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        ExecStart = lib.escapeShellArgs [
          "${pkgs.llama-cpp}/bin/llama-server"
          "--host"
          "127.0.0.1"
          "--port"
          "8080"
          "--jinja"
          "--flash-attn"
          "off"
          "--n-gpu-layers"
          "0"
          "--ctx-size"
          "4096"
          "--parallel"
          "1"
          "--models-max"
          "1"
          "--no-webui"
          "--metrics"
          "--models-dir"
          cfg.modelsDir
        ];
      };
    };
  };
}
