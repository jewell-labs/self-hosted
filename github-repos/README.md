# github-repos

`config` is the only list of reference repos and the only sync interval. `ghref` reads that file. It does not keep a second copy of either value.

```sh
github-repos/ghref                 # sync ~/github, then lock it read-only
github-repos/ghref new org/repo branch
github-repos/ghref install         # LaunchAgent StartInterval from config
github-repos/ghref uninstall
```

`install` writes the LaunchAgent and points `~/.local/bin/ghref` at this script. The plist is generated. Change the interval or the repo list in `config`, commit it, and run `install` again.
