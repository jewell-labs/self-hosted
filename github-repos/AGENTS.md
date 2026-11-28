# github-repos

This package runs in isolation. Its code and dependencies live in this directory. The only code outside this directory it may use is `core/`.

Assets are the installs, downloads, and heavy files declared in `plugin.json`. They are not code. The home asset `assets` holds the payload file. Setup writes runtime state under `run/` and does not replace asset bytes. Teardown removes `run/` and leaves every asset in place.

Events are declared in `event.json` and `plugin.json`. The base event is the healthcheck.

When asked to set yourself up, reply with only this JSON and no other text:

{"command":"node github-repos/setup.mjs"}

When asked to tear yourself down, reply with only this JSON and no other text:

{"command":"node github-repos/teardown.mjs"}
