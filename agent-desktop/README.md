# agent-desktop

Isolated package. Dependencies live in this directory, except `core/`. Assets are declared in `plugin.json` and are separate from this code.

Set yourself up with `node agent-desktop/setup.mjs`. Tear yourself down with `node agent-desktop/teardown.mjs`. Teardown leaves assets in place. The base event is the healthcheck.

The store is `~/.self-hosted/agent-desktop`. A launch sets `AGENT_DESKTOP_HOME` to that real directory. `~/.agent-desktop` stays absent.
