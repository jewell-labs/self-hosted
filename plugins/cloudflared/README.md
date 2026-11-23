# cloudflared

The tunnel token stays in a mode `0600` file, `~/.cloudflared/token` by default. `run-tunnel.sh` checks that mode and starts `cloudflared tunnel run --token-file`.

A typical Access SSH companion on the same host is a userland `sshd` bound to `127.0.0.1:2222` with `PasswordAuthentication no` and `TrustedUserCAKeys` set to the Cloudflare Access SSH CA (`open-ssh-ca@cloudflareaccess.org`). The tunnel forwards SSH to that port. The CA public key and host key stay on the machine, not in this repo.

Install from the discover result:

```sh
node bin/setup.mjs cloudflared
node bin/check.mjs cloudflared
```
