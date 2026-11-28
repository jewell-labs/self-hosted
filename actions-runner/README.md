# actions-runner

Isolated package. Dependencies live in this directory, except `core/`. Assets are declared in `plugin.json` and are separate from this code.

Set yourself up with `node actions-runner/setup.mjs`. Tear yourself down with `node actions-runner/teardown.mjs`. Teardown leaves assets in place. The base event is the healthcheck.
