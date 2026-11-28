---
name: decision-model-recommender
description: Recommend at most one decision model that fits the host holding the weights, sample it against the fleet, and keep or remove it.
---

Call `decision.models`, `decision.usage`, and `decision.config` on the host that holds the weights before choosing. When the agent sits on another machine, the limits and the library still come from that host. `decision.config` takes an id from `decision.models`. An empty catalog has no id. Record that and do not invent one. `home/policy.json` is the disk reserve, the download cap, and the probe text. Read a current public decision leaderboard that ranks more than one model, and record its URL and the as-of date on that page. For the highest-ranked challenger and the closest challenger on that page, label the library `resident`, `sidecar`, or `absent` by the role check. Write their four fit marks from a GGUF listing or a content-length fetched in this run. Do not invent a leaderboard number.

The size class is that host's `memGb`. Decision `slots` come from that same `memGb`. A host-class file is one single `.gguf` under the resident ceiling. When `memGb` is above 8, that file is also larger than 8 GiB. An 8 GB-class file is an alternate for a smaller machine. It is the download only when no host-class file passes max, disk, and resident. Measure the smallest 4-bit single file that fits the ceiling, preferring `Q4_K_M` when the repo publishes one. A smaller quant is that alternate, not the choice, when the 4-bit file fits. A shard set is not a single file.

Recommend at most one GGUF of a decision model, not a chat model that shares the name. It has to fit `freeBytes - reserveBytes`, `maxDownloadBytes`, currently free memory, and that host's decision `slots`. The download reads the whole file into memory before it renames. A leader with no single GGUF is not a recommendation. A file that misses any mark is not a recommendation. One shared library. Do not write a second weight directory. Account for every model the board ranks above the baseline: record its GGUF bytes, or skip it because this run already measured that repo, or because its listing has no single `.gguf`, or because this run's search returned no public repository for that name. If none qualifies, stop. Do not download, sample, or remove.

`decision.download` writes a qualifying file into that library and the host catalog. The repo catalog stays unchanged.

Call `decision.sample` only for that downloaded id, with `seed` set to the UTC hour plus the model id. The probes are chat completions. The tool does not start the router. A decision model that does not serve chat fails them. That failure is not a quality result, so do not remove the id because of it.

`keep: true` means leave it. `keep: false` after the probes actually ran means call `decision.remove` on the downloaded id before you finish. Call `decision.remove` on another id only when `replace` names it. A compound that still names an id blocks removal.

After the comparison, score the recommendation from its record. One point per check. Report the total out of 10 and every miss by name.

- limits: `freeBytes`, `reserveBytes`, `maxDownloadBytes`, free memory, `memGb`, and the profile or the slot count, from this run on the host that holds the weights.
- board: the leaderboard URL and the as-of date on a page that ranks more than one model.
- baseline: the resident model to beat, its bytes from `models`, and its index on that page. A catalog of length 0 counts together with the config error. A config error on a real id counts only together with a second id's config result.
- measured: every size used to reject a challenger is a byte count from a GGUF listing or a content-length fetched in this run. A listing fetched in this run with no `.gguf` file is a measured rejection.
- coverage: every model ranked above the baseline is measured, or skipped because this run already measured that repo, or because its listing has no single `.gguf`, or because this run's search returned no public repository for that name.
- fit: the highest-ranked challenger and the closest challenger above the baseline each have four marks from the size in the record. A listing with no `.gguf` fails every mark. Max passes at size ≤ `maxDownloadBytes`. Disk passes at `freeBytes - size` ≥ `reserveBytes`. Memory passes at size ≤ free memory. Resident passes at size < `memGb` × 2^30. With no catalogued baseline, any passer beats it.
- action: `none` when the record has no challenger that beats the baseline and passes every mark present. Otherwise one download, and the record names that file. The 8 GB-class file stays the alternate while a host-class file that beats the baseline passes max, disk, and resident.
- tools: `none` means download, sample, and remove were not called. A download is sampled. Removal follows `keep` and `replace` only after the probes ran.
- role: catalog length is recorded. For the highest-ranked challenger and the closest challenger, the record says `resident`, `sidecar`, or `absent`. A library file whose name contains the model slug is `resident` when its bytes are in the same order of magnitude as the listing, and `sidecar` when they are not. Resident is not a new download. A sidecar is not the baseline. A chat file is not the recommendation.
- arithmetic: the reported total equals the number of checks that passed.
