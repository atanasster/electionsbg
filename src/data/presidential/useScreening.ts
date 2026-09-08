// One round's section screening — `<cycle>/tur<round>/section_screening.json`.
//
// ⚠⚠ „A SCREENING, NOT A VERDICT" LIVES IN THE FILE AND THIS HOOK REFUSES A FILE WITHOUT IT.
// The payload names polling stations, and the caveat also carries the invalid-ballot
// confound — that signal correlates with Roma population share (r = +0.36 at municipality
// level), with explanations such as ballot complexity. A surface cannot supply either
// sentence, which only works if a file that lost them never renders.
//
// ⚠ `discriminating` IS THE OTHER HALF, AND A CONSUMER MUST NOT SECOND-GUESS IT. Where the
// screen puts more than 5% of a cycle's scored sections above „low" — 2011 round 1 puts 16.0%
// there — the producer publishes NO names, and the band counts are what a surface renders
// instead.
//
// ⚠ A MISSING FILE IS `absent`, NOT AN ERROR. The four-state machine is `./guardedFetch`.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { guardedFetch, makeWarnOnce, num, str } from "./guardedFetch";

export type ScreeningBandId = "low" | "elevated" | "high" | "critical";

export interface ScreeningComponent {
  id: "invalidBallots" | "additionalVoters";
  rawPct: number;
  normalized: number;
  /** ⚠⚠ TRUE WHEN THE PROTOCOL DOES NOT ADD UP — more added voters than voters, 26 rows
   *  corpus-wide and up to 425%. A surface must NOT print the percentage in that state: it is
   *  not a ratio a reader can act on, it is a statement that the protocol is internally
   *  inconsistent — a different and stronger claim about a named station. */
  implausible?: boolean;
}

export interface ScreeningSection {
  code: string;
  oblast: string;
  ekatte?: string;
  placeName?: string;
  score: number;
  band: ScreeningBandId;
  /** ⚠ OFTEN 1, and a surface must say so. 2021 counted on machines, so only 1,722 of 10,967
   *  scored sections carry both signals — a one-signal score is that signal wearing a
   *  composite's grammar. */
  signalsAvailable: number;
  components: ScreeningComponent[];
}

export interface ScreeningBand {
  band: ScreeningBandId;
  count: number;
  /** Of the SCORED sections, 0-1. */
  share: number;
}

export interface PresidentialScreening {
  cycle: string;
  round: 1 | 2;
  basis: string;
  basisEn: string;
  coverage: {
    sections: number;
    scored: number;
    bothSignals: number;
    unscored: number;
    /** ⚠⚠ A FLOOR ON THE CONFOUND, NEVER ITS EXTENT. How many of the named sections sit in one
     *  of the eight curated flagged districts — so 0 means „none of these twenty is in those
     *  eight", never „no demographic confound". `null` means the overlap could not be measured
     *  on the machine that built the file, which must not render as a measured zero. */
    flaggedDistrictOverlap: number | null;
  };
  cuts: { elevated: number; high: number; critical: number };
  bands: ScreeningBand[];
  /** Share of SCORED sections above „low", 0-1 — the number `discriminating` is decided from.
   *  ⚠ READ IT, never re-derive it from the band counts: two producers of one number on the
   *  serving path is how a headline and the rows beneath it come to disagree. */
  elevatedShare: number;
  discriminating: boolean;
  top: ScreeningSection[];
}

/** ⚠ FOUR STATES, NOT A BOOLEAN — the presidential family's rule. */
export type PresidentialScreeningState =
  | { status: "loading" }
  | { status: "ready"; screening: PresidentialScreening }
  | { status: "absent" }
  | { status: "unusable" };

const BANDS: ReadonlySet<string> = new Set([
  "low",
  "elevated",
  "high",
  "critical",
]);

export const isPresidentialScreening = (
  v: unknown,
): v is PresidentialScreening => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  // ⚠ BOTH LANGUAGES. An EN reader of a file carrying only the Bulgarian sentence would get a
  // list of named polling stations under „скрининг" with no caveat and no confound.
  if (!str(o.basis) || !str(o.basisEn)) return false;
  const c = o.coverage as Record<string, unknown> | undefined;
  // ⚠ ALL FOUR, and `unscored` is the one the tile renders in its coverage line.
  if (
    !num(c?.sections) ||
    !num(c?.scored) ||
    !num(c?.bothSignals) ||
    !num(c?.unscored)
  )
    return false;
  // ⚠ NULL IS A PUBLISHED ANSWER („could not be measured") and must never render as a measured
  // zero, so the guard accepts it and rejects a string — the neighbourhood rates' rule.
  if (c?.flaggedDistrictOverlap !== null && !num(c?.flaggedDistrictOverlap))
    return false;
  const cuts = o.cuts as Record<string, unknown> | undefined;
  // The cut points travel so a surface can label a band without a second copy of them.
  if (!num(cuts?.elevated) || !num(cuts?.high) || !num(cuts?.critical))
    return false;
  if (typeof o.discriminating !== "boolean" || !num(o.elevatedShare))
    return false;
  // ⚠ THE WHOLE LADDER, NOT MERELY „AN ARRAY". The tile looks each band up by name and renders
  // „0 · 0%" for one it does not find, which is a claim that nothing was flagged.
  if (!Array.isArray(o.bands) || o.bands.length !== BANDS.size) return false;
  if (!Array.isArray(o.top)) return false;
  if (
    !(o.bands as unknown[]).every((b) => {
      const x = b as Record<string, unknown>;
      return (
        typeof b === "object" &&
        b !== null &&
        BANDS.has(x.band as string) &&
        num(x.count) &&
        num(x.share)
      );
    })
  )
    return false;
  // ⚠ EVERY LEAF A ROW DEREFERENCES. A section with no code names no station a reader could
  // check, on a list captioned „worth a closer look".
  return (o.top as unknown[]).every((t) => {
    const x = t as Record<string, unknown>;
    return (
      typeof t === "object" &&
      t !== null &&
      str(x.code) &&
      // ⚠ THE FALLBACK THE STATION NAME FALLS BACK TO. A row that lost both `placeName` and
      // `oblast` renders an empty name above a bare 9-digit code, on a list captioned „worth a
      // closer look" — a number the reader cannot check, which is what the code arm exists to
      // prevent.
      typeof x.oblast === "string" &&
      num(x.score) &&
      BANDS.has(x.band as string) &&
      num(x.signalsAvailable) &&
      Array.isArray(x.components) &&
      (x.components as unknown[]).every((cm) => {
        const y = cm as Record<string, unknown>;
        return (
          typeof cm === "object" &&
          cm !== null &&
          str(y.id) &&
          num(y.rawPct) &&
          num(y.normalized)
        );
      })
    );
  });
};

/** ⚠ „READY" IS NOT „HAS SOMETHING TO SAY". A round nothing could be scored for publishes four
 *  zero bands, which reads as „every section was clean" when the truth is that none was
 *  measurable. Gate a surface on this, never on the query status. */
export const hasScreeningContent = (s: PresidentialScreening): boolean =>
  s.coverage.scored > 0;

export const screeningPath = (cycle: string, round: 1 | 2): string =>
  `${cycle}/tur${round}/section_screening.json`;

const { warnOnce, reset } = makeWarnOnce();

/** Test-only: the guard above is module state, so a suite asserting on it needs a way back. */
export const __resetScreeningWarnings = reset;

export const fetchPresidentialScreening = async (
  cycle: string,
  round: 1 | 2,
): Promise<PresidentialScreeningState> => {
  const got = await guardedFetch({
    path: screeningPath(cycle, round),
    id: `${cycle}/tur${round}`,
    prefix: "sc",
    subject: "presidential screening",
    guard: isPresidentialScreening,
    shapeMessage:
      "missing the screening caveat, its bands or a named section — refusing to render it",
    warnOnce,
    toUrl: (path) => dataUrl(`/${path}`),
  });
  return got.status === "ready"
    ? { status: "ready", screening: got.value }
    : got;
};

export const usePresidentialScreening = (
  cycle: string | undefined,
  round: 1 | 2,
): PresidentialScreeningState => {
  const q = useQuery({
    queryKey: ["presidential_screening", cycle ?? "", round],
    queryFn: () => fetchPresidentialScreening(cycle as string, round),
    enabled: !!cycle,
  });
  return q.data ?? { status: "loading" };
};
