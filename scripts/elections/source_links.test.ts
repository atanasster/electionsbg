// Destinations come from the router, and the second authority is re-derived.
//
// Two rules carry this file, and both fail silently if broken:
//
//   - a generator that builds its own route strings keeps emitting the old shape after the
//     routing rule moves, with the generator's tests asserting the string it builds and the
//     router's tests asserting the route it serves, and nothing comparing them;
//   - absent `reconciliation` means NOT RECONCILED. A builder that returns `agrees: true` when
//     it cannot find the comparison turns "we did not check" into "the two sources agree", on
//     named municipalities, which is the claim `/sverka` exists to make carefully.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATA_ROOT,
  VIEW_NAMES,
  buildDestinations,
  hasSverkaSidecar,
  readReconciliation,
  routerLevel,
  sverkaSidecarPath,
  toPlaceRef,
} from "./source_links";
import { localUrl, placeViewUrl } from "../../src/data/local/placeViews";
import { PLACE_DIGEST_ORDER } from "../../src/data/elections/surfaceTypes";
import os from "node:os";
import { stripComments } from "../lib/strip_comments";

/** A council that fully reconciles — 21 elected, 21 matched. The mayor status is what varies
 *  in the tests below, so the council is held constant and shared rather than re-typed. */
const FULL_COUNCIL = {
  cikSeats: 21,
  cikElectedCount: 21,
  officialSeats: 21,
  matched: 21,
  onlyInCik: [],
  onlyInOfficial: [],
};
import { computeOverall } from "../parsers_local/reconcile_officials";

const LOCAL_CYCLE = "2023_10_29_mi";
const hasLocal = fs.existsSync(path.join(DATA_ROOT, LOCAL_CYCLE));

describe("destinations are the router's, not the generator's", () => {
  it("agrees with PlaceViewNav about the view list and its order", () => {
    // Two orders for one nav is how a digest ends up disagreeing with the pills above it.
    expect([...VIEW_NAMES]).toEqual([...PLACE_DIGEST_ORDER]);
  });

  it("emits exactly the routes placeViewUrl returns, for every level", () => {
    // ⚠ THE ANTI-DRIFT ASSERTION. It compares the emitted `to` against a LIVE call into the
    // router rather than against an expected literal, so a routing change moves both sides
    // together and a generator that started building its own paths moves only one.
    const cases = [
      { level: "region" as const, id: "PAZ" },
      { level: "municipality" as const, id: "PAZ19" },
      { level: "settlement" as const, id: "55155" },
    ];
    for (const { level, id } of cases) {
      const d = buildDestinations({
        kind: "parliamentary",
        level,
        id,
        cycle: "2026_04_19",
        completeResultTo: "/x",
        localCycle: LOCAL_CYCLE,
        inLocalCycle: true,
      });
      const ref = toPlaceRef(level, id)!;
      expect(d.views!.governance!.to, `${level} governance`).toBe(
        placeViewUrl("governance", ref),
      );
      expect(d.views!.consumption!.to, `${level} consumption`).toBe(
        placeViewUrl("consumption", ref),
      );
      expect(d.views!.local!.to, `${level} local`).toBe(
        localUrl(ref, LOCAL_CYCLE),
      );
    }
  });

  it("routes Sofia through the helper's special cases rather than a template", () => {
    // A hand-built `/local/<cycle>/<obshtina>` gets all three of these wrong.
    const city = buildDestinations({
      kind: "parliamentary",
      level: "municipality",
      id: "SOF00",
      cycle: "2026_04_19",
      completeResultTo: "/x",
      localCycle: LOCAL_CYCLE,
      inLocalCycle: true,
    });
    expect(city.views!.local!.to).toBe(`/local/${LOCAL_CYCLE}/SOF`);
    expect(city.views!.local!.to).not.toContain("SOF00");

    const rayon = buildDestinations({
      kind: "parliamentary",
      level: "municipality",
      id: "S2401",
      cycle: "2026_04_19",
      completeResultTo: "/x",
      localCycle: LOCAL_CYCLE,
      inLocalCycle: true,
    });
    // A Sofia район is a município in the local tree — never `settlement/…`.
    expect(rayon.views!.local!.to).toBe(`/local/${LOCAL_CYCLE}/S2401`);
  });

  it("resolves a place's cross-view links to that place, never to another id", () => {
    // ⚠ THE DEFECT A REMOVED FIELD USED TO CAUSE, asserted as a PROPERTY so re-adding the field
    // cannot bring it back silently. `parentEkatte` overrode a settlement's own id, so a
    // settlement surface emitted `/governance/<someone else>` at `available: true` — this
    // settlement's page linking to a different place, with nothing failing.
    const d = buildDestinations({
      kind: "parliamentary",
      level: "settlement",
      id: "68134",
      cycle: "2026_04_19",
      completeResultTo: "/x",
    } as Parameters<typeof buildDestinations>[0]);
    for (const [view, dst] of Object.entries(d.views!)) {
      if (!dst.available) continue;
      expect(dst.to, `${view} points away from 68134`).toContain("68134");
    }
  });

  it("never links a surface to its own view (§7.1)", () => {
    for (const kind of ["parliamentary", "local"] as const) {
      const d = buildDestinations({
        kind,
        level: "municipality",
        id: "PAZ19",
        cycle: "2026_04_19",
        completeResultTo: "/x",
        localCycle: LOCAL_CYCLE,
        inLocalCycle: true,
      });
      expect(Object.keys(d.views!), `${kind} links to itself`).not.toContain(
        kind,
      );
      expect(Object.keys(d.views!)).toHaveLength(VIEW_NAMES.length - 1);
    }
  });

  it("says no_local_cycle rather than hiding the pill", () => {
    // §5: an unavailable view is a rendered state. A silently missing pill is not an answer.
    const d = buildDestinations({
      kind: "parliamentary",
      level: "municipality",
      id: "PAZ19",
      cycle: "2026_04_19",
      completeResultTo: "/x",
    });
    expect(d.views!.local).toEqual({
      to: "",
      available: false,
      reason: "no_local_cycle",
    });
  });

  it("distinguishes 'no cycle' from 'this place is not in the cycle'", () => {
    // A resolvable URL is not data. Both are `available: false`, and the reasons differ.
    const d = buildDestinations({
      kind: "parliamentary",
      level: "municipality",
      id: "PAZ19",
      cycle: "2026_04_19",
      completeResultTo: "/x",
      localCycle: LOCAL_CYCLE,
      inLocalCycle: false,
    });
    expect(d.views!.local!.available).toBe(false);
    expect(d.views!.local!.reason).toBe("no_data_for_place");
  });

  it("gives abroad no cross-view links at all", () => {
    // ⚠ THE TEMPTING DEFAULT IS WRONG. Mapping abroad onto `country` — its parent — emits four
    // live links to Bulgaria's own pages for a place that is not in Bulgaria.
    expect(toPlaceRef("abroad", "32")).toBeNull();
    expect(routerLevel("abroad")).toBeNull();
    const d = buildDestinations({
      kind: "parliamentary",
      level: "abroad",
      id: "32",
      cycle: "2026_04_19",
      completeResultTo: "/municipality/32",
    });
    for (const [view, dst] of Object.entries(d.views!)) {
      expect(dst.available, `abroad linked to ${view}`).toBe(false);
      expect(dst.reason).toBe("not_abroad");
      expect(dst.to).toBe("");
    }
  });

  it("omits views entirely at section level (§4.1)", () => {
    // Four rows of "this does not exist here" under a heading promising where to go next.
    const d = buildDestinations({
      kind: "parliamentary",
      level: "section",
      id: "162300012",
      cycle: "2026_04_19",
      completeResultTo: "/x",
      officialProtocolTo: "/protocol",
    });
    expect(d.views).toBeUndefined();
    expect(d.officialProtocol).toEqual({ to: "/protocol", available: true });
  });

  it("marks an absent official protocol unavailable rather than dropping it", () => {
    const d = buildDestinations({
      kind: "parliamentary",
      level: "section",
      id: "162300012",
      cycle: "2026_04_19",
      completeResultTo: "/x",
      officialProtocolTo: null,
    });
    // ⚠ THE REASON IS `no_data_for_place`. This field is only emitted AT a section, so
    // "not at a section" is the one thing it cannot mean.
    expect(d.officialProtocol).toEqual({
      to: "",
      available: false,
      reason: "no_data_for_place",
    });
  });

  it("omits an optional destination the caller did not ask about", () => {
    // `undefined` (not asked) and `null` (asked, does not exist) are different answers.
    const d = buildDestinations({
      kind: "parliamentary",
      level: "region",
      id: "PAZ",
      cycle: "2026_04_19",
      completeResultTo: "/x",
    });
    expect("officialProtocol" in d).toBe(false);
    expect("childPlaces" in d).toBe(false);
  });
});

describe("the second authority (§5)", () => {
  it.runIf(hasLocal)("is present iff the cycle ships a sidecar", () => {
    const dir = path.join(DATA_ROOT, LOCAL_CYCLE, "officials_diff");
    const codes = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
    expect(codes.length, "no sidecars to test against").toBeGreaterThan(100);
    for (const code of codes.slice(0, 40)) {
      expect(hasSverkaSidecar(LOCAL_CYCLE, code), code).toBe(true);
      expect(readReconciliation(LOCAL_CYCLE, code), code).toBeTruthy();
    }
  });

  it("returns undefined — NOT an outcome — when no sidecar exists", () => {
    // ⚠ THE ONE THAT MATTERS. "We did not check" must never render as "the two sources agree".
    expect(readReconciliation(LOCAL_CYCLE, "NO_SUCH_OBSHTINA")).toBeUndefined();
    expect(hasSverkaSidecar(LOCAL_CYCLE, "NO_SUCH_OBSHTINA")).toBe(false);
  });

  it("returns undefined for a malformed sidecar, never a verdict", () => {
    const bad = path.join(DATA_ROOT, "__nonexistent_cycle__");
    expect(readReconciliation(bad, "X")).toBeUndefined();
  });

  it.runIf(hasLocal)(
    "re-derives `agrees` through the ONE rule, agreeing with the corpus",
    () => {
      // ⚠ THIS TEST USED TO ASSERT THE OPPOSITE, AND THE OPPOSITE WAS A BUG. It required the
      // derivation to DISAGREE with the sidecar's own `overallStatus` somewhere, on the theory
      // that divergence proves independence. It diverged on 195 of 288 — because the first
      // derivation demanded a 100% council match where the real rule (`computeOverall`) uses 80%
      // — and every one of those municipalities has a mayor whose name matches EXACTLY on both
      // sides. "Proof of independence" was proof of a fabricated accusation.
      //
      // Re-deriving means computing from the sidecar's PARTS through the one shared rule, not
      // inventing a second rule. So the correct assertion is that it AGREES with the corpus
      // everywhere, and the anti-copy property is enforced structurally instead: the parts are
      // read, `overallStatus` is not.
      const dir = path.join(DATA_ROOT, LOCAL_CYCLE, "officials_diff");
      const codes = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      const wrong: string[] = [];
      let checked = 0;
      for (const f of codes) {
        const code = f.replace(/\.json$/, "");
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const r = readReconciliation(LOCAL_CYCLE, code);
        if (!r) continue;
        checked++;
        if (r.outcome !== raw.overallStatus)
          wrong.push(
            `${code}: derived ${r.outcome}, corpus says ${raw.overallStatus}`,
          );
      }
      expect(checked).toBeGreaterThan(100);
      expect(wrong.slice(0, 10), wrong.join("\n")).toEqual([]);
      // ⚠ NON-VACUITY MEASURED ON THE OUTPUTS, not on the sidecars. Counting sidecars lets an
      // implementation returning one constant pass: `checked` is 221 either way.
      const produced = new Set<string>();
      for (const f of codes) {
        const r = readReconciliation(LOCAL_CYCLE, f.replace(/\.json$/, ""));
        if (r) produced.add(r.outcome);
      }
      // ⚠️ A CORPUS FLOOR, DELIBERATELY LOW. This used to require 3 and the corpus emits
      // exactly 3, with the smallest bucket (`mismatch`) at 4 of 288 — so it sat ON its floor,
      // one healed município from going red for the same reason the `missing` arm below did:
      // the data got better. Discrimination is asserted against `computeOverall` instead, in
      // its own test, where no corpus can retire it. What this keeps is the weaker property
      // the corpus CAN speak to — that the derivation is not returning one constant.
      expect(
        produced.size,
        `the derivation emits only ${[...produced]} — it cannot be discriminating`,
      ).toBeGreaterThanOrEqual(2);
      expect([...produced]).toContain("match");
      // ⚠ `missing` IS **NOT** ASSERTED AGAINST THE CORPUS, AND THAT IS A DELIBERATE CHANGE.
      // It used to be — the corpus reliably held a handful, so requiring one here also proved
      // the state was reachable. Every one of those turned out to be OUR join losing the
      // mayor rather than the roster being silent (an obshtina name collision, a register
      // listing label taken over the declarant's own statement, a year filter dropping an
      // incumbent), and fixing all three took the count to zero — at which point this
      // assertion failed BECAUSE the defect it depended on was gone.
      //
      // A gate must not require a corpus to keep publishing a false statement in order to
      // stay green, so reachability is proved against the RULE below instead, where it
      // belongs and where no data can retire it.
      // docs/plans/officials-roster-missing-mayor-v1.md
    },
  );

  it("readReconciliation carries a `missing` sidecar through whole", () => {
    // FINDING-006: with no municipality in that state, nothing exercised the path from a
    // `missing_*` sidecar on disk to the payload — the arm most at risk from a future
    // "simplification" of the four states, since it is the one with no live example.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-"));
    const cycleDir = path.join(dir, LOCAL_CYCLE, "officials_diff");
    fs.mkdirSync(cycleDir, { recursive: true });
    fs.writeFileSync(
      path.join(cycleDir, "ZZZ99.json"),
      JSON.stringify({
        obshtinaCode: "ZZZ99",
        obshtinaName: "Тест",
        mayor: { status: "missing_official", cikName: "Иван Иванов" },
        council: FULL_COUNCIL,
        overallStatus: "missing",
      }),
    );
    const r = readReconciliation(LOCAL_CYCLE, "ZZZ99", dir);
    expect(r?.outcome).toBe("missing");
    expect(r?.against).toBe("officials_roster");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("carries `missing` whole rather than folding it into a contradiction", () => {
    // The reachability half, moved off the corpus (see above). `missing` is the bucket a
    // boolean `agrees` collapsed into "the officials roster contradicts the CEC here", which
    // is a claim about a named council that a SILENT roster does not make. Asserted through
    // `computeOverall` — the one rule — so it holds whether or not any municipality is
    // currently in that state.
    for (const mayorStatus of ["missing_official", "missing_cik"] as const)
      expect(computeOverall(mayorStatus, FULL_COUNCIL)).toBe("missing");
    // …and it is genuinely distinct from the neighbours it could be folded into.
    expect(computeOverall("match", FULL_COUNCIL)).toBe("match");
    expect(computeOverall("replaced", FULL_COUNCIL)).toBe("mismatch");
    // TEST-002: the two branches no live sidecar reaches — the 80% council threshold, and the
    // no-council case (Sofia районни) where the mayor decides alone.
    expect(computeOverall("match", { ...FULL_COUNCIL, matched: 10 })).toBe(
      "partial_mismatch",
    );
    expect(
      computeOverall("match", {
        ...FULL_COUNCIL,
        cikElectedCount: 0,
        matched: 0,
      }),
    ).toBe("match");
    expect(
      computeOverall("replaced", {
        ...FULL_COUNCIL,
        cikElectedCount: 0,
        matched: 0,
      }),
    ).toBe("mismatch");
  });

  it("reads the sidecar's PARTS, never its stored overallStatus", () => {
    // The structural half of the rule above, and it is a SOURCE scan — so it runs everywhere,
    // including CI, where the corpus is absent. It used to early-return on a missing data tree,
    // which switched the anti-copy guard off in exactly the environment that reviews merges.
    const dir = path.join(DATA_ROOT, LOCAL_CYCLE, "officials_diff");
    void dir;
    // ⚠ COMMENTS STRIPPED FIRST. Prose that MENTIONS a pattern is not an occurrence of it, and
    // this file's own header explains at length why it must not read `overallStatus` — which a
    // naive scan reads as the violation. Same trap `entryGraph.test.ts` documents.
    const src = stripComments(
      fs.readFileSync(
        path.join(process.cwd(), "scripts/elections/source_links.ts"),
        "utf8",
      ),
    );
    expect(src).toContain("computeOverall(");
    expect(
      // ⚠ A DOT ACCESS, not the type index. `MunicipalityOfficialsDiff["overallStatus"]` is how
      // the return type names the union and is not a read of the parsed value.
      /\.overallStatus\b/.test(src),
      "source_links reads overallStatus — it must derive it from mayor.status + council",
    ).toBe(false);
  });

  it.runIf(hasLocal)("points at the routed /sverka page", () => {
    const dir = path.join(DATA_ROOT, LOCAL_CYCLE, "officials_diff");
    const first = fs.readdirSync(dir).find((f) => f.endsWith(".json"))!;
    const r = readReconciliation(LOCAL_CYCLE, first.replace(/\.json$/, ""))!;
    expect(r.to).toBe("/sverka");
    expect(r.against).toBe("officials_roster");
  });

  it("builds the sidecar path inside the cycle directory", () => {
    const p = sverkaSidecarPath("C", "X");
    expect(p.endsWith(path.join("C", "officials_diff", "X.json"))).toBe(true);
  });
});

// ─── the two URL fields nobody fills and nobody reads (§Phase 6 item 7) ──────────────────────

describe("`status.sourceUrl` / `status.downloadUrl` are RESERVED, and that is checked", () => {
  // ⚠ THEY ARE DECLARED IN THE SCHEMA, SET BY NO PRODUCER, AND READ BY NO CONSUMER. Measured
  // 2026-09-04 over 4,000 published artifacts and 2,000 embedded local sections: `sourceLabel`
  // on 6,000 of 6,000, `sourceUrl` and `downloadUrl` on **zero**. That is the decorative-export
  // shape this codebase keeps finding — `RENDERS_SURFACE` was declared "so a gate can enumerate
  // the rule" and used by nothing while the boundary re-derived it — and the fix there was to
  // make it load-bearing rather than to delete it.
  //
  // ⚠ THE DANGER IS NOT THE EMPTINESS, IT IS A PARTIAL FILL. An optional URL invites a UI to
  // render „източник" only where it is present, which publishes „this level has no official
  // source" for every level still empty — while `sourceLabel`, which IS on every surface, says
  // otherwise. So the rule is all-or-nothing per (kind, level), and today it is nothing.
  //
  // This gate does not demand they stay empty forever. It demands that filling them be a
  // DECISION: populate a whole (kind, level) at once and update this test, rather than letting
  // one generator arm start emitting a URL that a renderer then treats as a verification badge.

  const surfaceFiles = (limit: number): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      if (out.length >= limit || !fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= limit) return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".json")) out.push(p);
      }
    };
    for (const cycle of fs.existsSync(DATA_ROOT)
      ? fs.readdirSync(DATA_ROOT)
      : [])
      walk(path.join(DATA_ROOT, cycle, "surface"));
    return out;
  };

  const files = surfaceFiles(1500);

  it.runIf(files.length > 0)(
    "no artifact carries either field — so no renderer can be reading one",
    () => {
      const filled = files.filter((f) => {
        const st = (
          JSON.parse(fs.readFileSync(f, "utf8")) as {
            status?: { sourceUrl?: string; downloadUrl?: string };
          }
        ).status;
        return st?.sourceUrl !== undefined || st?.downloadUrl !== undefined;
      });
      expect(
        filled.slice(0, 3),
        "a surface gained sourceUrl/downloadUrl — fill the whole (kind, level) and update this gate, " +
          "or a UI will render the difference as 'this level has no official source'",
      ).toEqual([]);
    },
  );

  it.runIf(files.length > 0)(
    "while `sourceLabel` IS on every one — the authority is never in doubt",
    () => {
      // ⚠ THE HALF THAT STOPS THE TEST ABOVE READING AS "surfaces carry no provenance". They
      // carry the authority; what they do not carry is a URL to it. Without this arm an empty
      // corpus, or one that lost `status` entirely, would satisfy the emptiness assertion.
      const unlabelled = files.filter(
        (f) =>
          !(
            JSON.parse(fs.readFileSync(f, "utf8")) as {
              status?: { sourceLabel?: string };
            }
          ).status?.sourceLabel,
      );
      expect(unlabelled.slice(0, 3)).toEqual([]);
    },
  );

  it("no consumer reads either field", () => {
    // A source scan, because an unread field is invisible in the DOM: the page looks identical
    // whether the renderer ignores it or the corpus never set it.
    const roots = ["src/screens/elections", "src/data/elections"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (
          /\.tsx?$/.test(e.name) &&
          !p.includes("fixtures") &&
          !p.endsWith("surfaceTypes.ts")
        ) {
          const src = stripComments(fs.readFileSync(p, "utf8"));
          if (/\b(sourceUrl|downloadUrl)\b/.test(src)) offenders.push(p);
        }
      }
    };
    roots.forEach((r) => walk(path.join(process.cwd(), r)));
    expect(
      offenders,
      "something now reads sourceUrl/downloadUrl — populate the field before rendering it",
    ).toEqual([]);
  });
});

// ─── a surface never links to its own page (§Phase 7) ────────────────────────────────────────

describe("`completeResult` refuses a self-link, as `views` always did", () => {
  // ⚠ MEASURED OVER THE PUBLISHED CORPUS BEFORE THE GUARD: 5,396 of 18,117 artifacts (29.8%)
  // carried a `completeResult` pointing at the artifact's OWN route with `available: true` —
  // every region (31), abroad (1) and settlement (5,364). A region's page IS `/municipality/:id`
  // and a settlement's IS `/sections/:ekatte`, so "see the complete result" was a link back to
  // the page the reader was already on.
  //
  // ⚠ IT SURVIVED BECAUSE NOTHING RENDERED THE FIELD. `destinations` has been generated,
  // schema-gated and published since Phase 1 with no consumer; a payload nobody reads cannot
  // look wrong. That is the argument for gating the payload rather than the pixels.

  const build = (
    level: "region" | "settlement" | "municipality" | "section",
    id: string,
    completeResultTo: string,
  ) =>
    buildDestinations({
      kind: "parliamentary",
      level,
      id,
      cycle: "2026_04_19",
      completeResultTo,
    });

  it("refuses the region's and the settlement's own route", () => {
    for (const [level, id, own] of [
      ["region", "S24", "/municipality/S24"],
      ["settlement", "51041", "/sections/51041"],
      ["municipality", "PAZ19", "/settlement/PAZ19"],
    ] as const) {
      const d = build(level, id, own);
      expect(d.completeResult.available, `${level} ${own}`).toBe(false);
      expect(d.completeResult.reason, `${level} ${own}`).toBe("same_page");
      // ⚠ AND THE ROUTE IS DROPPED, not kept beside `available: false`. A consumer that reads
      // `to` without checking the flag would otherwise still render the dead link.
      expect(d.completeResult.to, `${level} ${own}`).toBe("");
    }
  });

  it("keeps a destination that is a DIFFERENT page", () => {
    // The discriminating half: an unconditional refusal would pass every assertion above.
    const d = build("region", "S24", "/municipality/BGS");
    expect(d.completeResult.available).toBe(true);
    expect(d.completeResult.to).toBe("/municipality/BGS");
  });

  // The presidential family's arm resolves BEFORE the `section` exemption below, and nothing
  // exercised it: an `ownPageRoute` that returned `completeResultTo` verbatim for this kind —
  // i.e. refused everything — passed every test in the repository.
  const pres = (
    level: "region" | "settlement" | "municipality" | "section",
    id: string,
    completeResultTo: string,
  ) =>
    buildDestinations({
      kind: "presidential",
      level,
      id,
      cycle: "2021_11_14_pvr",
      completeResultTo,
    });

  it("refuses a presidential SECTION's own page — the one level parliamentary exempts", () => {
    // ⚠ THE ARM'S WHOLE REASON FOR RESOLVING FIRST. A parliamentary section's own route
    // (`/section/:code`) is NOT what `placeViewUrl` builds for it, so that family exempts the
    // level; every presidential level has a page of its own, so exempting it here would let a
    // section surface link to the page it is rendered on. Deleting the arm turns this red.
    const own = "/presidential/2021_11_14_pvr/section/030604303";
    const d = pres("section", "030604303", own);
    expect(d.completeResult.available).toBe(false);
    expect(d.completeResult.reason).toBe("same_page");
    // …and the dead route is dropped, not kept beside the flag.
    expect(d.completeResult.to).toBe("");
  });

  it("keeps a presidential destination that is a DIFFERENT page", () => {
    // The discriminating half — this is what the producer actually emits at a section, whose
    // fuller result is its parent settlement.
    const d = pres(
      "section",
      "030604303",
      "/presidential/2021_11_14_pvr/settlement/61813",
    );
    expect(d.completeResult.available).toBe(true);
    expect(d.completeResult.to).toBe(
      "/presidential/2021_11_14_pvr/settlement/61813",
    );
  });

  it("refuses a presidential PLACE level's own page too", () => {
    for (const [level, id] of [
      ["region", "BGS"],
      ["municipality", "PAZ19"],
      ["settlement", "51041"],
    ] as const) {
      const own = `/presidential/2021_11_14_pvr/${level}/${id}`;
      const d = pres(level, id, own);
      expect(d.completeResult.available, own).toBe(false);
      expect(d.completeResult.reason, own).toBe("same_page");
    }
  });

  it("leaves the parliamentary section exemption untouched", () => {
    // The arm must not have changed the other two families. A parliamentary section's complete
    // result is its PARENT settlement's page, which is a different route and stays live.
    const d = buildDestinations({
      kind: "parliamentary",
      level: "section",
      id: "10135",
      cycle: "2026_04_19",
      completeResultTo: "/sections/10135",
    });
    expect(d.completeResult.available).toBe(true);
    expect(d.completeResult.to).toBe("/sections/10135");
  });

  it("leaves the SECTION level alone — its target is the parent settlement", () => {
    // ⚠ THE ONE LEVEL THE GUARD MUST NOT FIRE ON, and the one where a naive implementation
    // would. `placeViewUrl` maps a section ref to `/sections/:ekatte`, which is precisely the
    // destination a section is supposed to offer — computing "self" through the router there
    // would refuse all 12,721 of the only leaves that were ever right.
    //
    // ⚠ THE `id` HERE IS THE PARENT EKATTE, NOT THE SECTION CODE, AND THAT IS DELIBERATE.
    // `toPlaceRef`'s own comment states the convention — "A section's cross-view links resolve
    // through its PARENT SETTLEMENT … the caller passes the parent ekatte" — while
    // `build_parliamentary_surface.ts` passes `row.section`. Under the generator's shape the
    // exemption is unreachable and this test passes without it; under the DOCUMENTED shape it
    // is the only thing standing between the corpus and 12,721 refused leaves. Probed: with
    // the section code as `id`, deleting the exemption leaves the suite green.
    const d = build("section", "10135", "/sections/10135");
    expect(d.completeResult.available).toBe(true);
    expect(d.completeResult.to).toBe("/sections/10135");

    // …and the generator's ACTUAL shape resolves the same way, so neither convention breaks it.
    const asGenerated = build("section", "030604303", "/sections/10135");
    expect(asGenerated.completeResult.available).toBe(true);
    expect(asGenerated.completeResult.to).toBe("/sections/10135");
  });

  it("distinguishes `same_page` from `no_data_for_place`", () => {
    // Two different sentences: "the result exists and you are looking at it" versus "this place
    // has no such result". A consumer that renders reasons would publish the wrong one.
    const none = buildDestinations({
      kind: "parliamentary",
      level: "region",
      id: "S24",
      cycle: "2026_04_19",
      completeResultTo: null,
    });
    expect(none.completeResult.reason).toBe("no_data_for_place");
  });
});
