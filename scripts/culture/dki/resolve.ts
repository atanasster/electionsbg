// Name → EIK for the МК ДКИ register. THE RISKY HALF of this ingest, and the
// only part that can make a false claim about a named public body.
//
// The register prints no ЕИК (see sources.ts), so every id here is inferred from
// a name. The repo's standing rule — „a name match is not an identity" — applies
// in full: this module RESOLVES or REFUSES, and it never grades a guess. A
// refusal costs one row of coverage; a wrong resolution attributes another
// institution's procurement to a named theatre.
//
// The output feeds a RECONCILIATION, not the allowlist. `kulturaReferenceData`
// stays hand-classified; this says whether МК's own register agrees with it.

import { allRows } from "../../db/lib/pg";
import type { DkiEntry } from "./parse";

/** Institution-name fold. Deliberately NOT `cultureNameSql` — that one asks „is
 *  this name about culture at all" (a CLASSIFIER, tuned to admit ансамбъл and
 *  reject кооперация); this asks „are these two strings the same institution"
 *  (an IDENTIFIER). Merging them would make one set of exclusions govern both,
 *  which is how a matcher ends up excluding a real body from its own register. */
export const dkiNameFold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[„“”"'‘’«»]/g, "")
    // ь → ъ. The corpus holds „Държавен куклен ТЕАТЬР - ВАРНА" — a real spelling
    // in the award record — and one substituted letter is enough to make token
    // matching miss a body that is otherwise a perfect hit. Symmetric, so it can
    // only ever merge two spellings of one name, never two different names.
    .replace(/ь/g, "ъ")
    .replace(/[–—−]/g, "-")
    .replace(/[.,;:№#()]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Words that carry no identifying weight, so a subset match may not rest on
 *  them alone. „театър" + „варна" is an identification; „театър" is not. */
export const WEAK = new Set([
  "държавен",
  "държавна",
  "държавно",
  "национален",
  "национална",
  "национално",
  "театър",
  "училище",
  "по",
  "за",
  "и",
  "на",
  "център",
  "проф",
  "изкуствата",
  "изкуство",
]);

/** Stems the register actually abbreviates. A BARE PREFIX TEST IS NOT AN
 *  ABBREVIATION RULE, and the first cut of this was one:
 *  `"оператор".startsWith("опера")` is true, so „ДЪРЖАВНА ОПЕРА – БУРГАС"
 *  resolved to **Електроенергиен системен оператор ЕАД** — by name, the exact
 *  collision `src/lib/kulturaReferenceData.ts`'s header cites as the reason that
 *  file is a hand-classified allowlist and not a name regex. „ТЕАТЪР «Българска
 *  армия»" went to КОМДОС the same way (`българска`~`българската`), and the
 *  corpus holds hundreds of latent `константин`~`константинов` pairs — two
 *  different people, one prefix.
 *
 *  Only one real resolution depends on the rule at all (НУПИД „Акад. Дечко
 *  Узунов" against the record's „…Академик дечко Узунов"), so the allowlist
 *  costs nothing: measured, coverage is unchanged at 49/70. */
const ABBREV_STEMS = new Set([
  "акад",
  "проф",
  "доц",
  "инж",
  "полк",
  "ген",
  "архит",
]);

const abbrevOf = (a: string, b: string): boolean => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!(short.length >= 4 && short !== long && long.startsWith(short)))
    return false;
  return ABBREV_STEMS.has(short);
};

/** Words that name an institution KIND.
 *
 *  Bulgaria names a great many unrelated bodies after the same national figures
 *  in the same towns, and after `WEAK` strips the register side down, an entry
 *  frequently reduces to «person» + «town» — at which point one-way containment
 *  will accept ANY corpus body carrying those two tokens. Measured:
 *  „НАЦИОНАЛНО УЧИЛИЩЕ ПО ИЗКУСТВАТА «ПАНАЙОТ ПИПКОВ»" resolved to
 *  **Основно училище „Панайот Пипков" — гр. Ловеч**, a primary school; a
 *  synthetic „ДЪРЖАВЕН ТЕАТЪР «ИВАН ВАЗОВ» – ДОБРИЧ" reaches a maths gymnasium.
 *
 *  So on the arm where the corpus name is the LONGER one, its leftover tokens
 *  are judged: locative noise („софия", „гр", „/нгдек/") is fine, another
 *  institution type is not. All 8 real rInC-only resolutions leave only noise.
 *
 *  ⚠️ `училище` and `център` are in `WEAK`, so they are already stripped from
 *  the register side before this runs — which is exactly why they have to be
 *  listed here to be seen on the CORPUS side. */
const OTHER_KIND = new Set([
  "гимназия",
  "училище",
  "основно",
  "средно",
  "начално",
  "професионална",
  "техническа",
  "езикова",
  "болница",
  "община",
  "кметство",
  "прокуратура",
  "дирекция",
  "инспекция",
  "администрация",
  "управление",
  "университет",
  "институт",
  "комисия",
  "агенция",
  "стопанство",
  "оператор",
  "еад",
  "еоод",
  "оод",
]);

export const tokens = (folded: string): string[] =>
  folded.split(" ").filter((t) => t.length > 1);

/** The spelling a reader checks the match against — and it goes into a COMMITTED
 *  file, so it must not depend on the order Postgres happened to return.
 *  Measured before this: reversing the candidate array changed `corpusName` on
 *  **26 of 49** records (the EIK was stable on all of them), which is a diff
 *  indistinguishable from a real corpus change to whoever reviews the commit.
 *  Longest wins — it is the most informative spelling — lexicographic breaks
 *  the tie. */
const pickName = (hits: readonly Candidate[]): string =>
  [...hits].sort(
    (a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name),
  )[0].name;

/** One EIK may appear under several spellings; a refusal should name each body
 *  once. Shared by both passes — the exact pass used to return them raw. */
const distinctByEik = (
  hits: readonly Candidate[],
): { eik: string; name: string }[] =>
  [...new Map(hits.map((c) => [c.eik, c])).values()].map((c) => ({
    eik: c.eik,
    name: c.name,
  }));

export type DkiResolution =
  | {
      status: "resolved";
      eik: string;
      corpusName: string;
      basis: "exact" | "tokens";
    }
  | {
      status: "ambiguous";
      candidates: readonly { eik: string; name: string }[];
    }
  | { status: "unmatched" };

export type Candidate = {
  eik: string;
  name: string;
  fold: string;
  tokens: string[];
};

/** Build one candidate the way `loadBuyerCandidates` does. Exported so a test
 *  cannot hand-roll a second, subtly different fold — the `councilNameKey()`
 *  divergence in CLAUDE.md is what that costs. */
export const candidateOf = (eik: string, name: string): Candidate => {
  const fold = dkiNameFold(name);
  return { eik, name, fold, tokens: tokens(fold) };
};

/** Every (eik, name) a Bulgarian public buyer appears under, from BOTH corpora.
 *  Contracts alone is not enough: a ДКИ that published procedures and awarded
 *  nothing in the window exists only in `tenders`, and resolving it from the
 *  award side would report it as „not in the corpus" — the same contracts-only
 *  blindness the register gate was built to end. */
export const loadBuyerCandidates = async (): Promise<Candidate[]> => {
  const rows = await allRows<{ eik: string; name: string }>(
    // EVERY distinct spelling, not one per EIK. A first cut took
    // `max(awarder_name)` and matched against that single string — which for ЕИК
    // 000083665 is „Държавен куклен театьр - варна", the typo'd variant, so the
    // Varna puppet theatre resolved to nothing while three of its other
    // spellings would have matched outright. A public buyer averages several
    // spellings in this corpus and any of them may be the one that matches.
    `SELECT DISTINCT awarder_eik AS eik, awarder_name AS name
       FROM contracts
      WHERE awarder_eik IS NOT NULL AND awarder_name IS NOT NULL
      UNION
     SELECT DISTINCT buyer_eik AS eik, buyer_name AS name
       FROM tenders
      WHERE buyer_eik IS NOT NULL AND buyer_name IS NOT NULL
      ORDER BY 1, 2`,
  );
  return rows.map((r) => candidateOf(String(r.eik), r.name));
};

/** One register entry against the corpus.
 *
 *  Two passes, and the ORDER is the safety property: an exact fold match wins
 *  outright, so a body whose name is also a prefix of a longer one cannot be
 *  dragged into an ambiguity by the weaker pass. */
export const resolveEntry = (
  entry: DkiEntry,
  candidates: readonly Candidate[],
): DkiResolution => {
  const fold = dkiNameFold(entry.name);
  const want = tokens(fold);
  if (!want.length) return { status: "unmatched" };

  const byEik = (hits: readonly Candidate[]) => {
    const eiks = [...new Set(hits.map((h) => h.eik))];
    return eiks;
  };

  const exact = candidates.filter((c) => c.fold === fold);
  const exactEiks = byEik(exact);
  if (exactEiks.length === 1)
    return {
      status: "resolved",
      eik: exactEiks[0],
      corpusName: pickName(exact),
      basis: "exact",
    };
  if (exactEiks.length > 1)
    return {
      status: "ambiguous",
      candidates: distinctByEik(exact),
    };

  // Token overlap, BIDIRECTIONAL — both directions occur and both carry weight.
  // „ДРАМАТИЧНО-КУКЛЕН ТЕАТЪР «ИВАН ДИМОВ» – ХАСКОВО" against the record's
  // „ДРАМАТИЧНО-КУКЛЕН Театър «Иван Димов»" is corpus ⊂ register;
  // „КУКЛЕН ТЕАТЪР – БУРГАС" against „Държавен куклен театър град бургас" is
  // register ⊂ corpus. Measured 2026-08-19 over the 70-entry register:
  // both = 49 resolved, register-⊂-corpus only = 46, corpus-⊂-register only = 42.
  //
  // (An earlier version of this comment cited a „Драматичен театър Гео Милев"
  // corpus row to justify the same rule. No such row exists — all 16 „Гео Милев"
  // EIKs are schools — and its „27 of 70" figure reproduced neither way. The rule
  // was right and the evidence for it was invented, which in a file whose
  // comments ARE its safety documentation is its own kind of defect.)
  const strong = new Set(want.filter((t) => !WEAK.has(t)));
  // With no distinctive token left, „театър" would match every theatre in the
  // country. Refuse rather than take the first.
  if (!strong.size) return { status: "unmatched" };
  const hits = candidates.filter((c) => {
    const cs = new Set(c.tokens.filter((t) => !WEAK.has(t)));
    if (!cs.size) return false;
    const has = (set: ReadonlySet<string>, t: string): boolean =>
      set.has(t) || [...set].some((u) => abbrevOf(t, u));
    const shared = [...strong].filter((t) => has(cs, t)).length;
    // TWO shared distinctive tokens minimum. One is „куклен", which the bare
    // „Държавен куклен театър" (used by two different EIKs) shares with every
    // puppet theatre in the register.
    if (shared < 2) return false;
    const rInC = [...strong].every((t) => has(cs, t));
    const cInR = [...cs].every((t) => has(strong, t));
    // When the CORPUS name is the shorter one there is nothing left over
    // to judge, so that direction stands on its own.
    if (cInR) return true;
    if (!rInC) return false;
    // Otherwise the corpus name has tokens the register does not explain.
    // Noise is fine; another institution type means a different body.
    return ![...cs].some((t) => !has(strong, t) && OTHER_KIND.has(t));
  });
  const hitEiks = byEik(hits);
  if (hitEiks.length === 1)
    return {
      status: "resolved",
      eik: hitEiks[0],
      corpusName: pickName(hits),
      basis: "tokens",
    };
  if (hitEiks.length > 1)
    return {
      status: "ambiguous",
      candidates: distinctByEik(hits),
    };
  return { status: "unmatched" };
};
