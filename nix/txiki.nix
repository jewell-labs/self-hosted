# Linux (and a Nix-built macOS) txiki.js. Upstream publishes no Linux zip.
# The fetch hash is a placeholder. The first build fails and prints the real hash.
{ lib, stdenv, fetchFromGitHub, cmake, pkg-config, libffi, git }:
stdenv.mkDerivation {
  pname = "txiki";
  version = "26.11.0";
  src = fetchFromGitHub {
    owner = "saghul";
    repo = "txiki.js";
    rev = "v26.11.0";
    fetchSubmodules = true;
    hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  };
  nativeBuildInputs = [ cmake pkg-config git ];
  buildInputs = [ libffi ];
  cmakeFlags = [
    "-DBUILD_WITH_MIMALLOC=ON"
    "-DBUILD_WITH_FFI=ON"
  ];
  installPhase = ''
    mkdir -p $out/bin
    cp tjs $out/bin/tjs
    chmod 755 $out/bin/tjs
  '';
  meta = {
    description = "txiki.js, the self-hosted tool runtime";
    mainProgram = "tjs";
    platforms = lib.platforms.unix;
  };
}
