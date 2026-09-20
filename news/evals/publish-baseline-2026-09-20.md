# Phase 4.1–4.5 — what the current publish path costs (2026-09-20)

Plan: `docs/plans/news-jev-realtime-cloud-worker-v1.md` §4.1–4.5. Tool:
`news/scripts/measure_publish_baseline.py`. Measured against the live
bucket over the hourly releases of 2026-09-20. Before this, the baseline was
a single 2026-09-02 data point.

Raw: `news/data/_perf/publish-baseline.json` (gitignored).

## Per release

| | |
| --- | --- |
| objects written | **65** + 1 manifest CAS = **66 PUTs** |
| payload | **37.2 MB** uncompressed, **8.1 MB** stored (gzipped) |
| storage added | 37.2 MB — **0.89 GB/day, 26.8 GB/month** at hourly cadence |
| version trees now in the bucket | **18**, and there is still no lifecycle rule (§0.1 R5) |

## 4.1 — what actually changes, and the trap in measuring it

**0 of 65 files are byte-identical between consecutive hourly releases.** Read
naively that says the overlay (§6.5) has nothing to save. It is the wrong
reading, for two compounding reasons:

**1. Every file carries the run's `generated_at`.** `taxonomy.json` differs
between two releases by **3 bytes**, `outlets.json` by 4 — a timestamp that is
already in the manifest. Strip the stamps and **30 of 65 files (46.2%) are
identical**, holding 7.83 MB of 37.20 MB (21.0%).

**2. A domain file is rewritten whole when one article is appended.** So a
file diff measures the rewrite, not the substance.

The number the overlay decision needs is the **record** delta:

| | |
| --- | --- |
| article records published | 9,104 |
| **new or changed in one hour** | **105 (1.15%)** |
| bytes of that delta | **584.5 KB** uncompressed (~130 KB at the measured 4.5× gzip) |
| files containing it | 27 of 57 |

**The overlay premise holds.** An hourly release rewrites 37.2 MB across 65
objects to convey 584 KB of new records. ⚠️ Note §6.5's acceptance is "2
objects and ≤100 KB": the measured delta is ~130 KB gzipped on a **quiet
night hour**, so the threshold is the right order of magnitude but should be
re-checked against a busy morning before it is written into a test.

⚠️ **A measurement artifact worth recording, because it reverses the
conclusion and nearly shipped.** The first cut of this fingerprinted each
object with the MD5 from `gsutil ls -L`. These objects are stored gzipped, and
gzip embeds a timestamp — so byte-identical content hashes differently every
release, and the diff reports 100% churn on files that never changed. The tool
now hashes the **transcoded content** a reader would receive. The file-level
100% survived that fix (it is genuine, via `generated_at`); the verdict did
not survive moving to the record level.

## 4.2 — timings

| run | bundles | home_health | archive rsync | version tree | meta | mentions | manifest |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 06:00 | 76 s | 1 s | 19.4 s | 3.6 s | 2.5 s | 11.4 s | 6.0 s |
| 07:00 | 73 s | 0 s | 32.2 s | 8.2 s | 4.3 s | **60.5 s** | 14.4 s |
| 08:00 | 21 s | 0 s | 33.7 s | 4.8 s | 2.7 s | 9.5 s | 2.5 s |

Two things stand out. **The private-archive rsync (19–34 s) is the single
largest upload scope** and is a cold-path-only cost (§6.4 item 4) — a hot
publish should not pay it. And the **mentions rsync is volatile**: 9.5–60.5 s
across three consecutive runs, a 6× spread that nothing currently explains and
that is worth watching in Phase 5 before it is designed around.

`bundles` dominates the non-upload side at 21–76 s.

## 4.3/4.4 — reader cost and gzip at rest, as numbers

Measured with `Accept-Encoding: gzip` and `identity` against the live objects:

| file | gzip (on the wire) | identity | ratio | stored |
| --- | ---: | ---: | ---: | --- |
| `home.json` | 13,514 B | 52,688 B | 3.9× | gzip |
| `latest.json` | 197,933 B | 849,508 B | 4.3× | gzip |
| `stories.json` | **1,437,392 B** | 6,491,009 B | **4.5×** | gzip |

`-z json` (shipped in Phase 1.5) is confirmed in place on every object, and
GCS transcodes correctly for a client that cannot take gzip. Corpus-wide the
ratio is **37.2 MB → 8.1 MB, 4.6×**.

⚠️ **`stories.json` is 1.4 MB gzipped, and a cold reader downloads all of
it.** That is by far the largest single object a reader touches, and it is ~11×
the size of the entire hourly record delta. Whatever happens to the overlay,
this file is the reader-cost story.

## 4.5 — operations and storage

66 PUTs per release. At hourly cadence that is 1,584 PUTs/day and **26.8
GB/month of new storage that nothing deletes** — 18 trees are already there.
A keep-last-K retention rule (§4.6e) is worth more than it looks: at this rate
the bucket grows ~0.9 GB/day indefinitely.

## Acceptance (plan §4.1–4.5)

| criterion | status |
| --- | --- |
| 4.1 sizes, per-file bytes, and which files changed | ✅ and corrected to a record-level basis |
| 4.2 timings per stage and per upload scope | ✅ |
| 4.3 reader cost measured, gzip and identity | ✅ |
| 4.4 gzip-at-rest as a figure | ✅ 4.6× corpus-wide |
| 4.5 GCS ops and storage per release | ✅ 66 PUTs, 37.2 MB |

## What this settles for 4.6

- **Build the overlay — the premise holds** at 1.15% of records per hour.
- **Re-check the ≤100 KB acceptance against a busy hour** before pinning it in
  a test; the quiet-hour delta is already ~130 KB gzipped.
- **Two cheap wins that are not the overlay, and should come first:**
  1. **Stop stamping `generated_at` into every file.** It is already in the
     manifest, and removing it makes 46% of files byte-stable between
     releases — which is what makes content addressing (§7.6 F2) possible at
     all. Today it is impossible by construction, for three bytes a file.
  2. **A retention rule.** 26.8 GB/month, unbounded.
- **Keep the archive rsync off the hot path** (19–34 s, the largest scope).
- **`stories.json` at 1.4 MB gzipped deserves its own look** — bigger than
  everything the overlay would save.
