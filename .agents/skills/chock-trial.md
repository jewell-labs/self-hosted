This Chock block set is in development. It is not a catalog plugin. If it stays, it belongs in an isolated plugin, separate from the host plugins. Whether it is worth the context it adds is undecided.

`node bin/chock-usage.mjs [sessions-dir]` prints the byte size of each skill and, when a sessions directory is passed, how often each id appears there. That is the usage record. A large file that shows up in many sessions is the bottleneck signal. A file that never shows up is unused. The command does not decide which of those it is.

These files do not intercept a tool call. The Chock hooks are not installed.
