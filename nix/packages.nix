# Packages for one system. The flake is a thin wrapper around this file.
{ pkgs, self }:
let
  inherit (pkgs) lib;
  plugin = pkgs.callPackage ./plugin.nix { repo = self; };
  catalog = builtins.fromJSON (builtins.readFile ../catalog/plugins.json);
  pins = builtins.fromJSON (builtins.readFile ../catalog/pins.json);
  names = [
    "baseline"
    "mcp"
    "llama"
    "decision"
    "cloudflared"
    "sshd"
    "github-repos"
    "agent-desktop"
    "agent-browser"
    "actions-runner"
    "simulators"
    "portless"
  ];
  catalogIds = map (pluginSpec: pluginSpec.id) catalog.plugins;
  packages = {
    baseline = plugin {
      id = "baseline";
      summary = "Record the host facts the other plugins just discovered.";
      proofRequired = true;
    };
    mcp = pkgs.callPackage ./plugins/mcp.nix { inherit plugin; repo = self; };
    llama = pkgs.callPackage ./plugins/llama.nix { inherit plugin; };
    decision = plugin {
      id = "decision";
      summary = "Decision-modality models on the llama.cpp router. A second process only when the host has 64GB or more.";
    };
    cloudflared = pkgs.callPackage ./plugins/cloudflared.nix { inherit plugin; };
    sshd = pkgs.callPackage ./plugins/sshd.nix { inherit plugin self; };
    github-repos = pkgs.callPackage ./plugins/github-repos.nix { inherit plugin self; };
    agent-desktop = pkgs.callPackage ./plugins/agent-desktop.nix { inherit plugin pins; };
    agent-browser = pkgs.callPackage ./plugins/agent-browser.nix { inherit plugin pins; };
    actions-runner = pkgs.callPackage ./plugins/actions-runner.nix { inherit plugin pins; };
    simulators = plugin {
      id = "simulators";
      summary = "Claim every available iOS simulator. A host with none records an empty list.";
    };
    portless = plugin {
      id = "portless";
      summary = "One Portless proxy for local web apps, agent-browser, agent-desktop guests, and simulators.";
    };
  };
in
assert catalogIds == names;
assert pins.nix == "2.36.0";
packages
