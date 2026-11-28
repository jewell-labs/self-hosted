{ stdenv }:
stdenv.mkDerivation {
  pname = "selfhost-syncio";
  version = "0.1.0";
  src = builtins.path {
    path = ../core/runtime;
    name = "selfhost-runtime";
    filter = path: type:
      let base = baseNameOf path; in
      base != "txiki" && base != "syncio.dylib" && base != "syncio.so";
  };
  dontConfigure = true;
  buildPhase = ''
    if [ "$(uname -s)" = Darwin ]; then
      cc -O2 -fPIC -dynamiclib -o syncio.dylib syncio.c
    else
      cc -O2 -fPIC -shared -o syncio.so syncio.c
    fi
  '';
  installPhase = ''
    mkdir -p $out/lib
    cp syncio.dylib $out/lib/syncio.dylib 2>/dev/null || cp syncio.so $out/lib/syncio.so
  '';
}
