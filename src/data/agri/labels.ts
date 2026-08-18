// The /subsidies module's SHARED copy — the strings and computed labels that appear on more
// than one of its twelve files (eleven routes; the hub and its ten pages).
//
// It sits beside `constants.ts` rather than under `src/screens/subsidies/` because both are
// module-wide, UI-facing and componentless, and every screen that needs one needs the other.
// (`subsidiesRegistry.ts` lives under screens/ instead — it is the HUB's data, not the
// module's.)
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY A MODULE FILE AND NOT ~175 i18n KEYS. Measured across the module AFTER this change:
// 183 `bg ? "…" : "…"` literal pairs, 175 distinct, and only 5 now appearing in more than one
// file. Before it: 259 pairs, 201 distinct, 23 cross-file. Either way ~90% is one-off page
// prose, and the inline ternary is this repo's convention for exactly that — 254 of 1,222
// screen files use it, `ProjectFileScreen.tsx` alone 132 times and `AdministrationScreen.tsx`
// 56. Converting one module to keys would make it the single page-copy outlier in the codebase
// and add ~350 locale entries nobody reuses.
//
// (Step 7 DID add 43 real i18n keys, for the tile registry — because that file is pure data
// with no `bg` in scope and cannot hold a ternary at all. These call sites have `bg` two lines
// up. The mechanism follows the constraint, not a house style.)
//
// What is here instead is the part that IS duplicated, and most of it is duplicated CODE
// rather than duplicated text:
//
//   • `formatScopeLabel` — computed identically in SEVEN files („Финансова година 2025" /
//     „Всички години"). Seven copies of one conditional is how six of them end up saying
//     „Financial year null" the day the payload's shape moves.
//   • `numberLocale` — `bg ? "bg-BG" : "en-US"` in TEN files. It is not copy at all; it is the
//     locale that gives Bulgarian its DECIMAL COMMA, and a page that gets it wrong renders
//     „49.3%" on a Bulgarian page with nothing failing.
//   • the table headers and card labels that appear on three or more pages, so a column called
//     „Получател" on one page is not „Бенефициент" on the next. That is not hypothetical:
//     „Област" was already rendering as „Province" on three pages and „Region" on two.
//
// THE BULGARIAN IS WRITTEN AS BULGARIAN, not as a translation of the English beside it —
// which is the actual requirement of the plan's step 8. „Изплатено" is what ДФЗ calls it,
// not „Платено"; „Обхват" rather than a calque of „scope"; „Няма данни за субсидии за 2019"
// rather than „Няма налични данни". The English is the second draft in every pair here.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** The Intl locale for a page's language. NOT decoration: `bg-BG` is what makes
 *  `toLocaleString` render a decimal COMMA and a non-breaking thousands space. */
export const numberLocale = (bg: boolean): string => (bg ? "bg-BG" : "en-US");

/** Column headers and card labels shared by three or more pages. One spelling per concept:
 *  a reader moving between the schemes table and the recipients table must not have to work
 *  out whether „Получател" and „Бенефициент" are the same column. */
export const agriLabel = {
  recipient: (bg: boolean) => (bg ? "Получател" : "Recipient"),
  scheme: (bg: boolean) => (bg ? "Схема" : "Scheme"),
  oblast: (bg: boolean) => (bg ? "Област" : "Province"),
  payments: (bg: boolean) => (bg ? "Плащания" : "Payments"),
  paid: (bg: boolean) => (bg ? "Изплатено" : "Paid"),
  atAGlance: (bg: boolean) => (bg ? "Накратко" : "At a glance"),
  scope: (bg: boolean) => (bg ? "Обхват" : "Scope"),
  latestYear: (bg: boolean) => (bg ? "Последна година" : "Latest year"),
  tryAgain: (bg: boolean) => (bg ? "Опитай отново" : "Try again"),
  searchRecipient: (bg: boolean) =>
    bg ? "търси получател…" : "search recipient…",
  /** The words alone — a table's column header. `formatScopeLabel` builds on this, so the
   *  column and the scope pill cannot end up calling the same thing two different names. */
  financialYear: (bg: boolean) => (bg ? "Финансова година" : "Financial year"),
} as const;

/** „Финансова година 2025" / „Всички години" — the window a page's figures are for.
 *
 *  Named `formatScopeLabel` rather than `scopeLabel` so a page can keep calling its own
 *  computed value `scopeLabel` without shadowing the import.
 *
 *  Takes the payload's own `scopeYear` rather than the URL scope, deliberately: the two can
 *  differ while a fetch is in flight, and the label must describe the numbers on screen, not
 *  the ones being fetched. `null` means the all-years payload. */
export const formatScopeLabel = (
  scopeYear: number | null | undefined,
  bg: boolean,
): string =>
  scopeYear != null
    ? `${agriLabel.financialYear(bg)} ${scopeYear}`
    : bg
      ? "Всички години"
      : "All years";
