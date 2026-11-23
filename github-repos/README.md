# github-repos

`config` is the only repo list and the only sync interval. `ghref` reads that file.

`just repos` prints the list. `just sync` mirrors it under `~/.self-hosted/github` and locks that tree read-only. `just explore` shows each checkout without fetching. `ghref install` writes a LaunchAgent because launchd only loads `~/Library/LaunchAgents`.
