{ lib, stdenv, fetchurl, autoPatchelfHook, plugin }:
let
  version = (builtins.fromJSON (builtins.readFile ../../agent-desktop/plugin.json)).version;
  sources = {
    aarch64-darwin = {
      target = "aarch64-apple-darwin";
      hash = "sha256-m3t8/HSJLqtGwshdbLfcSGO/jasKIiz8+4rkYExpyGw=";
    };
    x86_64-darwin = {
      target = "x86_64-apple-darwin";
      hash = "sha256-Rp2hDPtokoxYyv+IuSswUm4MqJWsBryGt/UzsdmzCbM=";
    };
    aarch64-linux = {
      target = "aarch64-unknown-linux-gnu";
      hash = "sha256-Q4mQpwP76xl3VZbDQcNwFDXoCtv6Gy9kuC/xdWfVVzs=";
    };
    x86_64-linux = {
      target = "x86_64-unknown-linux-gnu";
      hash = "sha256-yne2t1A07rEuU33YwKTyo0JBGSU/OLfmvXm6DS/vEmQ=";
    };
  };
  spec = sources.${stdenv.hostPlatform.system} or (throw "agent-desktop ${version} has no binary for ${stdenv.hostPlatform.system}");
  binary = stdenv.mkDerivation {
    pname = "agent-desktop";
    inherit version;
    src = fetchurl {
      url = "https://github.com/vercel-labs/agent-desktop/releases/download/v${version}/agent-desktop-v${version}-${spec.target}.tar.gz";
      hash = spec.hash;
    };
    nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
    buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];
    dontConfigure = true;
    dontBuild = true;
    unpackPhase = ''
      tar -xzf $src
    '';
    installPhase = ''
      mkdir -p $out/bin
      mv agent-desktop $out/bin/agent-desktop
      chmod +x $out/bin/agent-desktop
      if [[ -f agent-desktop-macos-helper ]]; then
        mv agent-desktop-macos-helper $out/bin/agent-desktop-macos-helper
        chmod +x $out/bin/agent-desktop-macos-helper
      fi
    '';
    meta.mainProgram = "agent-desktop";
  };
in
plugin {
  id = "agent-desktop";
  summary = "agent-desktop ${version}, including the macOS sandbox provider. The first guest still needs a person to grant Accessibility.";
  runtimeInputs = [ binary ];
  mainProgram = "agent-desktop";
  installPhase = ''
    ln -s ${binary}/bin/agent-desktop $out/bin/agent-desktop
    if [[ -e ${binary}/bin/agent-desktop-macos-helper ]]; then
      ln -s ${binary}/bin/agent-desktop-macos-helper $out/bin/agent-desktop-macos-helper
    fi
  '';
  passthru = { inherit binary version; };
}
