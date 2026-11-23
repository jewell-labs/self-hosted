{ plugin, self, openssh, lib }:
let
  template = builtins.readFile "${self}/plugins/sshd/sshd_config.template";
in
assert lib.hasInfix "ListenAddress 127.0.0.1" template;
assert lib.hasInfix "PasswordAuthentication no" template;
assert lib.hasInfix "Port 2222" template;
plugin {
  id = "sshd";
  summary = "Userland sshd on 127.0.0.1:2222. Passwords off. Trusts a Cloudflare Access SSH CA that stays outside git.";
  runtimeInputs = [ openssh ];
  installPhase = ''
    install -m644 ${self}/plugins/sshd/sshd_config.template $out/share/selfhost/sshd_config.template
    ln -s ${openssh}/bin/sshd $out/bin/sshd
  '';
}
