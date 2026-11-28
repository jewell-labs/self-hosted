{ plugin, self, lib, git, gh, bash }:
let
  script = builtins.readFile "${self}/../github-repos/ghref";
  config = builtins.readFile "${self}/../github-repos/config";
in
assert !lib.hasInfix "REPOS=" script;
assert !lib.hasInfix "900" script;
assert lib.hasInfix "interval_seconds=" config;
plugin {
  id = "github-repos";
  summary = "Sync the repos named in github-repos/config. The sync interval is interval_seconds in that file.";
  runtimeInputs = [ git gh bash ];
  installPhase = ''
    install -m755 ${self}/../github-repos/ghref $out/share/selfhost/ghref
    install -m644 ${self}/../github-repos/config $out/share/selfhost/config
    ln -s $out/share/selfhost/ghref $out/bin/ghref
  '';
}
