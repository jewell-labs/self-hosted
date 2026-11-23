# Nix

`flake.nix` and `nix/plugins` are the packages. `catalog/plugins.json` is the ids and the setup commands. `catalog/pins.json` is the pinned CLI versions. `flake.lock` pins nixpkgs.

`just setup <id>` and `just check <id>` run those commands. `just flake` evaluates the flake. Setup does not set `SELFHOST_ACTIVATE` and does not start launchd or systemd.

Secrets and GGUF weights stay out of the Nix store.
