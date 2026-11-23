# One plugin package: a setup program and a check program.
# Callers pass the flake source as `repo`. Scripts read that source and write
# state outside the Nix store.
{ lib
, stdenvNoCC
, writeShellApplication
, bash
, coreutils
, nodejs
, repo
}:
{ id
, summary
, proofRequired ? false
, match ? { os = [ "darwin" "linux" ]; arch = [ "arm64" "x64" ]; }
, runtimeInputs ? [ ]
, setupBody ? ""
, checkBody ? ""
, installPhase ? ""
, mainProgram ? "setup"
, passthru ? { }
}:
let
  inputs = [ bash coreutils nodejs ] ++ runtimeInputs;
  preamble = ''
    repo=${repo}
    if [[ -f $PWD/catalog/plugins.json ]]; then
      export SELFHOST_STATE="''${SELFHOST_STATE:-$PWD/.self-hosted}"
    else
      export SELFHOST_STATE="''${SELFHOST_STATE:-''${XDG_STATE_HOME:-$HOME/.local/state}/self-hosted}"
    fi
    export SELFHOST_ROOT=$repo
    mkdir -p "$SELFHOST_STATE"
  '';
  setup = writeShellApplication {
    name = "selfhost-${id}-setup";
    runtimeInputs = inputs;
    text = preamble + ''
      node "$repo/bin/setup.mjs" ${id}
      ${setupBody}
    '';
  };
  check = writeShellApplication {
    name = "selfhost-${id}-check";
    runtimeInputs = inputs;
    text = preamble + (if checkBody == "" then ''
      node "$repo/bin/check.mjs" ${id}
    '' else checkBody);
  };
in
stdenvNoCC.mkDerivation {
  pname = "selfhost-${id}";
  version = "0.1.0";
  dontUnpack = true;
  dontConfigure = true;
  dontBuild = true;
  installPhase = ''
    mkdir -p $out/bin $out/share/selfhost
    ln -s ${setup}/bin/selfhost-${id}-setup $out/bin/setup
    ln -s ${check}/bin/selfhost-${id}-check $out/bin/check
    ${installPhase}
  '';
  passthru = passthru // {
    plugin = { inherit id summary proofRequired match; };
    inherit setup check;
  };
  meta = {
    description = summary;
    mainProgram = mainProgram;
    platforms = lib.platforms.unix;
  };
}
