# Contributing

Issues and PRs welcome.

## Inbound = outbound

By opening a pull request you agree that your contribution is licensed under the same terms as
the file it touches — for code, specifications and this project's own output, that is the MIT
grant in [LICENSE](LICENSE) §1. No copyright assignment is asked for and no CLA has to be
signed; you keep your copyright, and the project gets the same licence everyone else already
has.

If a contribution includes material you did not write — a vendored dependency, a font, a chunk
of someone else's document — say so in the PR and name its licence. It belongs in
[LICENSE](LICENSE) §3, not under the MIT default.

## Before you open a PR

- **SPA changes**: `npm run lint && npm run build`, then `npm test` (Playwright). Lint is part
  of `predeploy`, so a lint failure blocks deploys.
- **Data-pipeline changes**: run `npm run prod` locally and diff the resulting JSON against
  `git`. The roll-call ingest has a canary regression fixture at
  `tests/fixtures/parliament/votes/canary.json` — `npm run rollcall:scrape` validates against it
  and fails loud if the parser drifts.
- **New upstream sources**: add a module under `scripts/watch/sources/` following the existing
  pattern, then a sibling `/update-<source>` skill under `.claude/skills/` for the ingest. See
  `.claude/skills/process-watch-report/SKILL.md` for the orchestrator's full source→skill
  mapping and per-skill data-integrity contracts.

Open PRDs and roadmap items live under `docs/plans/`.

## Changes to the risk methodology

The procurement risk flags are a **published, versioned artifact**, not private implementation
detail — see [METHODOLOGY.md](METHODOLOGY.md). A change to a flag's definition, threshold,
weight, bit position or label is a change to a public specification. Two rules follow:

1. **The catalogue is the source.** Do not hand-edit a flag constant in a scorer, a SQL
   migration, or an i18n corpus. Change it once in the catalogue and re-run the generator; the
   drift gate exists so that a hand-edit fails rather than quietly diverging.
2. **Bit positions are append-only.** Historic masks re-map silently if a bit is renumbered, so
   a renumber is a major version bump and needs a full cache rebuild before any reader sees a
   mask.

## What the flags are not

A fired flag is not an accusation, and anything built on this data inherits that framing. See
[LICENSE](LICENSE) §5 — it is written to travel with reuse, and weakening it for brevity is not
a stylistic call.
