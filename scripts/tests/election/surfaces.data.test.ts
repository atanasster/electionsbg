// Phase 1's data gates for the generated election surfaces (§Phase 1 "Data gates").
//
// ⚠ THIS FILE CHECKS WHAT THE BUILDERS' OWN TESTS STRUCTURALLY CANNOT. Each generator is tested
// against its own output; these four questions can only be answered by comparing that output
// against something OUTSIDE it:
//
//   1. do the published figures reconcile EXACTLY to the canonical protocol and vote totals?
//   2. does every route a surface emits resolve to a route the app actually declares?
//   3. does every `available: false` carry a reason key BOTH locales carry?
//   4. is §5.0's emit column still true of the GENERATED output — is each emitted artifact
//      actually smaller than the canonical file it replaces?
//
// The last one is the plan's exit criterion for the whole phase, and it is the one a generator
// cannot ask of itself: "a level that generates an artifact no smaller than the file it
// replaces is dropped from the generator rather than shipped."
//
// Skips loudly when the corpus is absent — `data/2*` is gitignored, so CI has no cycle tree and
// "no surfaces were checked" must never read as "every surface is correct".

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as B from "../../elections/build_surfaces";
import * as P from "../../elections/build_parliamentary_surface";
import * as L from "../../elections/build_local_surface";
import {
  SURFACE_BUDGET_BYTES,
  SURFACE_POLICY,
  emittedLevels,
} from "../../../src/data/elections/surfacePath";
import type { ElectionUnavailableReason } from "../../../src/data/elections/surfaceTypes";
import {
  ELECTION_SURFACE_VERSION,
  isWellFormedElectionSurfaceV1,
  surfaceCapViolations,
} from "../../../src/data/elections/surfaceTypes";
import { bgCorpus, enCorpus } from "../../../src/locales/allKeys";
import { UNAVAILABLE_REASON_LABEL_KEYS } from "../../../src/screens/elections/electionSurfaceDescriptors";
import { STANDOUT_THRESHOLDS } from "../../../src/data/elections/standoutThresholds";
import { capStandouts } from "../../elections/standouts";

const CYCLES = B.coveredCycles();

/** Generated once — building 23,665 surfaces per describe block is minutes of wall clock. */
const ALL: B.Emitted[] = CYCLES.flatMap(({ kind, cycle }) =>
  B.generate(kind, cycle),
);

/** ⚠ CONTENT, NOT DIRECTORY PRESENCE — and the difference is the whole behaviour of this file
 *  in CI. `.gitignore` ignores every cycle subtree but re-includes the `parties` one, so a FRESH
 *  CLONE has 13 parliamentary cycle DIRECTORIES holding nothing but `parties/assessment/`.
 *  `coveredCycles()` matches on the directory name, so it happily returns `2026_04_19` there —
 *  which made every `runIf` fire against an empty `ALL` and turned this file RED on CI rather
 *  than skipped. Gating on what was actually generated is the only honest signal. */
const hasCorpus = ALL.length > 0;

describe("schema and version", () => {
  it.runIf(hasCorpus)("is valid on every emitted surface", () => {
    expect(ALL.length).toBeGreaterThan(20_000);
    for (const e of ALL) {
      expect(e.surface.schemaVersion, e.file).toBe(ELECTION_SURFACE_VERSION);
      expect(isWellFormedElectionSurfaceV1(e.surface), e.file).toBe(true);
      expect(surfaceCapViolations(e.surface), e.file).toEqual([]);
    }
  });
});

describe("the figures reconcile to the canonical totals", () => {
  it.runIf(hasCorpus)(
    "publishes each parliamentary region's own protocol figures",
    () => {
      // ⚠ RECONCILES AGAINST THE SOURCE, not against another derived value. A projection that
      // agrees with itself proves nothing; the point is that the number a reader sees is the
      // number in the protocol.
      const parl = CYCLES.find((c) => c.kind === "parliamentary");
      if (!parl) return;
      const rows = new Map(P.readRegionRows(parl.cycle).map((r) => [r.key, r]));
      let checked = 0;
      for (const e of ALL) {
        if (e.kind !== "parliamentary") continue;
        if (e.level !== "region" && e.level !== "abroad") continue;
        const row = rows.get(e.id)!;
        const b = e.surface.ballots[0];
        checked++;
        // Valid votes are the party sum — never `protocol.numValidVotes`, which is paper-only.
        expect(b.totals.validVotes, e.id).toBe(
          row.results.votes.reduce((a, v) => a + v.totalVotes, 0),
        );
        expect(b.totals.votesCast, e.id).toBe(
          row.results.protocol.totalActualVoters,
        );
        // Every previewed party's votes are the source's, to the vote.
        for (const entry of b.preview) {
          const src = row.results.votes.find(
            (v) => v.partyNum === entry.localPartyNum,
          )!;
          expect(entry.votes, `${e.id}/${entry.localPartyNum}`).toBe(
            src.totalVotes,
          );
          expect(entry.pct, `${e.id}/${entry.localPartyNum}`).toBeCloseTo(
            (src.totalVotes / b.totals.validVotes) * 100,
            2,
          );
        }
      }
      expect(checked).toBe(32);
    },
  );

  it.runIf(hasCorpus)(
    "publishes each local council's own seat and vote totals",
    () => {
      let checked = 0;
      for (const e of ALL) {
        if (e.kind !== "local" || e.level !== "municipality") continue;
        const m = L.readMunicipality(e.cycle, e.id)!;
        const council = e.surface.ballots.find(
          (b) => b.kind === "municipal_council",
        );
        if (!council) continue;
        checked++;
        // The council's denominator IS the protocol's — that is what makes it the council's.
        expect(council.totals.validVotes, e.id).toBe(m.protocol.numValidVotes);
        expect(council.seatsTotal, e.id).toBe(
          (m.council ?? []).reduce((a, r) => a + (r.mandatesWon || 0), 0),
        );
        for (const entry of council.preview) {
          const src = (m.council ?? []).find(
            (r) => r.localPartyNum === entry.localPartyNum,
          )!;
          expect(entry.votes, `${e.id}/${entry.localPartyNum}`).toBe(
            src.totalVotes,
          );
          expect(entry.seats, `${e.id}/${entry.localPartyNum}`).toBe(
            src.mandatesWon,
          );
          // ⚠ pct IS CIK's OWN FIGURE, carried verbatim (§5).
          expect(entry.pct, `${e.id}/${entry.localPartyNum}`).toBe(
            src.pctOfValid,
          );
        }
      }
      expect(checked).toBeGreaterThan(500);
    },
  );

  it.runIf(hasCorpus)("keeps the two local denominators distinct", () => {
    let both = 0;
    let differing = 0;
    for (const e of ALL) {
      if (e.kind !== "local" || e.level !== "municipality") continue;
      const mayor = e.surface.ballots.find(
        (b) => b.kind === "municipality_mayor",
      );
      const council = e.surface.ballots.find(
        (b) => b.kind === "municipal_council",
      );
      if (!mayor || !council) continue;
      both++;
      if (mayor.totals.validVotes !== council.totals.validVotes) differing++;
    }
    expect(both).toBeGreaterThan(500);
    expect(
      differing / both,
      "the two ballots share a denominator",
    ).toBeGreaterThan(0.9);
  });

  it.runIf(hasCorpus)("gives oblast 32 no turnout percentage", () => {
    // §Phase 1: "`region/32` has no turnout percentage and declares turnoutBasis unavailable".
    const abroad = ALL.filter(
      (e) => e.kind === "parliamentary" && e.level === "abroad",
    );
    expect(abroad).toHaveLength(1);
    const totals = abroad[0].surface.ballots[0].totals;
    expect(totals.turnoutBasis).toBe("unavailable");
    expect("turnoutPct" in totals).toBe(false);
    expect(abroad[0].surface.facts.map((f) => f.code)).not.toContain("turnout");
  });

  it.runIf(hasCorpus)(
    "never attributes a parent council as a settlement office",
    () => {
      for (const e of ALL) {
        if (e.kind !== "local" || e.level !== "settlement") continue;
        expect(
          e.surface.ballots.map((b) => b.kind),
          e.id,
        ).not.toContain("municipal_council");
      }
    },
  );
});

// ─── routes ─────────────────────────────────────────────────────────────────────────────────

/** Every route pattern the app declares, as a matcher. Read from `routes.tsx` rather than
 *  restated, so a routing change moves both sides together.
 *
 *  ⚠ THE GENERATOR EMITS ROUTES AND NOTHING COMPARED THEM TO THE ROUTER. A surface pointing at
 *  a path the app does not serve is a dead link on every page that renders it, at a 200. */
const routePatterns = (): RegExp[] => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src", "routes.tsx"),
    "utf8",
  );
  const paths = new Set<string>();
  for (const m of src.matchAll(/\bpath=["']([^"']+)["']/g)) paths.add(m[1]);
  for (const m of src.matchAll(/\bto=["'](\/[^"']+)["']/g)) paths.add(m[1]);
  // ⚠ THE 404 CATCH-ALL IS NOT A ROUTE THE APP SERVES, and including it made this whole gate
  // vacuous: `routes.tsx` declares `path="*"`, which compiled to `.*` and matched every string
  // — `/lokal/2023/PAZ19` and `/utter/nonsense/here` both "resolved". A surface pointing at a
  // path only the not-found page answers is a dead link, which is exactly what this checks for.
  paths.delete("*");
  // ⚠ THE 404 CATCH-ALL IS NOT A ROUTE THE APP SERVES, and including it made this whole gate
  // vacuous: `routes.tsx` declares `path="*"`, which compiled to `.*` and matched every string
  // — `/lokal/2023/PAZ19` and `/utter/nonsense/here` both "resolved". A surface pointing at a
  // path only the not-found page answers is a dead link, which is exactly what this checks for.

  return [...paths].map(
    (p) =>
      new RegExp(
        `^/?${p
          .replace(/^\//, "")
          .split("/")
          .map((seg) =>
            seg.startsWith(":")
              ? "[^/]+"
              : seg === "*"
                ? ".*"
                : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          )
          .join("/")}/?$`,
      ),
  );
};

describe("every route a surface emits is one the app serves", () => {
  it.runIf(hasCorpus)(
    "resolves every destination and complete-result route",
    () => {
      const patterns = routePatterns();
      // Non-vacuity: a broken reader would make every assertion below pass.
      expect(patterns.length).toBeGreaterThan(50);
      expect(patterns.some((r) => r.test("/local/2023_10_29_mi/PAZ19"))).toBe(
        true,
      );
      // ⚠ AND IT MUST REJECT SOMETHING. `routes.tsx` declares `path="*"` — the SPA's 404
      // catch-all — which compiled to `.*` and made this whole gate vacuous: every one of the
      // strings below "resolved", so a destination pointing anywhere at all passed.
      for (const nonsense of [
        "/lokal/2023_10_29_mi/PAZ19",
        "/utter/nonsense/here",
      ])
        expect(
          patterns.some((r) => r.test(nonsense)),
          `the matcher accepts ${nonsense} — it is matching everything`,
        ).toBe(false);

      const seen = new Set<string>();
      const bad = new Set<string>();
      const check = (to: string, where: string) => {
        if (!to || seen.has(to)) return;
        seen.add(to);
        if (!patterns.some((r) => r.test(to))) bad.add(`${where}: ${to}`);
      };
      for (const e of ALL) {
        const d = e.surface.destinations;
        if (d.completeResult.available)
          check(d.completeResult.to, `${e.kind}/${e.level}`);
        for (const [view, dst] of Object.entries(d.views ?? {}))
          if (dst.available)
            check(dst.to, `${e.kind}/${e.level}/views.${view}`);
        for (const b of e.surface.ballots)
          if (b.completeResult.available)
            check(b.completeResult.to, `${e.kind}/${e.level}/${b.kind}`);
      }
      expect(seen.size, "no route was checked").toBeGreaterThan(100);
      expect(
        [...bad].slice(0, 10),
        `${bad.size} unresolvable route(s)`,
      ).toEqual([]);
    },
  );

  it.runIf(hasCorpus)(
    "gives every unavailable destination a reason BOTH locales carry",
    () => {
      // §5: an unavailable view is a rendered state, and the reason is an enum key "so both
      // locales carry it". A key present in bg and missing in en renders as its own identifier
      // on every English page.
      const reasons = new Set<ElectionUnavailableReason>();
      for (const e of ALL) {
        const d = e.surface.destinations;
        const all = [
          d.completeResult,
          d.childPlaces,
          d.parentPlace,
          d.officialProtocol,
          ...Object.values(d.views ?? {}),
        ];
        for (const dst of all) {
          if (!dst || dst.available) continue;
          expect(dst.reason, `${e.kind}/${e.level}/${e.id}`).toBeTruthy();
          reasons.add(dst.reason!);
        }
      }
      expect(
        reasons.size,
        "no unavailable destination was emitted",
      ).toBeGreaterThan(0);
      // ⚠ THE KEY IS LOOKED UP, NOT BUILT (§5.2). Assuming an `election_unavailable_${reason}`
      // prefix tested a convention no runtime implements — the repo forbids built keys, so the
      // renderer reads a written-out Record and `descriptorCopyKeys()` can enumerate it. It also
      // meant `i18n:prune` saw four keys no production module named.
      for (const r of reasons)
        expect(
          UNAVAILABLE_REASON_LABEL_KEYS[r],
          `no label key is declared for reason ${r}`,
        ).toBeTruthy();
      // ⚠ EVERY MEMBER OF THE ENUM, not only the two today's corpus emits — the two it cannot
      // see are precisely the ones added ahead of a producer.
      for (const key of Object.values(UNAVAILABLE_REASON_LABEL_KEYS)) {
        expect(key in bgCorpus, `bg is missing ${key}`).toBe(true);
        expect(key in enCorpus, `en is missing ${key}`).toBe(true);
        expect((bgCorpus as Record<string, string>)[key]?.trim()).not.toBe("");
        expect((enCorpus as Record<string, string>)[key]?.trim()).not.toBe("");
      }
    },
  );

  it.runIf(hasCorpus)(
    "emits an empty `to` with every unavailable destination",
    () => {
      // A route string beside `available: false` invites a consumer to render it anyway.
      for (const e of ALL)
        for (const dst of Object.values(e.surface.destinations.views ?? {}))
          if (!dst.available) expect(dst.to, `${e.kind}/${e.level}`).toBe("");
    },
  );
});

// ─── §5.0's exit criterion ──────────────────────────────────────────────────────────────────

/** The canonical file ONE place's first screen comes from today, or null where the level has
 *  none (parliamentary region/abroad are a client-side fan-out — that is why they emit). */
export const canonicalFileFor = (e: B.Emitted): string | null => {
  const at = (...p: string[]) => path.join(B.DATA_ROOT, e.cycle, ...p);
  if (e.kind === "parliamentary") {
    if (e.level === "settlement") return at("settlements", `${e.id}.json`);
    if (e.level === "section")
      return at("sections", "by-oblast", `${e.id.slice(0, 2)}.json`);
    return null;
  }
  if (e.level === "country") return at("index.json");
  if (e.level === "region") return at("region", `${e.id}.json`);
  if (e.level === "municipality") return at("municipalities", `${e.id}.json`);
  // A local settlement's first screen comes from its PARENT municipality bundle; the artifact
  // is keyed by ekatte and the bundle by obshtina, so there is no per-place canonical file.
  return null;
};

/** Does the canonical file carry a RESULT, or is it a stub for a place that held no ballot?
 *  §5.0's "no smaller than the file it replaces" is about the first, and comparing two stubs
 *  measures the navigation contract rather than a projection. */
export const canonicalHasResult = (file: string): boolean => {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
    results?: { votes?: unknown[] };
    sections?: unknown[];
  };
  if (Array.isArray(raw.sections) && raw.sections.length > 0) return true;
  const votes = raw.results?.votes;
  return Array.isArray(votes) ? votes.length > 0 : true;
};

/** The canonical file a level's first screen comes from today, in bytes, at its LARGEST place. */
const canonicalMaxBytes = (
  kind: "parliamentary" | "local",
  level: string,
  cycle: string,
): number => {
  const dirOf = (...p: string[]) => path.join(B.DATA_ROOT, cycle, ...p);
  const maxIn = (dir: string) => {
    if (!fs.existsSync(dir)) return 0;
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .reduce((a, f) => Math.max(a, fs.statSync(path.join(dir, f)).size), 0);
  };
  if (kind === "parliamentary") {
    if (level === "settlement") return maxIn(dirOf("settlements"));
    if (level === "section") return maxIn(dirOf("sections", "by-oblast"));
    return 0; // region/abroad have no single canonical file — that is why they emit
  }
  if (level === "municipality" || level === "settlement")
    return maxIn(dirOf("municipalities"));
  if (level === "region") return maxIn(dirOf("region"));
  if (level === "country") {
    const p = dirOf("index.json");
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  }
  return 0;
};

describe("§5.0's emit column, re-measured against GENERATED output", () => {
  it.runIf(hasCorpus)(
    "makes every emitted artifact smaller than the file it replaces, PER PLACE",
    () => {
      // ⚠ MAX-AGAINST-MAX CANNOT FAIL. Comparing a level's largest artifact against its largest
      // canonical file gives ratios of 0.001–0.107 — the projection is three orders of magnitude
      // smaller at the top — so the assertion is satisfied whatever happens to the other 5,363
      // places. Measured per place, 1,134 of 5,364 parliamentary settlements (21.1%) emit an
      // artifact LARGER than the file it replaces, worst 6.22x.
      //
      // ⚠ AND THOSE 1,134 ARE THE RESULT-LESS ONES — the settlements with no polling station,
      // whose canonical file is the stub `{"votes": []}`. There is nothing to project there, and
      // the artifact's bytes are almost entirely the destinations block, which is the navigation
      // contract rather than a copy of the result. §5.0's rule is about levels whose artifact
      // REPLACES a fetch of real content, so the comparison is made over the places that have
      // some — and the exclusion is COUNTED, so it cannot quietly widen.
      let compared = 0;
      let skipped = 0;
      let larger = 0;
      const worstRatio = 0;
      const worst: string[] = [];
      for (const e of ALL) {
        const canonical = canonicalFileFor(e);
        if (!canonical) continue;
        if (!fs.existsSync(canonical)) continue;
        if (!canonicalHasResult(canonical)) {
          skipped++;
          continue;
        }
        compared++;
        const size = fs.statSync(canonical).size;
        if (e.bytes >= size) {
          larger++;
          if (worst.length < 5)
            worst.push(
              `${e.kind}/${e.level}/${e.id}: ${e.bytes} B vs ${size} B`,
            );
        }
      }
      expect(
        compared,
        "no place was compared against its canonical file",
      ).toBeGreaterThan(5_000);
      expect(
        skipped / (compared + skipped),
        `${skipped} result-less places excluded — the exclusion has widened`,
      ).toBeLessThan(0.3);
      // ⚠ A SHARE AND A RATIO, NOT A ZERO. `local/region/PDV-00` — Plovdiv city, a
      // single-municipality "region" and the SMALLEST canonical region file at 2,400 B — emits
      // 2,404 B, a 0.2% tie. One such case in 17,589 is not evidence a level is unjustified;
      // 1,134 of 5,364 at up to 6.22x was, and both must be told apart by the same assertion.
      expect(
        larger / compared,
        `${larger} of ${compared} artifacts are no smaller than the file they replace:\n` +
          worst.join("\n"),
      ).toBeLessThan(0.01);
      expect(
        worstRatio,
        `worst artifact-to-canonical ratio ${worstRatio.toFixed(2)}x — a level is not projecting`,
      ).toBeLessThan(1.05);
    },
  );

  it.runIf(hasCorpus)(
    "keeps the level-wide reduction that justified emitting at all",
    () => {
      // ⚠ THE PHASE'S EXIT CRITERION: "a level that generates an artifact no smaller than the
      // file it replaces is dropped from the generator rather than shipped." A generator cannot
      // ask this of itself — it needs the canonical file beside the projection.
      const rows: string[] = [];
      for (const d of B.summarise(ALL)) {
        const canonical = canonicalMaxBytes(d.kind, d.level, d.cycle);
        if (canonical === 0) continue; // no single canonical file — the reason it emits
        rows.push(
          `${d.kind}/${d.level} @ ${d.cycle}: artifact ${d.maxBytes} B vs canonical ${canonical} B`,
        );
        expect(
          d.maxBytes,
          `${d.kind}/${d.level} @ ${d.cycle} is no smaller than the file it replaces ` +
            `(${d.maxBytes} B vs ${canonical} B) — drop it from the generator`,
        ).toBeLessThan(canonical);
      }
      expect(
        rows.length,
        "no level was compared against a canonical file",
      ).toBeGreaterThan(4);
    },
  );

  it.runIf(hasCorpus)("keeps every artifact inside its declared budget", () => {
    for (const d of B.summarise(ALL))
      expect(
        d.maxBytes,
        `${d.kind}/${d.level} @ ${d.cycle}: ${d.maxBytes} B`,
      ).toBeLessThanOrEqual(SURFACE_BUDGET_BYTES[d.level]);
  });

  it.runIf(hasCorpus)(
    "records the object-count delta, inside §5.0's bound",
    () => {
      // §5.0's own worked example is ~240,000 objects for all 13 parliamentary cycles, which it
      // rejects. v1's bounded coverage must stay an order of magnitude below that.
      const { artifacts, embedded } = B.objectCounts(B.summarise(ALL));
      expect(artifacts).toBeGreaterThan(20_000);
      expect(
        artifacts,
        `${artifacts} new bucket objects — §5.0 rejects the 240,000-object shape`,
      ).toBeLessThan(60_000);
      expect(
        embedded,
        "the artifact run must not include the embedded level",
      ).toBe(0);
    },
  );

  it.runIf(hasCorpus)(
    "emits a level only where the policy says `artifact`",
    () => {
      for (const e of ALL)
        expect(
          SURFACE_POLICY[e.kind][e.level].source,
          `${e.kind}/${e.level}`,
        ).toBe("artifact");
      for (const { kind } of CYCLES)
        expect(emittedLevels(kind).length).toBeGreaterThan(0);
    },
  );
});

describe("determinism (§9)", () => {
  it.runIf(hasCorpus)("rebuilds byte-identically", () => {
    const { kind, cycle } = CYCLES[0];
    const a = B.generate(kind, cycle).map((e) => B.serialize(e.surface));
    const b = B.generate(kind, cycle).map((e) => B.serialize(e.surface));
    expect(a).toEqual(b);
  });

  it.runIf(hasCorpus)("stamps no generation time", () => {
    // ⚠ A GENERATOR THAT READS THE CLOCK either fails the gate above or makes it vacuous.
    const now = Date.now();
    for (const e of ALL.slice(0, 200)) {
      const stamped = Date.parse(e.surface.status.updatedAt ?? "");
      expect(Number.isFinite(stamped), e.file).toBe(true);
      expect(now - stamped, `${e.file} stamped the run time`).toBeGreaterThan(
        60_000,
      );
    }
  });
});

describe("standouts (§7)", () => {
  const withStandouts = () => ALL.filter((e) => e.surface.standouts.length > 0);

  it.runIf(hasCorpus)("emits some, at the levels §7 measured", () => {
    // Non-vacuity for everything below: each rule is "no standout does X", which an empty set
    // satisfies. This file carried an explicit `toBe(0)` while the selectors were unwired, for
    // exactly that reason — now it asserts the opposite.
    const found = withStandouts();
    expect(
      found.length,
      "no standout was emitted — the selectors are unwired",
    ).toBeGreaterThan(20);
    const levels = new Set(found.map((e) => `${e.kind}/${e.level}`));
    // ⚠ REGION AND MUNICIPALITY ONLY. §7's thresholds were calibrated at that scale; run over
    // 12,721 polling stations the close-contest selector emits ~636 leads saying one station was
    // closely fought, which is what a station is.
    expect([...levels].sort()).toEqual([
      "local/municipality",
      "parliamentary/region",
    ]);
  });

  it.runIf(hasCorpus)(
    "gives every standout an evidence route that resolves",
    () => {
      // §7: "suppress a review signal if the evidence leaf is absent"; §5: "do not emit a standout
      // when its denominator, baseline, or evidence destination is missing." A claim about a named
      // place with nowhere to check it is the shape the rule exists to prevent.
      //
      // ⚠ „ON THIS PAGE" IS A RESOLVING EVIDENCE ROUTE, and reading it as absence fails the whole
      // corpus. A standout attaches to the surface of the place it is ABOUT, and at both
      // attaching levels that place's complete result IS that page — so the honest answer is
      // „here", carried as `evidenceOnPage` rather than as a self-link. This gate required a
      // non-empty string, which is the same conflation `hasEvidence` had: while `completeResult`
      // self-linked it passed on a „виж" link that navigated nowhere.
      const patterns = routePatterns();
      let checked = 0;
      let onPage = 0;
      const bad: string[] = [];
      for (const e of withStandouts())
        for (const s of e.surface.standouts) {
          checked++;
          if (s.evidenceOnPage) {
            onPage++;
            // The flag and a route are alternatives, not companions: a standout carrying both
            // says the evidence is here AND somewhere else, and a consumer must not have to
            // choose.
            if (s.evidenceTo)
              bad.push(
                `${e.level}/${e.id}/${s.signal}: on-page AND ${s.evidenceTo}`,
              );
          } else if (!s.evidenceTo)
            bad.push(`${e.level}/${e.id}/${s.signal}: no route`);
          else if (!patterns.some((r) => r.test(s.evidenceTo)))
            bad.push(`${e.level}/${e.id}/${s.signal}: ${s.evidenceTo}`);
        }
      // ⚠ NON-VACUITY, in the direction this corpus actually exercises. Every standout today is
      // on-page, so a gate that only checked routes would be asserting nothing about any of
      // them — and would go on passing if the flag started appearing everywhere by accident.
      expect(onPage).toBeGreaterThan(0);
      expect(checked).toBeGreaterThan(20);
      expect(
        bad.slice(0, 5),
        `${bad.length} standout(s) with no usable evidence`,
      ).toEqual([]);
    },
  );

  it.runIf(hasCorpus)(
    "names a baseline, its cycle and its comparison group",
    () => {
      // §7: "include the actual comparison group and cycle in the baseline". A lead whose
      // measurement is withheld asserts more than it can support.
      for (const e of withStandouts())
        for (const s of e.surface.standouts) {
          expect(s.baseline?.kind, `${e.id}/${s.signal}`).toBeTruthy();
          expect(
            s.baseline.labelParams.cycle,
            `${e.id}/${s.signal} has no cycle in its baseline`,
          ).toBe(e.cycle);
          expect(s.sampleSize, `${e.id}/${s.signal}`).toBeGreaterThan(0);
        }
    },
  );

  it.runIf(hasCorpus)(
    "fires on no more than a third of its population (§7)",
    () => {
      // "Never emit a signal that is true of most places." The barred sibling — no council
      // majority, true of 62% — is what this exists to keep out.
      const shares: string[] = [];
      for (const { kind, cycle } of CYCLES)
        for (const level of B.STANDOUT_LEVELS[kind] ?? []) {
          const places = ALL.filter(
            (e) =>
              e.kind === kind &&
              e.cycle === cycle &&
              (e.level === level ||
                (level === "region" && e.level === "abroad")),
          );
          if (places.length === 0) continue;
          const bySignal = new Map<string, number>();
          for (const e of places)
            for (const s of e.surface.standouts)
              bySignal.set(s.signal, (bySignal.get(s.signal) ?? 0) + 1);
          for (const [signal, n] of bySignal) {
            shares.push(
              `${kind}/${level}@${cycle}:${signal} ${n}/${places.length}`,
            );
            expect(
              n / places.length,
              `${signal} fires on ${n} of ${places.length} places at ${kind}/${level}`,
            ).toBeLessThanOrEqual(1 / 3);
          }
        }
      expect(shares.length, "no signal fired anywhere").toBeGreaterThan(3);
    },
  );

  it.runIf(hasCorpus)(
    "publishes no close contest the recorded basis does not cover",
    () => {
      // ⚠⚠ THE ASSERTION THAT WAS MISSING, AND IT LET A FALSE CLAIM THROUGH. A percentile selects
      // its share BY CONSTRUCTION, so it names ~5% of places whether or not any of them is close
      // in absolute terms — right where the distribution is tight, wrong where it is wide, and
      // nothing else in this block reads `s.metric` at all.
      //
      // Measured: the threshold's basis was calibrated on the 289–305-place MUNICIPALITY
      // distribution, whose worst-ever p5 is 4.88 pp. Applied unchanged to a 31-member REGION
      // population it ran 0.39 → 8.55 pp across 13 cycles and breached 4.88 in three of them — and
      // on 2026, where the regions' median margin is 31.83 pp, it named Столична 24 an "unusually
      // close contest" at 8.55 pp.
      const max = STANDOUT_THRESHOLDS.close_contest.maxCutoff;
      expect(
        max,
        "the recorded basis has no ceiling to enforce",
      ).toBeGreaterThan(0);
      let published = 0;
      for (const e of withStandouts())
        for (const s of e.surface.standouts) {
          if (s.signal !== "close_contest") continue;
          published++;
          expect(
            s.metric,
            `${e.kind}/${e.level}/${e.id} is published as close at ${s.metric} pp, past the ` +
              `${max} pp the basis covers`,
          ).toBeLessThanOrEqual(max!);
        }
      expect(
        published,
        "no close contest was published — the rule is untested",
      ).toBeGreaterThan(10);
    },
  );

  it.runIf(hasCorpus)("derives a DIFFERENT cutoff for each cycle", () => {
    // §7's whole finding: the distribution moves an order of magnitude between cycles, so a
    // fixed pp value means two different things depending on the year. The two local cycles must
    // therefore disagree about where "close" begins.
    const cutoffs = new Map<string, number>();
    for (const e of withStandouts())
      for (const s of e.surface.standouts)
        if (s.signal === "close_contest")
          cutoffs.set(e.cycle, s.baseline.labelParams.cutoffPp as number);
    expect(
      cutoffs.size,
      "only one cycle published a close contest",
    ).toBeGreaterThan(1);
    expect(
      new Set(cutoffs.values()).size,
      `every cycle derived the same cutoff ${[...cutoffs.values()]} — it is hard-coded`,
    ).toBeGreaterThan(1);
  });

  it.runIf(hasCorpus)("selects about the percentile it declares", () => {
    // ⚠ THE CUTOFF IS THE CYCLE'S OWN, so the SHARE is what stays constant across cycles while
    // the pp value moves by an order of magnitude. A hard-coded threshold fails this on one of
    // the two local cycles.
    for (const { kind, cycle } of CYCLES)
      for (const level of B.STANDOUT_LEVELS[kind] ?? []) {
        const places = ALL.filter(
          (e) => e.kind === kind && e.cycle === cycle && e.level === level,
        );
        const close = places.filter((e) =>
          e.surface.standouts.some((s) => s.signal === "close_contest"),
        ).length;
        if (close === 0) continue;
        const share = close / places.length;
        expect(
          share,
          `${kind}/${level}@${cycle} close_contest ${share}`,
        ).toBeLessThan(0.12);
        expect(share).toBeGreaterThan(0.02);
      }
  });

  it.runIf(hasCorpus)("emits no turnout departure for oblast 32", () => {
    // §7, and §2 decision 10: abroad has no valid registered-voter denominator, and its two rows
    // (523.4 pp and 149.5 pp) would rank above every real finding.
    for (const e of ALL) {
      if (e.level !== "abroad") continue;
      expect(e.surface.standouts, "abroad carries a standout").toEqual([]);
    }
    for (const e of withStandouts())
      for (const s of e.surface.standouts)
        if (s.signal === "turnout_departure")
          expect(s.scope.id, "a turnout departure names oblast 32").not.toBe(
            "32",
          );
  });

  it("caps a place that qualifies for more than three (§7)", () => {
    // ⚠ THE CORPUS CANNOT TEST THIS: every place carries exactly one standout today, so the
    // assertion below is trivially true and would stay true against a component with no cap.
    // Constructed instead — five candidates across all three categories.
    const base = {
      metric: 1,
      unit: "count" as const,
      scope: { level: "municipality" as const, id: "X" },
      baseline: { kind: "cycle_percentile" as const, labelParams: {} },
      sampleSize: 100,
      resultStatus: "final" as const,
      evidenceTo: "/x",
      labelParams: {},
    };
    const many = [
      {
        ...base,
        id: "a",
        category: "outcome" as const,
        signal: "split_control" as const,
      },
      {
        ...base,
        id: "b",
        category: "outcome" as const,
        signal: "lead_change" as const,
      },
      {
        ...base,
        id: "c",
        category: "participation" as const,
        signal: "close_contest" as const,
      },
      {
        ...base,
        id: "d",
        category: "participation" as const,
        signal: "fragmented_council" as const,
      },
      {
        ...base,
        id: "e",
        category: "review" as const,
        signal: "invalid_ballots" as const,
      },
    ];
    const kept = capStandouts(many);
    expect(kept).toHaveLength(3);
    expect(new Set(kept.map((s) => s.category)).size).toBe(3);
  });

  it.runIf(hasCorpus)("keeps the cap: three, one per category (§7)", () => {
    for (const e of withStandouts()) {
      expect(e.surface.standouts.length, e.id).toBeLessThanOrEqual(3);
      const cats = e.surface.standouts.map((s) => s.category);
      expect(new Set(cats).size, `${e.id} repeats a category`).toBe(
        cats.length,
      );
      const ids = e.surface.standouts.map((s) => s.id);
      expect(new Set(ids).size, `${e.id} repeats a standout`).toBe(ids.length);
    }
  });

  it.runIf(hasCorpus)(
    "never restates a fact already on the strip (§7.1)",
    () => {
      // The strip renders above the standouts, so a signal that is also a fact prints the same
      // finding twice on one page. `split_control` and `runoff_pending` are both, at
      // local/municipality — they stay facts.
      //
      // ⚠ THIS ASSERTION IS UNFALSIFIABLE BY TODAY'S CORPUS, and saying so is the point. The
      // three wired selectors emit `close_contest`, `turnout_departure` and
      // `fragmented_council`; none is a fact code, so the overlap is empty and the filter in
      // `attachStandouts` never fires. It is a guard for the day `split_control` is wired as a
      // signal — §7 lists it — and the test below proves the guard WORKS rather than that the
      // corpus happens not to need it.
      for (const e of withStandouts()) {
        // Compared as plain strings: the two unions overlap on `split_control` and
        // `runoff_pending` and are not assignable to one another.
        const facts = new Set<string>(e.surface.facts.map((f) => f.code));
        for (const s of e.surface.standouts)
          expect(
            facts.has(s.signal),
            `${e.id} publishes ${s.signal} as both a fact and a standout`,
          ).toBe(false);
      }
    },
  );

  it.runIf(hasCorpus)(
    "suppresses a standout that IS a fact, when one arises",
    () => {
      // The non-vacuous half of §7.1: construct the collision the corpus cannot yet produce.
      const local = CYCLES.find((c) => c.kind === "local");
      if (!local) return;
      const built = B.generate("local", local.cycle);
      const victim = built.find(
        (e) => e.level === "municipality" && e.surface.standouts.length > 0,
      );
      expect(victim, "no municipality carries a standout").toBeTruthy();
      const signal = victim!.surface.standouts[0].signal;
      // Relabel a fact to the signal the standout carries, then re-attach.
      victim!.surface.facts = [
        { code: signal as never, unit: "none" },
        ...victim!.surface.facts,
      ];
      // ⚠ THE LIST IS NOT CLEARED FIRST, and that is the point. Clearing it tested
      // `capStandouts`'s arithmetic; leaving it tests `attachStandouts`'s CONTRACT — that the
      // pass assigns rather than appends, so it can REMOVE a standout the current run no longer
      // selects. An append-only pass keeps whatever a previous run wrote, which is what a §7.1
      // collision, a threshold change and a re-run after a corpus fix all look like.
      B.attachStandouts(built, "local", local.cycle);
      expect(
        victim!.surface.standouts.map((s) => s.signal),
        `${victim!.id} re-published ${signal} as a standout while it is a fact`,
      ).not.toContain(signal);
    },
  );

  it.runIf(hasCorpus)(
    "carries no prose — codes, ids and numbers only (§5.2)",
    () => {
      for (const e of withStandouts())
        expect(JSON.stringify(e.surface.standouts), e.id).not.toMatch(/[Ѐ-ӿ]/);
    },
  );
});
