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
import { stripComments } from "../lib/strip_comments";

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
      expect(
        produced.size,
        `the derivation emits only ${[...produced]} — it cannot be discriminating`,
      ).toBeGreaterThanOrEqual(3);
      // ⚠ `missing` SPECIFICALLY. It is the bucket a boolean `agrees` collapsed into "the
      // roster contradicts the CEC", for six municipalities whose roster is merely silent.
      expect([...produced]).toContain("missing");
      expect([...produced]).toContain("match");
    },
  );

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
