# Nix

`flake.nix` and `nix/plugins` are the packages. `catalog/plugins.json` is the ids and the setup commands. `catalog/pins.json` is the pinned CLI versions. `flake.lock` pins nixpkgs.

`<id>.setup` runs that plugin's setup. `<id>.check` reads the unit that setup wrote. `flake` runs `nix flake check`. Setup does not set `SELFHOST_ACTIVATE` and does not start launchd or systemd.

Secrets and GGUF weights stay out of the Nix store.
