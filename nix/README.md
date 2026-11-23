# Nix plugins

Reviewed before these expressions were written, on 2026-11-23:

- Nix 2.36.0 (notes 2026-11-16). Multi-user install is `curl -sSfL https://channels.nixos.org/nix-latest/nix-installer | sh -s -- install` (aarch64-darwin, aarch64-linux, x86_64-linux). The scripted installer still supports a single-user install on busybox, which is what an Apple container needs. Flakes are still experimental. `nix run` auto-calls a function whose arguments all have defaults.
- nix.dev: a flake is a thin wrapper, packages use `callPackage`, inputs are pinned, and the file avoids `rec`, `with`, and `<nixpkgs>`. Relative paths start with `./`.
- nixpkgs 26.11 “Zokor” is the current line, and the `nixos-26.11` branch was not published yet. This flake follows `nixos-unstable` and pins the revision in `flake.lock`. Channel tarballs are `.tar.zst`. `llama-cpp` in that line is 1.0.0 and uses Metal on Apple Silicon.
- agent-desktop 1.3.1 (sandbox command from 1.3.0). The first macOS guest needs a person: Setup Assistant, `guest-setup.sh` from the shared folder, and Accessibility. The guest network is not isolated. Two macOS VMs at a time.
- agent-browser 0.43.0. The package is the native CLI. `agent-browser install` downloads Chrome for Testing into the user directory.

```sh
nix run .#setup-baseline
nix run .#check-baseline
nix flake check
nix profile install .#agent-desktop
```

`SELFHOST_ACTIVATE` is not set by setup. Setup records the host and does not bootstrap launchd or systemd, so a check cannot replace the machine's running services.

Secrets stay out of the store: tunnel tokens, SSH CA and keys, runner registration tokens, and GGUF weights.
