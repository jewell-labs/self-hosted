---
name: agent-desktop
description: Use the agent-desktop macOS sandbox. Use when a run needs the guest, a bridge, or a screenshot from the sandbox.
---

Call `agent-desktop.setup`. The first macOS guest needs a person to finish Setup Assistant, run guest-setup.sh, and grant Accessibility. Do not start a second sandbox.

A browser in the guest opens the `guest` line and the resolver rule from `portless.urls`. If the guest is down, there is no VM bridge. Use host agent-browser. The guest network is not isolated.
