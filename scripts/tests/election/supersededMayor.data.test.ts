// The shell must not announce a superseded mayor as „Избран" (§audit fix 1, step 2).
//
// ⚠⚠ THIS IS A FALSE CLAIM ABOUT A NAMED INDIVIDUAL, WHICH IS THE WORST FAILURE CLASS HERE.
// A local municipality surface's mayor ballot carries `isElected` on the REGULAR-cycle winner,
// and the shell renders that as a dedicated „Избран · да" column. Mounted above `StatsGrid`,
// whose first card is „Кмет", that put one person's name under „Избран" directly above a card
// naming their successor from a later by-election — at a 200, with nothing failing.
//
// The shell's statement is true OF THE CYCLE IT NAMES. What it broke is the ordering the page
// was built to guarantee: `showPartial` in `LocalElectionScreen` exists to "lead the mayor
// section + Кмет card with it and relegate the regular results below the timeline". The fix is
// that same predicate gating the boundary — not a second notion of supersession.
//
// ⚠ THE POPULATION IS MEASURED HERE SO THE RULE CANNOT GO VACUOUS. A guard against a case that
// no longer occurs passes forever while protecting nothing; this asserts the affected pages
// still exist in the corpus, and names them.
//
//   npm run test:data

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "../../lib/strip_comments";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const ROOT = process.cwd();
const HISTORY = path.join(ROOT, "data/local_chmi_history.json");

type ChmiEvent = {
  cycle: string;
  date: string;
  kind: string;
  obshtinaCode: string;
  candidateName: string;
};
type History = { allEvents: ChmiEvent[] };

const history: History | null = fs.existsSync(HISTORY)
  ? (JSON.parse(fs.readFileSync(HISTORY, "utf8")) as History)
  : null;

const surfaceCycles = fs.existsSync(path.join(ROOT, "data"))
  ? fs
      .readdirSync(path.join(ROOT, "data"))
      .filter((d) => d.endsWith("_mi"))
      .filter((d) =>
        fs.existsSync(path.join(ROOT, "data", d, "surface/municipality")),
      )
  : [];

const skip = !history
  ? "no chmi history"
  : surfaceCycles.length === 0
    ? "no published local municipality surfaces"
    : "";
reportSkip(import.meta.url, skip);

/** ⚠ THE THIRD INPUT IS ASSERTED, NOT SKIPPED ON, AND THE DIFFERENCE IS ITS TRACKING STATUS.
 *  `data/local_chmi_history.json` is gitignored, so its absence is a supported state and
 *  belongs in the skip reason above. `data/settlements.json` is COMMITTED, so its absence is a
 *  broken working copy — and standing down for it would be worse than useless here: the
 *  settlement half joins through it (the surface carries no parent — see `settlementObshtina`
 *  below), an absent catalogue yields an empty map, and an empty map yields zero superseded
 *  settlements, which is precisely the state the anti-vacuity assertion exists to reject.
 *  Silence would report "the corpus no longer contains the defect" when the truth is "this
 *  checkout cannot see it" — opposite conclusions from the same green run. */
assertCommitted("data/settlements.json");
const SETTLEMENTS = path.join(ROOT, "data/settlements.json");

const MAYOR_KINDS = new Set(["obshtina_mayor", "rayon_mayor"]);
/** The settlement tier's own by-election kind. ⚠ A SEPARATE SET, not an addition to the one
 *  above: a кметство by-election supersedes a SETTLEMENT's mayor and says nothing about the
 *  município's, so folding them together would report each level the other's population. */
const KMETSTVO_KINDS = new Set(["kmetstvo_mayor"]);

/** Municipality pages whose regular-cycle mayor is superseded by a LATER mayoral by-election —
 *  the same test `showPartial` makes, from the same feed the screen reads. */
const superseded = (): { cycle: string; obshtina: string }[] => {
  if (!history) return [];
  const out: { cycle: string; obshtina: string }[] = [];
  for (const cycle of surfaceCycles) {
    const iso = cycle.replace(/_mi$/, "").split("_").join("-");
    const dir = path.join(ROOT, "data", cycle, "surface/municipality");
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const obshtina = f.replace(/\.json$/, "");
      // ⚠ THE SCREEN'S OWN KIND SET, not a guess. `LocalElectionScreen` folds
      // `obshtina_mayor` and `rayon_mayor` into `mayorKinds`; a gate that matched only one of
      // them would report a smaller population than the rule protects and would have missed
      // the four Sofia районы entirely — half the affected pages.
      const later = history.allEvents.some(
        (e) =>
          e.obshtinaCode === obshtina &&
          MAYOR_KINDS.has(e.kind) &&
          e.date > iso,
      );
      if (later) out.push({ cycle, obshtina });
    }
  }
  return out;
};

describe.skipIf(skip)("a superseded mayor is not announced as elected", () => {
  it("still has pages to protect — the guard is not defending an empty set", () => {
    // ⚠ THE ANTI-VACUITY HALF, and the reason it comes first. If the corpus ever stopped
    // carrying a superseding by-election this whole rule would pass by having nothing to do,
    // and the next person would read a green suite as evidence the ordering is safe.
    const hits = superseded();
    expect(
      hits.length,
      "no municipality page has a later mayoral by-election — re-check the feed before trusting the guard",
    ).toBeGreaterThan(0);
  });

  it("gates the shell on the SAME predicate the mayor section already uses", () => {
    // A source scan, because the property is "which predicate wraps the boundary" and no
    // rendered DOM can distinguish `showPartial` from a second, drifting copy of it.
    const src = stripComments(
      fs.readFileSync(
        path.join(ROOT, "src/screens/LocalElectionScreen.tsx"),
        "utf8",
      ),
    );
    // ⚠ ANCHOR ON THE ELEMENT, NOT ON A PHRASE. `stripComments` removes JS comments and leaves
    // JSX ones, and the comment explaining this very guard contains the words
    // `level="municipality"` — so an `indexOf` for that string landed in prose 260 characters
    // from the code and reported the guard missing on a file that has it. Prose that mentions a
    // pattern is not an occurrence of it.
    const el = [...src.matchAll(/<ElectionSurfaceBoundary\b[^>]*>/gs)].find(
      (m) => /level="municipality"/.test(m[0]),
    );
    expect(el, "the municipality boundary moved or was removed").toBeTruthy();
    const before = src.slice(Math.max(0, el!.index! - 400), el!.index!);
    expect(
      // ⚠ THE PREDICATE, NOT ITS SPELLING. Pinning `{showPartial ? null : (` verbatim forbade
      // STRENGTHENING the guard — it failed the moment `|| supersessionPending` was added to
      // close the load-path hole, and on any Prettier reflow, printing a message that would then
      // be false. What must hold is that `showPartial` participates in a suppressing guard
      // immediately above the boundary; an inversion or a removal still fails.
      /\{[^}]*\bshowPartial\b[^}]*\?\s*null\s*:/.test(before),
      "the municipality surface is no longer gated on showPartial — a superseded mayor renders as elected above the card naming their successor",
    ).toBe(true);
  });

  it("does not invent a second supersession predicate", () => {
    // ⚠ TWO PREDICATES IS THE FAILURE THIS REPLACES. `showPartial` already folds three
    // conditions (a later event, a loaded partial bundle, and that bundle actually carrying a
    // mayor race); a hand-rolled `latestMayorEvent && …` beside the boundary would agree today
    // and drift on the first change to any of the three.
    const src = stripComments(
      fs.readFileSync(
        path.join(ROOT, "src/screens/LocalElectionScreen.tsx"),
        "utf8",
      ),
    );
    expect((src.match(/const showPartial =/g) ?? []).length).toBe(1);
  });
});

// ─── the same rule one tier down ─────────────────────────────────────────────────────────────

/** ekatte → obshtina, from the same catalogue the app resolves it with.
 *
 *  ⚠ THE SURFACE CARRIES NO PARENT. A settlement artifact's `place` is `{level, id}` and
 *  nothing else, so the município a settlement belongs to is not derivable from the artifact —
 *  a first attempt at this join read `place.parent?.id` and matched zero of 4,910. Any consumer
 *  needing the parent has to resolve it externally, which is what the screen does too. */
const settlementObshtina = (): Map<string, string> => {
  // Presence is a skip condition above, so there is deliberately no fallback here: an empty
  // map would be indistinguishable from a corpus in which nothing is superseded.
  const raw = JSON.parse(fs.readFileSync(SETTLEMENTS, "utf8")) as unknown;
  const rows = (Array.isArray(raw) ? raw : []) as {
    ekatte?: string;
    obshtina?: string;
  }[];
  return new Map(
    rows
      .filter((r) => r.ekatte && r.obshtina)
      .map((r) => [r.ekatte!, r.obshtina!]),
  );
};

/** Published settlement surfaces whose cycle is superseded by a LATER кметство by-election in
 *  the same município — the settlement analogue of `superseded()` above, joined the same way so
 *  neither half can go vacuous while the other stays honest. */
const supersededSettlements = (): { cycle: string; ekatte: string }[] => {
  if (!history) return [];
  const parentOf = settlementObshtina();
  const out: { cycle: string; ekatte: string }[] = [];
  for (const cycle of surfaceCycles) {
    const iso = cycle.replace(/_mi$/, "").split("_").join("-");
    const dir = path.join(ROOT, "data", cycle, "surface/settlement");
    if (!fs.existsSync(dir)) continue;
    const later = new Set(
      history.allEvents
        .filter((e) => KMETSTVO_KINDS.has(e.kind) && e.date > iso)
        .map((e) => e.obshtinaCode),
    );
    if (later.size === 0) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const ekatte = f.replace(/\.json$/, "");
      const parent = parentOf.get(ekatte);
      if (parent && later.has(parent)) out.push({ cycle, ekatte });
    }
  }
  return out;
};

describe.skipIf(skip)(
  "a superseded кметство mayor is not announced either",
  () => {
    // ⚠ THE SETTLEMENT TIER HAS THE SAME DEFECT AND A DIFFERENT HOME FOR THE FIX. Its surface
    // carries one `settlement_mayor` ballot with `isElected` on the regular-cycle winner, and
    // `KmetstvoMayorCard` leads with whoever a later кметство by-election put in office — so an
    // ungated shell names the wrong person first, exactly as at município level.
    //
    // ⚠ AND THE BOUNDARY LIVES IN THE CARDS COMPONENT, NOT THE SCREEN, which is what this gate
    // pins. `latestKmetstvo` is computed there from the chmi feed and the by-election's own
    // bundle; the screen has neither, so putting the boundary beside the header would have meant
    // computing supersession a second time.

    it("has settlement pages to protect", () => {
      // ⚠ JOINED TO PUBLISHED SURFACES AND DATED, WHICH THE FIRST CUT WAS NOT. It counted every
      // `kmetstvo_mayor` event in the feed, and 162 of 356 predate the oldest published cycle —
      // those supersede nothing and protect no page, so a feed regression that dropped every
      // RELEVANT by-election would have left this green. The município half above already joined
      // this way; the settlement half is what drifted.
      const hits = supersededSettlements();
      expect(
        hits.length,
        "no published settlement surface is superseded by a later кметство by-election — re-check the feed before trusting the guard",
      ).toBeGreaterThan(0);
    });

    it("gates the settlement surface on `latestKmetstvo`, in the component that computes it", () => {
      const src = stripComments(
        fs.readFileSync(
          path.join(
            ROOT,
            "src/screens/dashboard/local/LocalSettlementDashboardCards.tsx",
          ),
          "utf8",
        ),
      );
      const el = [...src.matchAll(/<ElectionSurfaceBoundary\b[^>]*>/gs)].find(
        (m) => /level="settlement"/.test(m[0]),
      );
      expect(el, "the settlement boundary moved or was removed").toBeTruthy();
      const before = src.slice(Math.max(0, el!.index! - 400), el!.index!);
      expect(
        // Same rule as the município tier above: the predicate must guard the boundary, not
        // match one spelling of the ternary.
        /\{[^}]*\blatestKmetstvo\b[^}]*\?\s*null\s*:/.test(before),
        "the settlement surface is no longer gated — a superseded кметство mayor renders as elected above the card naming their successor",
      ).toBe(true);
    });

    it("keeps the predicate where its inputs are", () => {
      // ⚠ THE SCREEN MUST NOT GROW A SECOND COPY. If `LocalSettlementDashboardScreen` ever
      // computes supersession itself, the two answers drift on the first change to either.
      const screen = stripComments(
        fs.readFileSync(
          path.join(ROOT, "src/screens/LocalSettlementDashboardScreen.tsx"),
          "utf8",
        ),
      );
      expect(screen).not.toMatch(/latestKmetstvo|useChmiHistory/);
    });

    it("gates EVERY settlement boundary, not just the first one", () => {
      // ⚠ `.find()` STOPS AT THE FIRST MATCH, so a second, ungated `level="settlement"` boundary
      // added later would pass the assertion above while rendering the very claim it forbids.
      // The município tier pins this by asserting `showPartial` is declared exactly once; the
      // settlement block dropped that sibling, which is the one most worth having here.
      const src = stripComments(
        fs.readFileSync(
          path.join(
            ROOT,
            "src/screens/dashboard/local/LocalSettlementDashboardCards.tsx",
          ),
          "utf8",
        ),
      );
      const all = [
        ...src.matchAll(/<ElectionSurfaceBoundary\b[^>]*>/gs),
      ].filter((m) => /level="settlement"/.test(m[0]));
      expect(all.length, "no settlement boundary found").toBeGreaterThan(0);
      for (const m of all) {
        const before = src.slice(Math.max(0, m.index! - 400), m.index!);
        expect(
          /\{[^}]*\blatestKmetstvo\b[^}]*\?\s*null\s*:/.test(before),
          "an ungated settlement boundary was added",
        ).toBe(true);
      }
    });
  },
);
