{ stdenv, fetchurl, plugin, pins }:
let
  version = pins.actions-runner;
  sources = {
    aarch64-darwin = {
      asset = "actions-runner-osx-arm64-${version}.tar.gz";
      hash = "sha256-JaBlr0Cf+jF6tNWjthTdFfycQPIXK8GzWhsSWOkZo4g=";
    };
    x86_64-darwin = {
      asset = "actions-runner-osx-x64-${version}.tar.gz";
      hash = "sha256-EJ//UFo0AUp+jRrLhQwz1ASBEQL1crj7l4ji//ATzEk=";
    };
    aarch64-linux = {
      asset = "actions-runner-linux-arm64-${version}.tar.gz";
      hash = "sha256-ZwrbLyaP4h3LtYs9sOCqnVs73f4sZRSBM25WH/ht6UU=";
    };
    x86_64-linux = {
      asset = "actions-runner-linux-x64-${version}.tar.gz";
      hash = "sha256-uuvyBDB7rGGTSAhScy8Kuirpe2xVl8JE9NVVg5AUfEA=";
    };
  };
  spec = sources.${stdenv.hostPlatform.system} or (throw "actions-runner ${version} has no archive for ${stdenv.hostPlatform.system}");
  archive = fetchurl {
    url = "https://github.com/actions/runner/releases/download/v${version}/${spec.asset}";
    hash = spec.hash;
  };
in
plugin {
  id = "actions-runner";
  summary = "GitHub Actions self-hosted runner. Refuses a public repository unless the operator overrides it.";
  installPhase = ''
    mkdir -p $out/libexec/actions-runner
    tar -xzf ${archive} -C $out/libexec/actions-runner
  '';
}
