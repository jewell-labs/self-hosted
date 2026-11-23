---
name: sshd
description: Write the userland sshd unit. Keys and the CA stay outside git.
---

Call `sshd.setup`, then `sshd.check`. Do not commit the CA, host key, or principals.
