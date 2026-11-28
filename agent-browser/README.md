# agent-browser

Isolated package. Dependencies live in this directory, except `core/`. Assets are declared in `plugin.json` and are separate from this code.

Set yourself up with `node agent-browser/setup.mjs`. Tear yourself down with `node agent-browser/teardown.mjs`. Teardown leaves assets in place. The base event is the healthcheck.
