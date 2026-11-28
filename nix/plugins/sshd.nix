{ plugin, self, openssh, lib }:
let
  template = builtins.readFile "${self}/../sshd/sshd_config.template";
in
assert lib.hasInfix "ListenAddress 127.0.0.1" template;
assert lib.hasInfix "PasswordAuthentication no" template;
assert lib.hasInfix "port {sshd}" template;
assert lib.hasInfix "Port {{port}}" template;
plugin {
  id = "sshd";
  summary = "Userland sshd on port {sshd}. Passwords off. Trusts a Cloudflare Access SSH CA that stays outside git.";
  runtimeInputs = [ openssh ];
  installPhase = ''
    install -m644 ${self}/../sshd/sshd_config.template $out/share/selfhost/sshd_config.template
    ln -s ${openssh}/bin/sshd $out/bin/sshd
  '';
}
