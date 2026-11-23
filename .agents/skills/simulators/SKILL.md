---
name: simulators
description: Claim and use every iOS simulator this host has. Use when a run needs a simulator, a boot, or a local URL on a device.
---

Call `simulators.list`. Use every device it returns. An empty `available` list means this host has no simulators. Do not invent a udid, a runtime, or a device name.

`simulators.boot`, `simulators.shutdown`, and `simulators.openurl` are destructive and need a Cloudflare Access JWT. `openurl` accepts a local `http` or `https` address from `portless.urls`. Do not boot a simulator that is not in the list.
