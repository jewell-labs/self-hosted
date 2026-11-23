# NixOS module. Off unless services.jewell-labs-self-hosted.llama.enable is set.
# The argv here is the portable CPU profile. macOS and CUDA stay in lib/profiles.mjs
# and are selected by the plugin setup command for the host it is running on.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.jewell-labs-self-hosted.llama;
in
{
  options.services.jewell-labs-self-hosted.llama = {
    enable = lib.mkEnableOption "llama.cpp with the self-hosted CPU profile";
    modelsDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/self-hosted/models";
      description = "Directory of GGUF files. The files are not part of this repo.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.jewell-labs-llama = {
      description = "self-hosted llama.cpp";
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
