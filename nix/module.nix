# NixOS module for the llm server only. Off unless services.jewell-labs-self-hosted.llm.enable is set.
# Decision models use the decision plugin and port {decision}. They are not this unit.
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
      default = "/var/lib/self-hosted/llm/models/gguf";
      description = "GGUF library owned by the llm plugin. The decision router reads this same directory.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.jewell-labs-llm = {
      description = "self-hosted llm server";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        ExecStart = lib.escapeShellArgs [
          "${pkgs.bash}/bin/bash"
          "-c"
          "exec portless llm -- ${pkgs.llama-cpp}/bin/llama-server --host 127.0.0.1 --port \"$PORT\" --jinja --flash-attn off --n-gpu-layers 0 --ctx-size 4096 --parallel 1 --models-max 1 --no-webui --metrics --models-dir ${lib.escapeShellArg cfg.modelsDir}"
        ];
      };
    };
  };
}
