# work

Isolated package. Dependencies live in this directory, except `core/`. Assets are declared in `plugin.json` and are separate from this code.

Set yourself up with `node work/setup.mjs`. Tear yourself down with `node work/teardown.mjs`. Teardown leaves assets in place. The base event is the healthcheck.

`work.clean` removes work directories older than 3 days whose harness is not running. `core/lib/services.mjs` describes `com.jewell-labs.routines` for a daily tick. That LaunchAgent is not installed.

Harness commands in the self-hosted bin directory are regular files. Setup writes the same script under this package's home and under `bin/`.
