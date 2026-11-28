# Nix

`flake.nix` and `nix/plugins` are the packages. Each package's `plugin.json` holds its id, summary, and any CLI version. `nix/plugin.json` is the Nix version. `core/plugin.json` is the txiki version. `flake.lock` pins nixpkgs.

`<id>.setup` runs that plugin's setup. `<id>.check` reads the unit that setup wrote. `flake` runs `nix flake check`. Setup does not set `SELFHOST_ACTIVATE` and does not start launchd or systemd.

Secrets and GGUF weights stay out of the Nix store.

## Invoke

From the repo root, `nix flake check path:./nix` and `nix flake show path:./nix`. The flake lives in this directory, so a pure evaluation cannot see the git root. Sibling package names are the one exception. Nix is not required to set this package up.

## Lifecycle

Set yourself up with `node nix/setup.mjs`. Tear yourself down with `node nix/teardown.mjs`. Teardown leaves assets in place. The base event is the healthcheck. Dependencies live in this directory, except `core/`.
