// Curated source map for the ВСС annual "Обобщени статистически таблици за
// дейността на съдилищата" (vss.justice.bg → Съдебна статистика, регистри).
//
// The filenames are NOT uniform across years (total-tables-YYYY.pdf,
// otchet-YYYY.pdf, Statistika-YYYY.pdf, Obobshteni-statisticheski-tablici-…),
// so this is a hand-curated map rather than a URL pattern — same convention as
// the CIK bundle URLs. Add a year here when the ВСС publishes it; the watcher
// (vss_court_statistics) fingerprints the listing page so a new link shows up.
//
// Each PDF is ~5-30 MB with a real text layer (fonts + ToUnicode) — no OCR
// needed. Cached under raw_data/judiciary/ (gitignored, regenerable).

export const VSS_STATS_PAGE = "https://vss.justice.bg/page/view/1082";

// ------------------------------------------------- ИВСС declaration register --

/** The declarations register the ИВСС links to as "Публикувани декларации": a
 *  Joomla site on a bare IP over plain HTTP. There is no https and no hostname —
 *  this is what the Inspectorate publishes. If the IP ever moves, the link on
 *  IVSS_PAGE is the authority; update it here and both the ingest and the watcher
 *  follow.
 *
 *  TRUST BOUNDARY. Because there is no TLS, anyone who can observe or modify
 *  traffic to this address chooses the magistrate names, входящи номера and PDF
 *  paths that get committed to data/judiciary/declarations.json and published —
 *  claims about named private individuals. The writer's asserts catch structural
 *  damage, not a plausible substituted name. Run the ingest from a trusted
 *  network, read the diff before committing, and do not widen what is scraped
 *  from this host without revisiting the note in
 *  .claude/skills/update-judiciary/SKILL.md. Switch to https the day the ИВСС
 *  offers it. */
export const IVSS_REGISTER = "http://62.176.124.194";

/** The ИВСС page that links to the register and hosts the non-compliance lists. */
export const IVSS_PAGE = "https://www.inspectoratvss.bg/bg/page/129";

/** The ИВСС's own non-compliance lists, each keyed by the ЗСВ text it enforces.
 *
 *  `cols` is asserted at ingest, not merely tolerated: the discrepancy list
 *  carries a fifth column ("Вид декларация") the others don't, and a silent
 *  truncation would drop the one field that says what the finding was about. If
 *  the ИВСС changes a table's shape, the parser must fail loudly. */
export const INTEGRITY_PAGES = [
  {
    id: "annual_late",
    page: 131,
    cols: 4,
    legalRef: "чл. 175а, ал. 1, т. 1 вр. чл. 175в, ал. 1, т. 1 ЗСВ",
    bg: "Неподали в срок годишна декларация",
    en: "Failed to file the annual declaration on time",
  },
  {
    id: "change_late",
    page: 130,
    cols: 4,
    legalRef: "чл. 175а, ал. 1, т. 1 вр. чл. 175в, ал. 1, т. 2 ЗСВ",
    bg: "Неподали в срок декларация за промяна",
    en: "Failed to file a change declaration on time",
  },
  {
    id: "left_office_late",
    page: 143,
    cols: 4,
    legalRef: "чл. 175а, ал. 1, т. 1 вр. чл. 175в, ал. 1, т. 3 ЗСВ",
    bg: "Напуснали длъжността, без да подадат декларация в срок",
    en: "Left office without filing on time",
  },
  {
    id: "discrepancy",
    page: 160,
    cols: 5,
    extraBg: "Вид декларация",
    extraEn: "Declaration type",
    legalRef: "чл. 175ж, ал. 2 ЗСВ",
    bg: "Установено несъответствие, неотстранено в срок",
    en: "Discrepancy found and not corrected in time",
  },
] as const;

/** The ИВСС footnote marker appended to a name on a non-compliance list.
 *  Legend, verbatim from every list page:
 *    „(1) - лицето е подало декларация извън срока"
 *  i.e. the person DID file — after the statutory deadline. A name WITHOUT the
 *  marker never filed at all. Those are materially different statements about a
 *  named private individual, so the flag is carried through to the UI. */
export const FILED_LATE_MARKER = /\(1\)\s*$/;

/** Visible text of an HTML fragment, tags and entities removed. Re-exported so
 *  the declarations writer and the ИВСС watcher keep importing it from here. */
export { stripHtml } from "../lib/html";

export const VSS_ANNUAL_TABLES: Record<number, string> = {
  2018: "https://vss.justice.bg/root/f/upload/22/Statistika-2018-sait.pdf",
  2019: "https://vss.justice.bg/root/f/upload/27/Statistika-2019.pdf",
  2020: "https://vss.justice.bg/root/f/upload/31/otchet-2020.pdf",
  2021: "https://vss.justice.bg/root/f/upload/35/Obobshteni-statisticheski-tablici-2021_new.pdf",
  2022: "https://vss.justice.bg/root/f/upload/39/total-tables-2022.pdf",
  2023: "https://vss.justice.bg/root/f/upload/42/total-tables-2023.pdf",
  2024: "https://vss.justice.bg/root/f/upload/44/total-tables-2024.pdf",
  2025: "https://vss.justice.bg/root/f/upload/48/total-tables-2025.pdf",
};

/** The six court tiers of Приложение № 1, in the table's own row order. The
 *  labels drift slightly across years (the specialised criminal court СНС was
 *  folded into "Окръжни съдилища + СГС + СНС" until it closed in 2022), so rows
 *  are keyed by ORDER + numeric-cell count, never by label text. */
export const COURT_LEVELS: { id: string; bg: string; en: string }[] = [
  { id: "apelativni", bg: "Апелативни съдилища", en: "Courts of appeal" },
  { id: "voenni", bg: "Военни съдилища", en: "Military courts" },
  {
    id: "okrazhni",
    bg: "Окръжни съдилища + СГС",
    en: "Regional courts + Sofia City Court",
  },
  {
    id: "rs_oblast",
    bg: "Районни съдилища в областните центрове + СРС",
    en: "District courts in oblast centres + Sofia District Court",
  },
  {
    id: "rs_izvan",
    bg: "Районни съдилища извън областните центрове",
    en: "District courts outside oblast centres",
  },
  {
    id: "administrativni",
    bg: "Административни съдилища",
    en: "Administrative courts",
  },
];
