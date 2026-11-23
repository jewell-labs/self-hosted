{ lib, runCommand, packages }:
let
  ids = [
    "baseline"
    "mcp"
    "llama"
    "decision"
    "cloudflared"
    "sshd"
    "github-repos"
    "agent-desktop"
    "agent-browser"
    "simulators"
    "portless"
  ];
in
runCommand "selfhost-plugins-check"
  {
    nativeBuildInputs = [ packages.agent-desktop packages.agent-browser ];
  }
  ''
    set -eu
    export HOME=$TMPDIR/home
    mkdir -p "$HOME"
    ${lib.concatMapStringsSep "\n" (id: ''
      ${packages.${id}}/bin/setup
      ${packages.${id}}/bin/check
    '') ids}
    ${packages.actions-runner}/bin/check
    agent-desktop version | grep -q '1.3.1'
    agent-browser --version | grep -q '0.43.0'
    test -x ${packages.llama}/bin/llama-server
    test -d ${packages.actions-runner}/libexec/actions-runner
    grep -q 'PasswordAuthentication no' ${packages.sshd}/share/selfhost/sshd_config.template
    grep -q 'ListenAddress 127.0.0.1' ${packages.sshd}/share/selfhost/sshd_config.template
    grep -q 'interval_seconds=' ${packages.github-repos}/share/selfhost/config
    if grep -q 'REPOS=' ${packages.github-repos}/share/selfhost/ghref; then
      echo "ghref hardcodes a repo list" >&2
      exit 1
    fi
    if grep -q 'BEGIN OPENSSH PRIVATE KEY' \
      ${packages.sshd}/share/selfhost/sshd_config.template \
      ${packages.github-repos}/share/selfhost/ghref \
      ${packages.github-repos}/share/selfhost/config
    then
      echo "a plugin package contains a private key" >&2
      exit 1
    fi
    touch "$out"
  ''
