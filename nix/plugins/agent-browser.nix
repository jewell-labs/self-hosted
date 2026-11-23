{ lib, stdenv, fetchurl, autoPatchelfHook, plugin, pins }:
let
  version = pins.agent-browser;
  sources = {
    aarch64-darwin = {
      name = "cli-darwin-arm64";
      hash = "sha512-HV6GP59IjNnowlrXR/5rVM8msPWwQDEONt/tWC8STzUfKZQHKZI/Iv9sf2h2ZhwK8xwoqLhxpf+KxcFgJ0sExQ==";
    };
    x86_64-darwin = {
      name = "cli-darwin-x64";
      hash = "sha512-3NKnKFOWLYDYTz4bJxo4jt+GwjM4VtcW5FDrQY35eUrytig65FEDdXmXKuRbZGq9jEEWxh6rmpS4R6xS53XCaw==";
    };
    aarch64-linux = {
      name = "cli-linux-arm64-gnu";
      hash = "sha512-8DC234LGlXCn8A2YXGk6woy1uTjyexvtHd/TOQHLrV2sfUMZD647HTHEJyF+2z1J1oR34LaB5jqHJ9d0REC+Cw==";
    };
    x86_64-linux = {
      name = "cli-linux-x64-gnu";
      hash = "sha512-WY8vy2Saa3oRt6XEmz4Sae1W5qS9TjYcbX6IE+dxb8s2APfL9XyQjMHC6jBZrhwqDBIvUeTMCT/P2cq3XLPSBw==";
    };
  };
  spec = sources.${stdenv.hostPlatform.system} or (throw "agent-browser ${version} has no binary for ${stdenv.hostPlatform.system}");
  binary = stdenv.mkDerivation {
    pname = "agent-browser";
    inherit version;
    src = fetchurl {
      url = "https://registry.npmjs.org/@agent-browser/${spec.name}/-/${spec.name}-${version}.tgz";
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
      install -m755 package/bin/agent-browser $out/bin/agent-browser
    '';
    meta.mainProgram = "agent-browser";
  };
in
plugin {
  id = "agent-browser";
  summary = "agent-browser ${version}. Chrome for Testing is downloaded by `agent-browser install` into the user directory, not into git.";
  runtimeInputs = [ binary ];
  mainProgram = "agent-browser";
  installPhase = ''
    ln -s ${binary}/bin/agent-browser $out/bin/agent-browser
  '';
  passthru = { inherit binary version; };
}
