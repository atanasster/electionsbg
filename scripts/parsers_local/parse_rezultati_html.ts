// Scrape a single per-município HTML page from results.cik.bg for:
//   - the mayor result (both tur1 candidates and, when present, the tur2
//     runoff winners)
//   - the council result with the elected-candidate list (the "Мандати"
//     column is the source-of-truth for who got elected after preference
//     re-ranking)
//   - kmetstvo mayor results (one block per village seat)
//   - район mayor results (Sofia/Plovdiv/Varna only)
//
// CIK's HTML markup is undocumented but stable in mi2019/mi2023. The
// gold structural markers we rely on:
//   • <tr class="elected"> on a party row = party won at least one seat
//     (or, on a mayor table, this candidate is one of the top-2 / winner)
//   • candidate-elected class on a <tr class="candidate ..."> = this
//     councillor was elected (list-position or preference-bumped)
//   • <th>Мандати</th> in the table head distinguishes council tables
//     (5 columns) from mayor/kmetstvo tables (4 columns)
//
// Defensive: every parsed block emits a sanity-check log so a CIK
// re-render surfaces immediately. Counts are cross-checked when the
// orchestrator joins with vote totals from votes.txt.

import { load, CheerioAPI, Cheerio } from "cheerio";
import { Element } from "domhandler";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import {
  LocalCouncilCandidate,
  LocalCouncilParty,
  LocalDistrictMayorResult,
  LocalKmetstvoResult,
  LocalMayorResult,
  LocalRound,
} from "./types";
import { buildByNickNameLower, resolveLocalParty } from "./local_coalitions";
import { titleCasePersonName } from "./text";

// Heading regexes are deliberately broad: 2019/2023 use "Обобщени данни от
// избор на ...", 2015 (minr2015) uses "Резултати за кмет на община" / "...
// общински съвет", 2011 (mipvr2011) has no per-race headings at all and the
// parser falls back to header-column classification on the bare tables.
const SECTION_HEADINGS = {
  mayorObshtina:
    /(?:Обобщени данни от избор|Резултати за(?:\s+избор)?\s+на|Резултати за)\s+кмет\s+на\s+община/i,
  council:
    /(?:Обобщени данни от избор|Резултати за(?:\s+избор)?\s+на|Резултати за)(?:\s+избор\s+на)?\s+общински\s+съвет/i,
  mayorKmetstvo:
    /избор\s+на\s+кмет\s+на\s+кметство|Резултати за кмет на кметство/i,
  mayorDistrict: /избор\s+на\s+кмет\s+на\s+район|Резултати за кмет на район/i,
};

// Tidy whitespace from a TD's text.
const txt = ($el: Cheerio<Element>): string =>
  $el
    .text()
    .replace(/\u00a0/g, " ") // &nbsp;
    .replace(/\s+/g, " ")
    .trim();

const parseIntLoose = (s: string): number => {
  const n = parseInt(s.replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
};

const parsePct = (s: string): number => {
  const n = parseFloat(s.replace("%", "").replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
};

// Walk all tables under the same heading. CIK renders one table per
// race-type block (mayor / council / kmetstvo seat). We collect tables
// between two consecutive headings.
type Section = {
  heading: string;
  tables: Cheerio<Element>[];
};

const collectSections = ($: CheerioAPI): Section[] => {
  const sections: Section[] = [];
  let current: Section | null = null;
  // CIK uses h2 / h3 headings to introduce each race type.
  $("h1, h2, h3, h4, .section-title").each((_, el) => {
    const heading = txt($(el));
    if (!heading) return;
    if (current) sections.push(current);
    current = { heading, tables: [] };
  });
  if (current) sections.push(current);

  // Tables aren't reliably nested under their headings in the DOM, so
  // walk linearly: associate each <table> with the most recent heading
  // that precedes it in document order.
  const all = $("h1, h2, h3, h4, .section-title, table").toArray();
  let activeHeading: string | null = null;
  let activeSection: Section | null = null;
  for (const node of all) {
    const tag = (node as Element).tagName?.toLowerCase();
    if (
      tag === "h1" ||
      tag === "h2" ||
      tag === "h3" ||
      tag === "h4" ||
      (node as Element).attribs?.class?.includes?.("section-title")
    ) {
      activeHeading = txt($(node));
      activeSection = sections.find((s) => s.heading === activeHeading) ?? {
        heading: activeHeading,
        tables: [],
      };
      if (!sections.includes(activeSection)) sections.push(activeSection);
    } else if (tag === "table" && activeSection) {
      activeSection.tables.push($(node));
    }
  }
  return sections;
};

// Classify a table by its header row. Falls back to scanning the first
// row of <th> in <tr> when there's no explicit <thead> (2011/2015 layout).
type TableKind = "mayor" | "council" | "unknown";
const classifyTable = ($: CheerioAPI, $table: Cheerio<Element>): TableKind => {
  let headers = $table
    .find("thead th")
    .map((_, th) => txt($(th)))
    .get();
  if (headers.length === 0) {
    headers = $table
      .find("tr")
      .first()
      .find("th")
      .map((_, th) => txt($(th)))
      .get();
  }
  if (headers.some((h) => /Мандати/i.test(h))) return "council";
  if (headers.some((h) => /Кандидат/i.test(h))) return "mayor";
  // Some council tables (2015) lead with "Партия" — only flag mayor when a
  // candidate column is present, otherwise let the council branch claim it.
  if (headers.some((h) => /Гласове|Партия/i.test(h))) return "mayor";
  return "unknown";
};

// Parse a mayor-style table (4 cols: №, candidate+party, votes, %). The
// candidate cell stacks <strong>NAME</strong><br/>PARTY_NAME.
//
// Tolerant to two pre-2019 variants:
//   - 2011: 4 cols, no row-level classes → winner is inferred post-pass
//   - 2015: 4 cols, "Разпределение" instead of "%" but same shape
// Also tolerant when the first body row uses <th> cells (pre-2019 layouts
// don't always carry a <thead>).
const parseMayorTable = (
  $: CheerioAPI,
  $table: Cheerio<Element>,
  round: LocalRound,
  byNickNameLower: Map<string, string>,
): LocalMayorResult[] => {
  const out: LocalMayorResult[] = [];
  const $rows = $table.find("tbody tr");
  const rows = $rows.length > 0 ? $rows : $table.find("tr");
  rows.each((_, tr) => {
    const $tr = $(tr);
    const cls = $tr.attr("class") ?? "";
    if (cls.includes("graph-row")) return;
    const tds = $tr.find("td");
    if (tds.length < 3) return;
    // Skip "Не подкрепям никого" rows (the № cell is "-").
    const numRaw = txt(tds.eq(0));
    if (!/^\d/.test(numRaw)) return;
    const localPartyNum = parseIntLoose(numRaw);
    const $name = tds.eq(1);
    // 2019/2023 wrap the candidate name in <strong>; 2015 swaps the
    // wrappers, putting the party in <em> and leaving the candidate name
    // as the bare text node. Try strong → em → split-on-br in that order.
    const $strong = $name.find("strong").first();
    const $em = $name.find("em").first();
    let candidateName = txt($strong);
    let partyName = "";
    if (candidateName) {
      partyName = txt($name)
        .replace(candidateName, "")
        .trim()
        .replace(/^[,;:\s]+/, "");
    } else if ($em.length > 0) {
      partyName = txt($em);
      candidateName = txt($name)
        .replace(partyName, "")
        .trim()
        .replace(/[,;:\s]+$/, "");
    } else {
      const html = $name.html() ?? "";
      const parts = html.split(/<br\s*\/?>/i);
      candidateName = parts[0] ? txt($("<div>").append(parts[0])) : "";
      partyName = parts[1]
        ? txt($("<div>").append(parts.slice(1).join("<br>")))
        : "";
    }
    const votes = parseIntLoose(txt(tds.eq(2)));
    const pct = tds.length >= 4 ? parsePct(txt(tds.eq(3))) : 0;
    const resolution = resolveLocalParty(partyName, byNickNameLower);
    out.push({
      candidateName: titleCasePersonName(candidateName),
      localPartyNum,
      localPartyName: partyName,
      primaryCanonicalId: resolution.primaryCanonicalId,
      memberCanonicalIds: resolution.memberCanonicalIds,
      isIndependent: resolution.isIndependent,
      round,
      votes,
      pctOfValid: pct,
      isElected: cls.includes("elected"),
    });
  });
  // Winner inference for 2011 (no per-row class marker): round 1 winner is
  // a candidate with strictly > 50% of valid votes; round 2 winner is the
  // candidate with the most votes (always exactly one). Skip if any row
  // already carries the elected class — old cycles either all-or-nothing.
  const anyMarked = out.some((m) => m.isElected);
  if (!anyMarked && out.length > 0) {
    if (round === 2) {
      const max = out.reduce(
        (acc, m) => (m.votes > acc.votes ? m : acc),
        out[0],
      );
      max.isElected = true;
    } else {
      const over50 = out.find((m) => m.pctOfValid > 50);
      if (over50) over50.isElected = true;
    }
  }
  return out;
};

// Detect council-table column layout. Three shapes ship in the wild:
//   A) 5-col current (2019/2023): № Партия Гласове % Мандати + candidate rows
//   B) 4-col 2011 (mipvr2011):    Партия-with-embedded-list Гласове % Мандати
//   C) 3-col 2015 (minr2015):     № Партия Мандати   (no votes/% at all)
// We map each named column to its index by scanning the header row.
type CouncilCols = {
  hasNumCol: boolean;
  nameCol: number;
  voteCol: number | null;
  pctCol: number | null;
  mandateCol: number;
};

const detectCouncilCols = (
  $: CheerioAPI,
  $table: Cheerio<Element>,
): CouncilCols => {
  let heads = $table
    .find("thead th")
    .map((_, th) => txt($(th)))
    .get();
  if (heads.length === 0) {
    heads = $table
      .find("tr")
      .first()
      .find("th")
      .map((_, th) => txt($(th)))
      .get();
  }
  const cols: CouncilCols = {
    hasNumCol: false,
    nameCol: -1,
    voteCol: null,
    pctCol: null,
    mandateCol: -1,
  };
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    if (/^№/.test(h.trim())) cols.hasNumCol = true;
    if (
      cols.nameCol === -1 &&
      /Партия|Коалиция|Политически|Кандидат/i.test(h)
    ) {
      cols.nameCol = i;
    } else if (/Гласове|Действителни/i.test(h)) cols.voteCol = i;
    else if (/^%|Разпределение/i.test(h)) cols.pctCol = i;
    else if (/Мандати/i.test(h)) cols.mandateCol = i;
  }
  if (cols.nameCol === -1) cols.nameCol = cols.hasNumCol ? 1 : 0;
  return cols;
};

// Parse a council-style table. Per-candidate breakdown is only populated
// for the 5-col layout (2019/2023, with `tr.candidate` rows); older cycles
// either embed the list inside the party cell (2011) or omit it entirely
// (2015) and we leave `candidates: []` — the downstream tile reads
// `mandatesWon` from the party row directly.
const parseCouncilTable = (
  $: CheerioAPI,
  $table: Cheerio<Element>,
  byNickNameLower: Map<string, string>,
): LocalCouncilParty[] => {
  const cols = detectCouncilCols($, $table);
  const out: LocalCouncilParty[] = [];
  let current: LocalCouncilParty | null = null;
  const $rows = $table.find("tbody tr");
  const rows = $rows.length > 0 ? $rows : $table.find("tr").slice(1);
  rows.each((_, tr) => {
    const $tr = $(tr);
    const cls = $tr.attr("class") ?? "";
    if (cls.includes("graph-row")) return;
    const tds = $tr.find("td");
    if (tds.length === 0) return;
    const isCandidate = cls.includes("candidate");
    if (isCandidate) {
      if (!current) return;
      // 2019/2023 only — candidate cell text: " 101. Name Name Name "
      const cellText = txt(tds.eq(cols.nameCol));
      const match = cellText.match(/^(\d+)\.\s*(.*)$/);
      if (!match) return;
      const listPos = parseInt(match[1], 10);
      const name = match[2].trim();
      const prefVotes =
        cols.voteCol != null ? parseIntLoose(txt(tds.eq(cols.voteCol))) : 0;
      const prefPct =
        cols.pctCol != null ? parsePct(txt(tds.eq(cols.pctCol))) : 0;
      const cand: LocalCouncilCandidate = {
        listPos,
        name: titleCasePersonName(name),
        prefVotes,
        prefPct,
        isElected: cls.includes("candidate-elected"),
      };
      current.candidates.push(cand);
      return;
    }
    // Party-summary row.
    // Skip "Не подкрепям никого" / footer rows: the first cell must start
    // with a digit when there's a № column, or the name cell's first chunk
    // must look like a party name otherwise.
    if (cols.hasNumCol) {
      const numRaw = txt(tds.eq(0));
      if (!/^\d/.test(numRaw)) {
        current = null;
        return;
      }
    }
    const localPartyNum = cols.hasNumCol
      ? parseIntLoose(txt(tds.eq(0)))
      : (() => {
          // 2011 embeds "N. PartyName<br>candidate-list..." in the name
          // cell. Pull N off the prefix; if absent (independent), 0.
          const lead = txt(tds.eq(cols.nameCol)).split(/\s+/)[0] ?? "";
          return /^\d/.test(lead) ? parseIntLoose(lead) : 0;
        })();
    // Party name: take strong if present, else strip the leading "N. "
    // (2011) and the candidate list that follows.
    const $nameCell = tds.eq(cols.nameCol);
    const strong = txt($nameCell.find("strong").first());
    let partyName: string;
    if (strong) {
      partyName = strong;
    } else {
      const cellHtml = $nameCell.html() ?? "";
      const firstChunk = cellHtml.split(/<br\s*\/?>/i)[0] ?? "";
      partyName = txt($("<div>").append(firstChunk))
        .replace(/^\d+\.\s*/, "")
        .trim();
    }
    const totalVotes =
      cols.voteCol != null ? parseIntLoose(txt(tds.eq(cols.voteCol))) : 0;
    const pct = cols.pctCol != null ? parsePct(txt(tds.eq(cols.pctCol))) : 0;
    const mandates =
      cols.mandateCol >= 0 && tds.length > cols.mandateCol
        ? parseIntLoose(txt(tds.eq(cols.mandateCol)))
        : 0;
    const resolution = resolveLocalParty(partyName, byNickNameLower);
    current = {
      localPartyNum,
      localPartyName: partyName,
      primaryCanonicalId: resolution.primaryCanonicalId,
      memberCanonicalIds: resolution.memberCanonicalIds,
      isIndependent: resolution.isIndependent,
      totalVotes,
      pctOfValid: pct,
      mandatesWon: mandates,
      candidates: [],
    };
    out.push(current);
  });
  return out;
};

export type ParsedRezultatiPage = {
  oikCode: string;
  round: LocalRound;
  /** Município name extracted from the page header (e.g. "Благоевград"). */
  municipalityName: string;
  /** Oblast name extracted from the page header (e.g. "Благоевград"). */
  oblastName: string;
  mayor: LocalMayorResult[]; // candidates for KO (município mayor)
  council: LocalCouncilParty[]; // ОС
  kmetstva: LocalKmetstvoResult[]; // KK
  districts: LocalDistrictMayorResult[]; // KR
  /** Diagnostic counts so the orchestrator can flag suspicious parses. */
  diagnostics: {
    mayorTableCount: number;
    councilTableCount: number;
    kmetstvoTableCount: number;
    electedMayors: number;
    totalMandatesWon: number;
    electedCouncillors: number;
  };
};

// Extract município + oblast name from the page header. mi2023 layout has
// TWO <h1>s: the first is the global "Местни избори 29 октомври 2023"
// banner, the second carries "Община <name>, област <oblast>" (or just
// "<name>, област <oblast>" for some pages). We scan all h1 / .title-block
// nodes for the "област" pattern and use whichever matches first.
const MUNI_OBLAST_RE = /(?:Община\s+)?(.+?),\s*област\s+(.+?)(?:\s+\|.*)?$/i;
// Pre-2019 cycles publish the município name as "Резултати за община NAME"
// in a breadcrumb (2015) or H2 (2011), with the oblast missing — the
// orchestrator backfills oblast from MUNICIPALITIES via resolveByName.
const MUNI_ONLY_RE = /Резултати за община\s+([^,|]+?)(?:\s*[|<]|$)/i;

const extractNames = (
  $: CheerioAPI,
): { municipalityName: string; oblastName: string } => {
  const candidates: string[] = [];
  $(
    "h1, h2, .municipality-name, .obs-title, .title-block, .breadcrumb li",
  ).each((_, el) => {
    candidates.push(txt($(el)));
  });
  for (const text of candidates) {
    if (!text) continue;
    // Strip a leading "Местни избори | 29 октомври 2023 | първи тур " crumb
    // that .title-block carries inline before the município name.
    const cleaned = text.replace(/^.*?\|\s*[^|]*\|\s*[^|]*\s+/, "").trim();
    const m = cleaned.match(MUNI_OBLAST_RE) ?? text.match(MUNI_OBLAST_RE);
    if (m && !/местни\s+избори/i.test(m[1])) {
      return {
        municipalityName: m[1].trim(),
        oblastName: m[2].trim(),
      };
    }
    const muniOnly = text.match(MUNI_ONLY_RE);
    if (muniOnly && !/местни\s+избори/i.test(muniOnly[1])) {
      return { municipalityName: muniOnly[1].trim(), oblastName: "" };
    }
  }
  // Last resort: scan <title>.
  const title = txt($("title").first());
  const tm = title.match(MUNI_OBLAST_RE);
  if (tm && !/местни\s+избори/i.test(tm[1])) {
    return { municipalityName: tm[1].trim(), oblastName: tm[2].trim() };
  }
  return { municipalityName: "", oblastName: "" };
};

export const parseRezultatiHtml = (
  html: string,
  opts: {
    oikCode: string;
    round: LocalRound;
    canonical: CanonicalPartiesIndex | undefined;
  },
): ParsedRezultatiPage => {
  const $ = load(html);
  const byNickNameLower = buildByNickNameLower(opts.canonical);
  const { municipalityName, oblastName } = extractNames($);
  const sections = collectSections($);

  const mayor: LocalMayorResult[] = [];
  const council: LocalCouncilParty[] = [];
  const kmetstva: LocalKmetstvoResult[] = [];
  const districts: LocalDistrictMayorResult[] = [];

  let mayorTableCount = 0;
  let councilTableCount = 0;
  let kmetstvoTableCount = 0;

  // 2011 (mipvr2011) renders the per-município page with no race-type
  // section headings — just an obshtina-name H2 followed by the mayor and
  // council tables. When the heading-driven dispatch matches nothing, fall
  // back to "first mayor-kind table = município mayor, first council-kind
  // table = council" — safe because kmetstvo/района subtables didn't ship
  // on the same page in that era.
  const headingMatchedSomething = sections.some(
    (s) =>
      SECTION_HEADINGS.mayorObshtina.test(s.heading) ||
      SECTION_HEADINGS.council.test(s.heading) ||
      SECTION_HEADINGS.mayorKmetstvo.test(s.heading) ||
      SECTION_HEADINGS.mayorDistrict.test(s.heading),
  );
  if (!headingMatchedSomething) {
    const allTables = $("table").toArray();
    let mayorTaken = false;
    let councilTaken = false;
    for (const node of allTables) {
      const $table = $(node);
      const kind = classifyTable($, $table);
      if (!mayorTaken && kind === "mayor") {
        const rows = parseMayorTable($, $table, opts.round, byNickNameLower);
        mayor.push(...rows);
        mayorTableCount++;
        mayorTaken = true;
      } else if (!councilTaken && kind === "council") {
        const parties = parseCouncilTable($, $table, byNickNameLower);
        council.push(...parties);
        councilTableCount++;
        councilTaken = true;
      }
      if (mayorTaken && councilTaken) break;
    }
  }

  for (const section of sections) {
    const isMayorObshtina = SECTION_HEADINGS.mayorObshtina.test(
      section.heading,
    );
    const isCouncil = SECTION_HEADINGS.council.test(section.heading);
    const isKmetstvo = SECTION_HEADINGS.mayorKmetstvo.test(section.heading);
    const isDistrict = SECTION_HEADINGS.mayorDistrict.test(section.heading);

    for (const $table of section.tables) {
      const kind = classifyTable($, $table);
      if (isCouncil && kind === "council") {
        const parties = parseCouncilTable($, $table, byNickNameLower);
        council.push(...parties);
        councilTableCount++;
      } else if (isMayorObshtina && kind === "mayor") {
        const rows = parseMayorTable($, $table, opts.round, byNickNameLower);
        mayor.push(...rows);
        mayorTableCount++;
      } else if (isKmetstvo && kind === "mayor") {
        // Each kmetstvo gets its own table; the kmetstvo name is in the
        // section heading or in a sibling header. Look upward for a
        // .kmetstvo-name or fall back to the section heading.
        const rows = parseMayorTable($, $table, opts.round, byNickNameLower);
        // We don't have ekatte from the HTML; the orchestrator fills it
        // from sections.txt via a settlement-name join.
        const kmetstvoName = section.heading
          .replace(/Обобщени данни от/i, "")
          .replace(/избор на кмет на кметство/i, "")
          .trim();
        kmetstva.push({
          kmetstvoName,
          ekatte: "",
          candidates: rows,
        });
        kmetstvoTableCount++;
      } else if (isDistrict && kind === "mayor") {
        const rows = parseMayorTable($, $table, opts.round, byNickNameLower);
        districts.push({
          districtName: section.heading
            .replace(/Обобщени данни от/i, "")
            .replace(/избор на кмет на район/i, "")
            .trim(),
          districtCode: "",
          candidates: rows,
        });
      }
    }
  }

  const electedMayors = mayor.filter((m) => m.isElected).length;
  const totalMandatesWon = council.reduce((acc, p) => acc + p.mandatesWon, 0);
  const electedCouncillors = council.reduce(
    (acc, p) => acc + p.candidates.filter((c) => c.isElected).length,
    0,
  );

  return {
    oikCode: opts.oikCode,
    round: opts.round,
    municipalityName,
    oblastName,
    mayor,
    council,
    kmetstva,
    districts,
    diagnostics: {
      mayorTableCount,
      councilTableCount,
      kmetstvoTableCount,
      electedMayors,
      totalMandatesWon,
      electedCouncillors,
    },
  };
};
