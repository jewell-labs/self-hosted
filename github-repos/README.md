# github-repos

`config` is the only repo list and the only sync interval. `ghref` reads that file.

`repos` prints the list. `sync` mirrors it under `~/.self-hosted/github-repos` and locks that tree read-only. `explore` shows each checkout without fetching. `ghref install` writes a LaunchAgent because launchd only loads `~/Library/LaunchAgents`.
