// ЦИК presidential-elections fingerprint source.
//
// ⚠ A SEPARATE SOURCE, NOT A KIND ON `cik_results`, and the reason is the orchestrator rather
// than the data. `process-watch-report`'s map couples every `cik_results` flip to
// `update-persons` and `db:load:person-elections:pg` — and that loader reads the PARLIAMENTARY
// candidate files. A presidential flip routed through it would either stall on a tree it
// cannot read or silently skip the new cycle, so the plan (T7.2) puts this on its own id and
// routes it to `update-presidential-elections` alone.
//
// ⚠ THE SLUG IS DISCOVERED, NOT ASSUMED, because ЦИК has never repeated one: `prezident2001`,
// `pvr2006`, `mipvr2011` (shared with that year's local elections), `pvrnr2016`, `pvrns2021`.
// The suffix encodes what else was on the ballot — `nr` a national referendum, `ns` a snap
// parliamentary vote — so the 2026 slug is unknowable in advance and a hard-coded guess is a
// watcher that reports „no change" through an entire election. The pattern below matches the
// family; the CATALOGUE of already-ingested cycles is what tells a new one from an old one.
//
// ⚠ ROUND 2 IS ITS OWN SIGNAL HERE, unlike the local partials — for TWO reasons, and the
// second is the decisive one. ЦИК serves a populated `tur2/` navigation shell even for cycles
// that never have a runoff, so its presence proves nothing; and a local partial publishes NO
// ARCHIVE AT ALL (`cik_results.ts` carries `bundleUrl: ""` for them — „HTML-only, nothing to
// HEAD"), so there is no object whose existence could be probed. A presidential cycle
// publishes a real archive, so HEADing it IS the answer and no date arithmetic is needed.
//
// ⚠ THAT HOLDS PER CYCLE, NOT UNIFORMLY. 2016 and 2001 ship ONE archive covering both rounds,
// so „round 2 exists" is not independently observable there: 2016's `tur2/export.zip` returns
// 200 while serving round 1's bytes (identical md5), and 2001 has no per-round URL at all.
// `roundUrl` returns the same URL for both rounds in those cycles, the fingerprint loop HEADs
// it once, and the „separate round-2 bundle" count excludes them — otherwise the report would
// claim a runoff bundle that is a duplicate of round 1's.
//
// ⚠ AND THE SIBLING TEACHES A THIRD THING THIS FILE HAD TO LEARN TWICE: wherever an archive
// exists it keeps a per-cycle URL map, because ЦИК has renamed the archive every cycle. See
// `roundUrl()`.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";
import { cikFetchText, cikHead } from "../../parsers_local/cik_fetch";
import {
  PRESIDENTIAL_SOURCES,
  presidentialSource,
} from "../../parsers_presidential/sources";

const ROOT = "https://results.cik.bg";
const SOURCE_ID = "cik_presidential";

/** ЦИК's presidential archive slugs, as they appear in the root index.
 *
 *  ⚠ TWO STEMS, NOT ONE, AND THE SECOND IS WHY THIS PATTERN IS TESTED AGAINST THE INGEST'S OWN
 *  TABLE. A first cut matched `pvr` alone — which is right for four of the five and silently
 *  drops `prezident2001`, the cycle ЦИК archived before it settled on the abbreviation. The
 *  test derives its cases from `PRESIDENTIAL_SOURCES` rather than a retyped list, which is how
 *  that was caught: a hand-written „the real five" would have repeated the same assumption.
 *
 *  ⚠ IT MUST NOT MATCH `mi2023` OR `ns2024`. The stem is the discriminator — no other family's
 *  archive carries either — and the optional letters between it and the year are the „what
 *  else was on the ballot" suffix (`nr` a national referendum, `ns` a snap parliamentary
 *  vote). The leading `[a-z]*` catches `mipvr2011`, the one cycle whose slug leads with the
 *  LOCAL family it shared a day with. */
const SLUG_RE =
  /(?<![A-Za-z0-9_])([a-z]*(?:pvr|prezident)[a-z]*_?(\d{4}))(?![A-Za-z0-9])/g;

/** The slugs this repo has already ingested — the baseline a discovery is new against. */
const KNOWN_SLUGS = new Set(
  Object.values(PRESIDENTIAL_SOURCES).map((s) => s.slug),
);

type RoundFingerprint = {
  round: 1 | 2;
  url: string;
  /** ⚠ `true` MEANS A 404 PROVES NOTHING. For a slug this repo has never ingested there is no
   *  catalogue entry, so the URL is a template guess — and „not published yet" and „published
   *  under a name we did not guess" are indistinguishable at that point. Recorded so the
   *  report can say which it is looking at. */
  guessedUrl: boolean;
  status: number;
  lastModified: string | null;
  contentLength: string | null;
};

type CycleFingerprint = {
  slug: string;
  year: string;
  /** ⚠ Whether THIS REPO has the cycle, not whether ЦИК does. A slug the index has always
   *  carried is not news; the first slug it carries that we have never ingested is. */
  known: boolean;
  rounds: RoundFingerprint[];
};

type CikPresidentialMeta = {
  cycles: CycleFingerprint[];
  discoveredAt: string;
};

/** Every presidential slug in ЦИК's root index. */
export const discoverSlugs = (
  html: string,
): { slug: string; year: string }[] => {
  const found = new Map<string, string>();
  for (const m of html.matchAll(SLUG_RE)) found.set(m[1], m[2]);
  return [...found]
    .map(([slug, year]) => ({ slug, year }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
};

/**
 * Which archive a round's bundle actually is.
 *
 * ⚠⚠ THE TEMPLATE IS THE FALLBACK, NOT THE RULE, and a first cut had it the other way round.
 * ЦИК has used a DIFFERENT ARCHIVE NAME IN EVERY CYCLE — `export.zip`, `el2011_t1.zip`,
 * `export_t1.zip`, `2001_prezident.zip` — and 2006 is on a different HOST entirely
 * (`pvr2006.cik.bg`). Measured, `tur{n}/export.zip` is wrong for SEVEN of the ten (cycle,
 * round) pairs this repo has ingested, so 2011, 2006 and 2001 recorded 404 on both rounds
 * for ever: `describe()`'s „published" and „re-uploaded" branches both require a 200, which
 * killed re-upload detection on three of five cycles while the report read healthy.
 *
 * ⚠ TWO ROUNDS MAY NAME ONE ARCHIVE — 2016 and 2001 ship both rounds in a single file — so
 * the caller de-duplicates by URL rather than issuing the same HEAD twice and reporting two
 * bundles where ЦИК published one.
 *
 * The sibling source already learned this: `cik_results.ts` keeps a per-cycle
 * `REGULAR_BUNDLE_URL` map precisely because „the bundle URL is NOT a uniform csv.zip".
 */
export const roundUrl = (
  slug: string,
  round: 1 | 2,
): { url: string; guessedUrl: boolean } => {
  const src = presidentialSource(slug);
  const archive = src?.archives[src.rounds[round]?.archive ?? ""];
  return archive
    ? { url: archive.url, guessedUrl: false }
    : { url: `${ROOT}/${slug}/tur${round}/export.zip`, guessedUrl: true };
};

const fingerprintRound = async (
  round: 1 | 2,
  url: string,
  guessedUrl: boolean,
): Promise<RoundFingerprint> => {
  const head = await cikHead(url);
  return {
    round,
    url,
    guessedUrl,
    status: head.status,
    lastModified: head.lastModified,
    contentLength: head.contentLength,
  };
};

export const cikPresidential: WatchSource = {
  id: SOURCE_ID,
  label: "ЦИК presidential-elections results bundles",
  url: `${ROOT}/`,
  // ⚠ DAILY, DESPITE A FIVE-YEAR CYCLE. What this watches is not the election, it is the
  // PUBLISH: round 1's bundle appears within days of the vote and round 2's about a week
  // after that, and the 2021 bundle was dated four days after election day. A cadence tuned
  // to the election would miss the whole publication window.
  cadence: "daily",
  publishes: "irregular",

  async fingerprint(): Promise<Fingerprint> {
    // ⚠⚠ AN UNREACHABLE INDEX THROWS. `allow404` returns null on an outage, and a first cut
    // turned that into an empty slug list — which the runner classifies as CHANGED, not as an
    // error, so `describe()` emitted „prezident2001: no longer listed by ЦИК" for all five
    // cycles and the state was then overwritten, destroying the round baseline. That is the
    // exact failure this file's header promises to prevent. Fifteen sibling sources already do
    // this (`adfi_inspections.ts`: „Unreachable is not „no inspections"").
    const html = await cikFetchText(`${ROOT}/index.html`, { allow404: true });
    if (!html)
      throw new Error("ЦИК results index unreachable — a probe failure");
    const slugs = discoverSlugs(html);
    if (!slugs.length)
      throw new Error(
        "ЦИК results index carries no presidential slug — page shape changed",
      );
    const fps: CycleFingerprint[] = [];
    for (const { slug, year } of slugs) {
      // Serialised on purpose — Cloudflare rate-limits concurrent requests more aggressively
      // than sequential ones, the same reason `cik_results` HEADs its bundles in a loop.
      const rounds: RoundFingerprint[] = [];
      // ⚠ ONE HEAD PER DISTINCT ARCHIVE. 2016 and 2001 ship both rounds in a single file, so
      // asking twice is a wasted Playwright request against the runner's per-source budget —
      // and it would report two bundles where ЦИК published one.
      const seen = new Map<string, RoundFingerprint>();
      for (const round of [1, 2] as const) {
        const { url, guessedUrl } = roundUrl(slug, round);
        const hit = seen.get(url);
        rounds.push(
          hit
            ? { ...hit, round }
            : await (async () => {
                const fp = await fingerprintRound(round, url, guessedUrl);
                seen.set(url, fp);
                return fp;
              })(),
        );
      }
      fps.push({ slug, year, known: KNOWN_SLUGS.has(slug), rounds });
    }
    // ⚠ `known` IS NOT IN THE HASH. It is a fact about THIS REPO — whether the cycle has been
    // ingested — so hashing it makes ingesting a cycle look like an upstream change, reported
    // on the next run with nothing in `describe()` able to explain it. The fingerprint answers
    // „did ЦИК move" and nothing else; `known` rides in the meta, where the report reads it.
    const value = sha256Short(
      fps
        .map(
          (c) =>
            `${c.slug}\t` +
            c.rounds
              .map(
                (r) =>
                  `t${r.round}:${r.status}:${r.lastModified ?? ""}:${r.contentLength ?? ""}`,
              )
              .join("\t"),
        )
        .join("\n"),
    );
    const unknown = fps.filter((c) => !c.known);
    // ⚠ „A ROUND-2 BUNDLE" MEANS A DISTINCT ONE. 2016 and 2001 ship both rounds in a single
    // archive, so a round-2 HEAD that 200s there is round 1's file — counting it would
    // publish „N cycles have a runoff bundle" about a file that is not one.
    const withRound2 = fps.filter((c) =>
      c.rounds.some(
        (r) =>
          r.round === 2 &&
          r.status === 200 &&
          r.url !== c.rounds.find((x) => x.round === 1)?.url,
      ),
    );
    const guessed = fps.filter((c) => c.rounds.some((r) => r.guessedUrl));
    const detail =
      `${fps.length} presidential cycle(s) in the index · ${unknown.length} not yet ingested · ` +
      `${withRound2.length} with a separate round-2 bundle` +
      // ⚠ NAMED, because a 404 on a guessed URL is not evidence of anything: „not published
      // yet" and „published under a name we did not guess" look identical, and ЦИК has used a
      // different archive name in every single cycle.
      (guessed.length ? ` · ${guessed.length} with a GUESSED archive URL` : "");
    const meta: CikPresidentialMeta = {
      cycles: fps,
      discoveredAt: new Date().toISOString(),
    };
    return { value, detail, meta: meta as unknown as Record<string, unknown> };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    // ⚠⚠ THE PERSISTED META IS GUARDED, NOT ASSUMED. `prev.meta` is a double-cast over a file
    // a PREVIOUS BUILD wrote, and `types.ts` names this exact trap: `describe()` runs inside
    // the runner's try, and the catch deliberately skips the state write — so one unguarded
    // read of a shape that has since changed makes this source error on every run FOR EVER,
    // until someone deletes `state/watch/cik_presidential.json` by hand. Both fixes in this
    // very step change the meta shape, so it is reachable rather than theoretical.
    const cyclesOf = (m: unknown): CycleFingerprint[] => {
      const cs = (m as CikPresidentialMeta | undefined)?.cycles;
      return Array.isArray(cs) ? cs : [];
    };
    const roundsOf = (c: CycleFingerprint | undefined): RoundFingerprint[] =>
      Array.isArray(c?.rounds) ? c.rounds : [];
    const prevCycles = cyclesOf(prev?.meta);
    const currCycles = cyclesOf(curr.meta);
    const prevBySlug = new Map(prevCycles.map((c) => [c.slug, c]));
    const changed: string[] = [];
    for (const c of currCycles) {
      const p = prevBySlug.get(c.slug);
      if (!p) {
        // ⚠ A NEW SLUG IS THE HEADLINE ONLY WHEN WE DO NOT HAVE IT. ЦИК's index gains rows
        // for reasons of its own; „a presidential archive we have never ingested" is the one
        // that means an election happened.
        changed.push(
          c.known
            ? `${c.slug}: newly listed`
            : `${c.slug}: NEW CYCLE ${c.year} — not ingested`,
        );
        continue;
      }
      for (const r of roundsOf(c)) {
        const pr = roundsOf(p).find((x) => x.round === r.round);
        if (!pr) continue;
        // A round appearing is the publish; a round CHANGING is a re-upload, and ЦИК
        // re-uploads corrected bundles — both are re-ingest triggers.
        // ⚠ A TRANSIENT HEAD FAILURE IS NOT A PUBLISH AND NOT A WITHDRAWAL. `cikHead` returns
        // `status: 0` when the request itself failed, and treating that as „gone" (or its
        // recovery as „published") reports an upstream event that never happened.
        if (pr.status === 0 || r.status === 0) continue;
        if (pr.status !== 200 && r.status === 200)
          changed.push(
            r.guessedUrl
              ? `${c.slug} tur${r.round}: bundle published (URL guessed)`
              : `${c.slug} tur${r.round}: bundle published`,
          );
        else if (
          r.status === 200 &&
          (pr.lastModified !== r.lastModified ||
            pr.contentLength !== r.contentLength)
        )
          changed.push(`${c.slug} tur${r.round}: bundle re-uploaded`);
      }
    }
    // ⚠ A DISAPPEARANCE IS REPORTED, NOT SWALLOWED. A slug leaving the index while we hold
    // its data is not a re-ingest trigger, but it is the kind of thing an operator wants to
    // hear about before a link on the site starts 404ing.
    for (const p of prevCycles)
      if (!currCycles.some((c) => c.slug === p.slug))
        changed.push(`${p.slug}: no longer listed by ЦИК`);
    return changed.length ? changed.join("; ") : (curr.detail ?? "no change");
  },
};
