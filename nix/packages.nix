# Packages for one system. The flake is a thin wrapper around this file.
{ pkgs, self }:
let
  inherit (pkgs) lib;
  txiki = pkgs.callPackage ./txiki.nix { };
  syncio = pkgs.callPackage ./syncio.nix { };
  plugin = pkgs.callPackage ./plugin.nix { repo = self; inherit txiki syncio; };
  libExt = if pkgs.stdenv.isDarwin then "dylib" else "so";
  catalog = builtins.fromJSON (builtins.readFile ../core/catalog/plugins.json);
  pins = builtins.fromJSON (builtins.readFile ../core/catalog/pins.json);
  names = [
    "baseline"
    "mcp"
    "llm"
    "decision"
    "cloudflare"
    "sshd"
    "github-repos"
    "agent-desktop"
    "agent-browser"
    "actions-runner"
    "simulators"
    "portless"
    "work"
    "evals"
    "containers"
  ];
  harnessIds = map (name: lib.removeSuffix ".json" name) (
    lib.sort builtins.lessThan (
      builtins.attrNames (lib.filterAttrs (name: _: lib.hasSuffix ".json" name) (builtins.readDir ../work/harnesses))
    )
  );
  catalogIds = map (pluginSpec: pluginSpec.id) catalog.plugins;
  packages = {
    baseline = plugin {
      id = "baseline";
      summary = "Record the host facts the other plugins just discovered.";
      proofRequired = true;
    };
    mcp = pkgs.callPackage ./plugins/mcp.nix { inherit plugin txiki syncio; repo = self; };
    llm = pkgs.callPackage ./plugins/llm.nix { inherit plugin; };
    decision = plugin {
      id = "decision";
      summary = "Decision models and compound models, separate from the llm server. The registry is unbounded. Resident slots come from host memory.";
    };
    cloudflare = pkgs.callPackage ./plugins/cloudflare.nix { inherit plugin; };
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
      summary = "The core proxy. Host services are port {mcp}, port {llm}, port {decision}, and port {sshd}.";
      proofRequired = true;
    };
    work = plugin {
      id = "work";
      summary = "Short-lived clones under ~/.self-hosted/work. Each coding harness is a descriptor that is probed and then streamed.";
      installPhase = lib.concatMapStrings (name:
        let
          script = pkgs.writeShellScript "selfhost-wrap-${name}" ''
            here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
            PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -vxF "$here" | paste -sd: -) || true
            export SELFHOST_RUN=${self}/../core/bin/run.js
            export SELFHOST_SYNCIO=${syncio}/lib/syncio.${libExt}
            exec ${txiki}/bin/tjs run "$SELFHOST_RUN" ${self}/../work/wrap.mjs ${name} "$@"
          '';
        in ''
          cp ${script} $out/bin/${name}
          chmod 755 $out/bin/${name}
        '') harnessIds;
    };
    evals = plugin {
      id = "evals";
      summary = "Record eval ids for the llm and the decision models. evals.report reads the event log.";
    };
    containers = plugin {
      id = "containers";
      summary = "Apple container images, kernels, and volumes. The store is ~/.self-hosted/containers.";
    };
  };
in
assert catalogIds == names;
assert pins.nix == "2.36.0";
assert pins.txiki == "26.11.0";
packages
