// The SECOND-LEVEL МЗ family — the 53 institutions (55 EIKs) that are
// разпоредители под Министерството на здравеопазването without being part of
// it: the 28 ЦСМП plus the air ambulance, the 23 РЗИ, and НЦОЗА.
//
// ⚠⚠ THESE ARE NOT SECTOR MEMBERS, AND FOLDING THEM IN IS THE ONE THING THIS
// FILE EXISTS TO PREVENT. `HEALTH_SECTOR_EIKS` is МЗ + НЗОК and nothing else;
// healthReferenceData.ts's anti-allowlist names this family explicitly, and
// `sector_stats.data.test.ts` gates the exclusion from the corpus side. What
// this list is for is REACHABILITY: every one of these bodies already has a
// served `/awarder/:eik` page and none of them was reachable from the sector
// page they belong to, because /sector/health's only finder searches the НЗОК
// corpus (payments, pathways, INNs, packs) and these bodies take no НЗОК money.
// See docs/plans/health-mz-bodies-search-v1.md.
//
// Adding an EIK here changes what a READER CAN FIND. It must never change what
// the sector COUNTS — the hub headline is НЗОК's €4.72bn payout on a declared
// basis, and this family's €86.9m belongs to no total on that page.
// ⚠ `mzSecondLevelBodies.test.ts` (plan T4a) WILL assert disjointness at all
// three roster copies — NOT WRITTEN YET, so today that defence is this sentence
// and nothing else.
//
// ---------------------------------------------------------------------------
// Why its own module rather than an export in healthReferenceData.ts
//
//  · PAYLOAD. That file is imported by sectorDashboards.ts and sectorPacks.tsx,
//    so 55 entries there would load on EVERY sector dashboard — /sector/energy
//    paying for /sector/health's finder. Imported only by NzokSearchBox (itself
//    lazy()), this lands in that chunk and nowhere else. Same SHAPE as
//    lib/roadsAwarder.ts — an import-free constant module extracted so a busy
//    module need not name a big one. ⚠ But `src/entryGraph.test.ts` guards the
//    ENTRY chunk against the two sector registries and does NOT cover this: the
//    failure described here happens entirely inside already-lazy chunks, so
//    nothing fails if a later edit moves this list into healthReferenceData.ts.
//    The rule above is the only defence.
//  · MEANING. A 55-EIK export sitting in the file whose job is the two-EIK
//    sector roster is an invitation to fold it in.
//
// ---------------------------------------------------------------------------
// ⚠ CURATED BY EIK — a name pattern fails in BOTH directions
//
// `sector_stats.data.test.ts` sweeps the corpus by name, and that is right for
// what it does (an anti-leak check that must catch a body which starts matching
// after a rename). It is NOT a roster:
//
//  · it MISSES — „РИОКОЗ - Бургас" (000053451, 10 contracts / €58,038) matches
//    none of its three ILIKEs (note `%обществено здраве%` does NOT match
//    „обществе*ното* здраве"). Благоевград's twin IS caught, but not for the
//    reason it looks like: the register kept the modern „Регионална здравна
//    инспекция /РЗИ/" prefix in front of the historical name, so the second
//    ILIKE picks it up — nothing about the „Старо наименование … РИОКОЗ" text
//    is load-bearing;
//  · and a NAME-BASED roster would OVER-catch. This is a statement about the
//    roster we did not write, NOT a criticism of that sweep, which uses none of
//    these patterns: an acronym sweep on `%РЗИ%` matches „с. Бъ*рзи*я" and
//    „Злати Те*рзи*ев", and `%ЦСМП%` matches „А*МЦСМП*" — private ambulatory
//    clinics with no relation to МЗ.
//
// So the roster is hand-verified by EIK and the sweep stays what it is.
// `mz_second_level_bodies.data.test.ts` (plan T4b) is to reconcile the two in
// both directions, so that a rename or a newly-procuring body fails loudly
// instead of going missing. ⚠ NOT WRITTEN YET — until it lands, a body the
// corpus gains is simply absent here, silently.
//
// ---------------------------------------------------------------------------
// Measured 2026-08-26 against the local corpus, `tag = 'contract'` throughout
// (the plain bucket differs by ~7%; a table mixing the two bases is the
// tag-blindness trap CLAUDE.md documents):
//
//   ЦСМП   29 EIKs / 29 institutions  1,871 contracts  €66,516,209
//   РЗИ    25 EIKs / 23 institutions    533 contracts  €16,742,223
//   НЦОЗА   1 EIK  /  1 institution      77 contracts   €3,625,637
//   total  55 EIKs / 53 institutions  2,481 contracts  €86,884,070
//
// (The per-family € are each rounded, so they sum to €86,884,069; the total is
// the unrounded query, €86,884,070.27. The contract counts do reconcile.)
//
// ⚠ `healthReferenceData.ts`'s anti-allowlist quotes this same family as „54
// bodies / 2,467 contracts / €86.6m … 28 РЗИ". That is the SWEEP's result at an
// older corpus vintage, not this roster, and the two are different quantities:
// the sweep misses 000053451 (see CURATED BY EIK above), only 23 of the 28
// oblasts have РЗИ procurement (see FIVE РЗИ ARE ABSENT below), and its own
// 28+28+1 does not sum to the 54 it prints. THIS file is the roster; that one is
// the exclusion decision. Update it when this moves.
//
// Span 2011-01-05 → 2026-08-19. All 55 LAND: `institution_identity()` resolves
// for 55/55, so no entry needs `SectorMember.noAwarderPage` (membersIndex RULE
// 1) — a field of the type the CONSUMER adapts to, which its adapter never sets
// and which this type therefore deliberately does not carry.
//
// ⚠ Reader-facing prose quotes the INSTITUTION count (53), never the EIK count
// — the education roster documents the same distinction (126 EIKs, 125
// institutions). Two РЗИ carry both halves of their history; see `retired`.
//
// ---------------------------------------------------------------------------
// FIVE РЗИ ARE ABSENT, and that is the corpus rather than the list
//
// Разград, Сливен, Шумен, Ямбол and Софийска област have no РЗИ procurement in
// the corpus (23 РЗИ institutions against 28 oblasts). They are omitted rather
// than shipped as `noAwarderPage` rows: a row with nothing behind it is a dead
// end. ⚠ THE OMISSION DOES NOT YET RETIRE ITSELF: that argument rests on the
// T4b corpus→roster arm, which is not written, so nothing currently fails the
// day РЗИ Разград awards its first contract — exactly the „nobody would ever
// notice" shape `SectorMember.noAwarderPage`'s own comment warns about. Land
// T4b and this paragraph becomes true.
//
// ---------------------------------------------------------------------------
// Naming follows the РИОСВ precedent in environmentReferenceData.ts: a SHORT
// acronym-led Bulgarian label with the expansion in the universe label, and no
// separate English name. Two reasons, and the second is the load-bearing one:
//
//  · `latinSkeleton` transliterates Cyrillic→Latin, so „Blagoevgrad" already
//    matches „Благоевград" — an English name would add no search key, only 55
//    hand-invented strings nobody verifies. ⚠ ONE EXCEPTION, and it is the
//    capital: „София" folds to `sofiya`, so the ordinary English spelling
//    `sofia` matches nothing. The shliokavitsa arm covers how a Bulgarian
//    actually types it (`sofiq` → 1 hit), and the я→ya fold is site-wide rather
//    than anything this file can fix, so the gap is recorded, not papered over;
//  · the ACRONYM must be prefix-matchable. „ЦСМП" folds to „tssmp", which is not
//    a prefix of the folded full name — so a reader typing the one thing they
//    know would land in the contains tier at best. Leading with the acronym (and
//    repeating the family in the universe label, which is also a search key)
//    keeps it a prefix hit.
//
// ⚠⚠ THE PRICE OF THE ACRONYM-LED LABEL, AND THE ONE THING NOT TO TIDY AWAY:
// leading with „ЦСМП" removes the family noun from every row, so the universe
// label becomes the ONLY key carrying it — and a plural-only label does not
// match the singular. Measured: with „центрове" alone, „център за спешна
// медицинска помощ" returned **0 of 29**, and „инспекция" 1 of 25. That is the
// register's OWN spelling — every ЦСМП's `awarder_name` reads „Център за спешна
// медицинска помощ /ЦСМП/ - <place>", which is what `/awarder/:eik` renders — so
// a reader pasting a name off a contract page reproduced verbatim the „Няма
// съвпадения" this module exists to end, one family over. `latinSkeleton` folds
// „център"→`tsentar` and „центрове"→`tsentrove`, and neither contains the other.
// Hence BOTH numbers in every label — for the family noun, which is the word a
// reader copies off a contract page. Likewise the „Ведомства на МЗ" prefix:
// without it the ministry the group is named after matched 1 row of 55.
//
// That prefix is deliberately the PLURAL ALONE, which is the one place this file
// does not carry both numbers. It is not a register term — „ведомство" appears
// in no body's name and on no contract — it exists only as the search group's
// own heading in NzokSearchBox, so the string worth matching is the heading a
// reader can actually see. Keep the two in step: renaming the group means
// renaming this prefix, or the heading stops finding its own rows.

/** Which МЗ second-level family a body belongs to. */
export type MzBodyUniverse =
  | "csmp" // Центрове за спешна медицинска помощ (28 oblast centres + въздуха)
  | "rzi" // Регионални здравни инспекции (23 institutions, 25 EIKs)
  | "national"; // Национални центрове — НЦОЗА

export interface MzSecondLevelBody {
  readonly eik: string;
  /** Canonical Bulgarian label; the corpus carries spelling variants per EIK.
   *  Acronym-led so the acronym folds as a PREFIX — see the header. */
  readonly name: string;
  readonly universe: MzBodyUniverse;
  /** This row is a RETIRED EIK of the institution now filing under the EIK
   *  named here — the РИОКОЗ→РЗИ reissue of 2011. Both halves ship: dropping
   *  the retired row would strand its contracts on a page no search result
   *  points at, and the label carries „до YYYY" so it cannot be mistaken for the
   *  current body.
   *
   *  A POINTER rather than a boolean, following `retiredEikOf` in
   *  educationReferenceData.ts, and for that file's stated reason — it is what
   *  makes „how many institutions" answerable separately from „how many EIKs",
   *  and CHECKABLE: a flag would let a retired row whose successor is absent
   *  from this list silently take the institution count down with it. That is a
   *  live possibility here, not a hypothetical, because five РЗИ are omitted for
   *  having no procurement (below) — a РИОКОЗ predecessor of one of THEM turning
   *  up in the corpus is precisely the case a boolean would miscount.
   *
   *  ⚠ `universe` on a retired row is the SUCCESSOR's family: РИОКОЗ predates
   *  „РЗИ" and never belonged to it, so the sub-line names a family this body
   *  did not have. Grouping the pair together is still right — a fourth universe
   *  for two rows would be worse — and the „до YYYY" marker is what keeps them
   *  distinguishable. */
  readonly retiredEikOf?: string;
}

/** One row per distinct EIK, grouped by family and alphabetical within it.
 *
 *  Grouped by family; alphabetical by LABEL within a family (Bulgarian
 *  collation, so „Софийска" precedes „София" — й sorts before я), with two
 *  deliberate exceptions: a retired predecessor sits immediately after its
 *  successor so the pair reads as one institution, and the national air
 *  ambulance closes the ЦСМП block because it has no oblast seat.
 *
 *  ⚠ ARRAY ORDER IS RESULT ORDER — `buildMembersIndex` passes no `rank` to
 *  `buildEntityIndex`, which then keeps input order, and a broad query like
 *  „ЦСМП" matches 29 rows against a group limit of 8. Alphabetical is
 *  deterministic and explicable; a money order would be a figure in a reference
 *  file that goes stale with every reload. */
export const MZ_SECOND_LEVEL_BODIES: readonly MzSecondLevelBody[] = [
  { eik: "176094665", name: "НЦОЗА — Национален център по обществено здраве и анализи", universe: "national" }, // prettier-ignore

  { eik: "101045985", name: "ЦСМП — Благоевград", universe: "csmp" }, // prettier-ignore
  { eik: "812000140", name: "ЦСМП — Бургас", universe: "csmp" }, // prettier-ignore
  { eik: "813147200", name: "ЦСМП — Варна", universe: "csmp" }, // prettier-ignore
  { eik: "814221002", name: "ЦСМП — Велико Търново", universe: "csmp" }, // prettier-ignore
  { eik: "105001089", name: "ЦСМП — Видин", universe: "csmp" }, // prettier-ignore
  { eik: "106003602", name: "ЦСМП — Враца", universe: "csmp" }, // prettier-ignore
  { eik: "817073167", name: "ЦСМП — Габрово", universe: "csmp" }, // prettier-ignore
  { eik: "834052595", name: "ЦСМП — Добрич", universe: "csmp" }, // prettier-ignore
  { eik: "818035874", name: "ЦСМП — Кърджали", universe: "csmp" }, // prettier-ignore
  { eik: "109025529", name: "ЦСМП — Кюстендил", universe: "csmp" }, // prettier-ignore
  { eik: "820183588", name: "ЦСМП — Ловеч", universe: "csmp" }, // prettier-ignore
  { eik: "821179126", name: "ЦСМП — Монтана", universe: "csmp" }, // prettier-ignore
  { eik: "822114434", name: "ЦСМП — Пазарджик", universe: "csmp" }, // prettier-ignore
  { eik: "113010839", name: "ЦСМП — Перник", universe: "csmp" }, // prettier-ignore
  { eik: "000411973", name: "ЦСМП — Плевен", universe: "csmp" }, // prettier-ignore
  { eik: "825294069", name: "ЦСМП — Пловдив", universe: "csmp" }, // prettier-ignore
  { eik: "116000896", name: "ЦСМП — Разград", universe: "csmp" }, // prettier-ignore
  { eik: "827205133", name: "ЦСМП — Русе", universe: "csmp" }, // prettier-ignore
  { eik: "118001185", name: "ЦСМП — Силистра", universe: "csmp" }, // prettier-ignore
  { eik: "119002144", name: "ЦСМП — Сливен", universe: "csmp" }, // prettier-ignore
  { eik: "830176065", name: "ЦСМП — Смолян", universe: "csmp" }, // prettier-ignore
  { eik: "121312221", name: "ЦСМП — Софийска област", universe: "csmp" }, // prettier-ignore
  { eik: "121292046", name: "ЦСМП — София-град", universe: "csmp" }, // prettier-ignore
  { eik: "123004119", name: "ЦСМП — Стара Загора", universe: "csmp" }, // prettier-ignore
  { eik: "835030573", name: "ЦСМП — Търговище", universe: "csmp" }, // prettier-ignore
  { eik: "836154410", name: "ЦСМП — Хасково", universe: "csmp" }, // prettier-ignore
  { eik: "837077874", name: "ЦСМП — Шумен", universe: "csmp" }, // prettier-ignore
  { eik: "128019541", name: "ЦСМП — Ямбол", universe: "csmp" }, // prettier-ignore
  // The one ЦСМП that is national rather than seated in an oblast centre.
  { eik: "180958724", name: "ЦСМП по въздуха", universe: "csmp" }, // prettier-ignore

  { eik: "176030552", name: "РЗИ — Благоевград", universe: "rzi" }, // prettier-ignore
  { eik: "000022349", name: "РИОКОЗ — Благоевград (до 2012)", universe: "rzi", retiredEikOf: "176030552" }, // prettier-ignore
  { eik: "176032788", name: "РЗИ — Бургас", universe: "rzi" }, // prettier-ignore
  { eik: "000053451", name: "РИОКОЗ — Бургас (до 2011)", universe: "rzi", retiredEikOf: "176032788" }, // prettier-ignore
  { eik: "176032507", name: "РЗИ — Варна", universe: "rzi" }, // prettier-ignore
  { eik: "176031063", name: "РЗИ — Велико Търново", universe: "rzi" }, // prettier-ignore
  { eik: "176031615", name: "РЗИ — Видин", universe: "rzi" }, // prettier-ignore
  { eik: "176031444", name: "РЗИ — Враца", universe: "rzi" }, // prettier-ignore
  { eik: "176031095", name: "РЗИ — Габрово", universe: "rzi" }, // prettier-ignore
  { eik: "176031070", name: "РЗИ — Добрич", universe: "rzi" }, // prettier-ignore
  { eik: "176030723", name: "РЗИ — Кърджали", universe: "rzi" }, // prettier-ignore
  { eik: "176031298", name: "РЗИ — Кюстендил", universe: "rzi" }, // prettier-ignore
  { eik: "176030381", name: "РЗИ — Ловеч", universe: "rzi" }, // prettier-ignore
  { eik: "176030367", name: "РЗИ — Монтана", universe: "rzi" }, // prettier-ignore
  { eik: "176032140", name: "РЗИ — Пазарджик", universe: "rzi" }, // prettier-ignore
  { eik: "176030794", name: "РЗИ — Перник", universe: "rzi" }, // prettier-ignore
  { eik: "176030972", name: "РЗИ — Плевен", universe: "rzi" }, // prettier-ignore
  { eik: "176030673", name: "РЗИ — Пловдив", universe: "rzi" }, // prettier-ignore
  { eik: "176031120", name: "РЗИ — Русе", universe: "rzi" }, // prettier-ignore
  { eik: "176031978", name: "РЗИ — Силистра", universe: "rzi" }, // prettier-ignore
  { eik: "176032028", name: "РЗИ — Смолян", universe: "rzi" }, // prettier-ignore
  { eik: "176034554", name: "СРЗИ — Столична регионална здравна инспекция (София)", universe: "rzi" }, // prettier-ignore
  { eik: "176030488", name: "РЗИ — Стара Загора", universe: "rzi" }, // prettier-ignore
  { eik: "176031729", name: "РЗИ — Търговище", universe: "rzi" }, // prettier-ignore
  { eik: "176031316", name: "РЗИ — Хасково", universe: "rzi" }, // prettier-ignore
];

/** The sub-line under each row, and — because `buildMembersIndex` folds it as a
 *  search key — the reason „спешна помощ" and „инспекции" find the family
 *  without any body carrying those words in its own short label. */
export const MZ_UNIVERSE_LABEL: Record<
  MzBodyUniverse,
  { bg: string; en: string }
> = {
  csmp: {
    bg: "Ведомства на МЗ · ЦСМП — център/центрове за спешна медицинска помощ",
    en: "Ministry of Health bodies · ЦСМП — emergency medical care centre/centres",
  },
  rzi: {
    bg: "Ведомства на МЗ · РЗИ — регионална здравна инспекция/инспекции",
    en: "Ministry of Health bodies · РЗИ — regional health inspectorate/inspectorates",
  },
  national: {
    bg: "Ведомства на МЗ · национален център",
    en: "Ministry of Health bodies · national centre",
  },
};

/** Institutions, not EIKs — the two retired predecessor rows are the same two
 *  institutions as their successors. Quote THIS in reader-facing copy.
 *
 *  ⚠ NOT `MZ_SECOND_LEVEL_BODIES.length` (55). `DefenseSearchBox` interpolates
 *  `MO_ENTITIES.length` straight into its title, and that is correct THERE — МО
 *  has no retired EIKs — so copying its shape here publishes „55" for 53
 *  institutions, which is the one number the header forbids in reader-facing
 *  copy. */
export const MZ_SECOND_LEVEL_INSTITUTION_COUNT = MZ_SECOND_LEVEL_BODIES.filter(
  (b) => !b.retiredEikOf,
).length;
