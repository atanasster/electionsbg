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

const skip =
  !history || surfaceCycles.length === 0
    ? "no chmi history or no published local municipality surfaces"
    : "";
reportSkip(import.meta.url, skip);

const MAYOR_KINDS = new Set(["obshtina_mayor", "rayon_mayor"]);

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
      /\{showPartial \? null : \(/.test(before),
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
