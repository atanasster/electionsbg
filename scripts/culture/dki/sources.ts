// МК ДКИ register (T3.1) — the ministry's own listings of the ДЪРЖАВНИ КУЛТУРНИ
// ИНСТИТУТИ it is the principal of. One source shared by the ingest AND the
// watcher (scripts/watch/sources/mc_dki_register.ts), the same rule the НФЦ
// register follows, so the page list cannot drift between them.
//
// WHY THIS EXISTS: `src/lib/kulturaReferenceData.ts` is hand-classified by
// PRINCIPAL, and its own header says principal „is still a human judgement, and
// T3.1 (МК's ДКИ register) is what will make it verifiable". This is that
// register — МК stating, on its own site, which institutes answer to it.
//
// ⚠️ THE REGISTER CARRIES NO EIK. Not one of the three pages prints a ЕИК, so
// this ingest can never BE the allowlist — it is the independent evidence the
// allowlist is checked against, and every EIK on it is resolved by name against
// the corpus, refusing ambiguity rather than guessing. Read `resolve.ts` before
// treating a resolved EIK as a fact about a named body.
//
// ⚠️ THE TLS TRUST ASSUMPTION. mc.government.bg serves an incomplete certificate
// chain, so both the ingest and the watcher pass `insecureTls` — which disables
// chain validation rather than supplying the missing intermediate. The pages are
// public and read-only, but the HTML drives a COMMITTED artifact that attributes
// procurement EIKs to named institutions, so tampering would be laundered into
// the register rather than merely displayed. If the intermediate is ever
// identified, pinning it via `ca:` is strictly better.
//
// ⚠️ IT IS ALSO NOT THE WHOLE OF МК. МК administers ~103 second-level spending
// units, of which ~74 are ДКИ (Дирекция СИХО, quoted in kulturaReferenceData's
// header). The national museums, galleries and the national library are МК
// second-level units that appear on NO ДКИ page — their register
// („РЕГИСТЪР НА МУЗЕИТЕ", /документи/регистри-1/) is a register of ALL museums
// regardless of principal. Coverage is therefore declared, never implied: see
// DKI_COVERAGE below.
//
// That museums register is a CLOSEABLE follow-up rather than a permanent
// boundary, and the reason to keep it out is sharper than „mostly municipal".
// Measured 2026-08-19 (an .xlsx, 688 rows / ~262 named museums) it carries a
// „Форма на собственост" column: общински 190, „х" 46, ДЪРЖАВЕН 17, частен 8,
// БПЦ 1. So the state-owned subset is enumerable — but `държавен` SPANS
// PRINCIPALS, which is the actual objection: of the 10 that resolve to an EIK,
// 3 are already in the roll-up, **5 are `adjacent`** (Национален
// военноисторически = МО; ИЕФЕМ, Природонаучен, НАИМ = БАН; Шипка-Бузлуджа,
// already `EXCLUDED_EIKS` as `mo`), and 2 are in no list at all —
// `131355961` „ДКИ Къща музей «Панчо Владигеров»" (МК's own label says ДКИ) and
// `107027015` Национален музей на образованието — Габрово. Folding `държавен`
// in wholesale would import МО and БАН museums into a culture roll-up: the
// exact defect the four-list split exists to prevent. Doing it properly is ~17
// hand-classified rows and would close the `notListed` gap below.

/** mc.government.bg serves these fine to a normal browser UA; the watcher's own
 *  self-identifying agent is not blocked here today, but the two must agree on
 *  what they send or a WAF change would flip one and not the other. */
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

/** The parse shape of a listing page. Three pages, three shapes — МК hand-built
 *  each one in a different editor, and a single parser over all three is how you
 *  get a director's name into an address field. One parser per shape, the same
 *  rule `interreg_parse.ts` follows. */
export type DkiShape =
  | "divs" // <div> per line, ALL-CAPS category headers, „Директор – X"
  | "paragraphs"; // <p> per institute, <br>-separated, „X, директор"

// There is deliberately NO `school_cards` shape. The училища page carries one
// `<div class="school-card">` — a half-finished redesign of its FIRST entry —
// beside the numbered <p> list that is the actual register. A parser written for
// the cards returns ONE school and looks like it worked. If МК ever finishes
// that redesign the <p> list goes away, the paragraphs parser trips the
// per-page floor in ingest.ts and the ingest REFUSES, which is the loud failure
// this note exists to guarantee.

export type DkiPage = {
  readonly id: string;
  readonly url: string;
  readonly label: string;
  readonly shape: DkiShape;
  /** What `kind` every institute parsed from this page gets. */
  readonly kind: "stage" | "theatre" | "art_school";
};

const AREA = "https://mc.government.bg/области-на-политики";
const STAGE = `${AREA}/сценични-изкуства-и-художествено-обр`;

export const DKI_PAGES: readonly DkiPage[] = [
  {
    id: "music_dance",
    url: `${STAGE}/направление-музика-и-танц/държавни-културни-институти-в-област/`,
    label:
      "Държавни културни институти в областта на музикалното и танцовото изкуство",
    shape: "divs",
    kind: "stage",
  },
  {
    id: "theatre",
    url: `${STAGE}/направление-театър/държавни-драматични-и-драматично-кук/`,
    label: "Държавни драматични и драматично-куклени театри",
    shape: "paragraphs",
    kind: "theatre",
  },
  {
    id: "art_schools",
    url: `${STAGE}/направление-художествено-о-32694/обучение-по-изкуства-и-култура-списък/`,
    label: "Обучение по изкуства и култура – списък на училищата",
    // NOT `school_cards`: the page's numbered <p> list is the register (23
    // schools); the one .school-card div is a half-finished redesign of its
    // first entry. Parsing the cards yields ONE school and looks like it worked.
    shape: "paragraphs",
    kind: "art_school",
  },
] as const;

/** The sentence any surface citing this register must be able to print. It is a
 *  constant rather than prose in a component because the one thing that must not
 *  happen is a page claiming register coverage the ingest does not have. */
export const DKI_COVERAGE = {
  /** What МК lists on the three pages this ingest reads. */
  covered: [
    "опери и музикално-драматични театри",
    "филхармонии и симфониети",
    "ансамбли",
    "драматични и куклени театри",
    "училища по изкуствата и по културата",
  ],
  /** МК-principal bodies that exist and are on NO ДКИ page. */
  notListed: [
    "национални музеи",
    "национални галерии",
    "националната библиотека",
  ],
  /** Дирекция СИХО's own figure, quoted in kulturaReferenceData's header. */
  dkiTotalPerMinistry: 74,
  secondLevelUnitsPerMinistry: 103,
} as const;
