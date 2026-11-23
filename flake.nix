{
  description = "jewell-labs self-hosted plugins";

  # nixos-26.11 is not branched yet (checked 2026-11-23). nixos-unstable is the
  # 26.11 line. flake.lock pins the revision this repo was tested with.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-darwin" "x86_64-linux" ];
      each = f: nixpkgs.lib.genAttrs systems (system:
        f (nixpkgs.legacyPackages.${system})
      );
    in
    {
      packages = each (pkgs:
        let
          plugins = import ./nix/packages.nix { inherit pkgs self; };
        in
        plugins // { default = plugins.baseline; }
      );

      apps = each (pkgs:
        let
          packages = self.packages.${pkgs.stdenv.hostPlatform.system};
        in
        nixpkgs.lib.concatMapAttrs
          (name: pkg: {
            "setup-${name}" = {
              type = "app";
              program = "${pkg}/bin/setup";
            };
            "check-${name}" = {
              type = "app";
              program = "${pkg}/bin/check";
            };
          })
          (nixpkgs.lib.filterAttrs (name: pkg: name != "default" && pkg ? plugin) packages)
      );

      checks = each (pkgs: {
        plugins = pkgs.callPackage ./nix/checks.nix {
          packages = self.packages.${pkgs.stdenv.hostPlatform.system};
        };
      });

      # Importable without this flake: nixosModules.default = import ./nix/module.nix
      nixosModules.default = ./nix/module.nix;
    };
}
