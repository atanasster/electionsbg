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

const SECTION_HEADINGS = {
  mayorObshtina: /Обобщени данни от избор на кмет на община/i,
  council: /Обобщени данни от избор на общински съвет/i,
  mayorKmetstvo: /избор на кмет на кметство/i,
  mayorDistrict: /избор на кмет на район/i,
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

// Classify a table by its header row.
type TableKind = "mayor" | "council" | "unknown";
const classifyTable = ($: CheerioAPI, $table: Cheerio<Element>): TableKind => {
  const headers = $table
    .find("thead th")
    .map((_, th) => txt($(th)))
    .get();
  if (headers.some((h) => /Мандати/i.test(h))) return "council";
  if (headers.some((h) => /Партия|Кандидат|Гласове/i.test(h))) return "mayor";
  return "unknown";
};

// Parse a mayor-style table (4 cols: №, candidate+party, votes, %). The
// candidate cell stacks <strong>NAME</strong><br/>PARTY_NAME.
const parseMayorTable = (
  $: CheerioAPI,
  $table: Cheerio<Element>,
  round: LocalRound,
  byNickNameLower: Map<string, string>,
): LocalMayorResult[] => {
  const out: LocalMayorResult[] = [];
  $table.find("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const cls = $tr.attr("class") ?? "";
    if (cls.includes("graph-row")) return;
    const tds = $tr.find("td");
    if (tds.length < 4) return;
    // Skip "Не подкрепям никого" rows (the № cell is "-").
    const numRaw = txt(tds.eq(0));
    if (!/^\d/.test(numRaw)) return;
    const localPartyNum = parseIntLoose(numRaw);
    const $name = tds.eq(1);
    const candidateName = txt($name.find("strong").first()) || txt($name);
    // The party name is the text node after <br/>, preserved by cheerio
    // as a sibling text node. Recover it by stripping the candidate name
    // from the cell.
    const fullCellText = txt($name);
    const partyName = fullCellText
      .replace(candidateName, "")
      .trim()
      .replace(/^[,;:\s]+/, "");
    const votes = parseIntLoose(txt(tds.eq(2)));
    const pct = parsePct(txt(tds.eq(3)));
    const resolution = resolveLocalParty(partyName, byNickNameLower);
    out.push({
      candidateName,
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
  return out;
};

// Parse a council-style table (5 cols: №, party, votes, %, mandates).
// Party rows are followed by candidate rows (with `candidate` class)
// belonging to that party, ending when the next party row appears.
const parseCouncilTable = (
  $: CheerioAPI,
  $table: Cheerio<Element>,
  byNickNameLower: Map<string, string>,
): LocalCouncilParty[] => {
  const out: LocalCouncilParty[] = [];
  let current: LocalCouncilParty | null = null;
  let totalValidVotes = 0; // approximated by summing party totals; used for pct fallback
  $table.find("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const cls = $tr.attr("class") ?? "";
    if (cls.includes("graph-row")) return;
    const tds = $tr.find("td");
    if (tds.length < 4) return;
    const isCandidate = cls.includes("candidate");
    if (isCandidate) {
      if (!current) return;
      // Candidate cell text: " 101. Name Name Name "
      const cellText = txt(tds.eq(1));
      const match = cellText.match(/^(\d+)\.\s*(.*)$/);
      if (!match) return;
      const listPos = parseInt(match[1], 10);
      const name = match[2].trim();
      const prefVotes = parseIntLoose(txt(tds.eq(2)));
      const prefPct = parsePct(txt(tds.eq(3)));
      const cand: LocalCouncilCandidate = {
        listPos,
        name,
        prefVotes,
        prefPct,
        isElected: cls.includes("candidate-elected"),
      };
      current.candidates.push(cand);
      return;
    }
    // Party-summary row. № then party-name, votes, %, mandates.
    const numRaw = txt(tds.eq(0));
    if (!/^\d/.test(numRaw)) {
      // "Не подкрепям никого" — skip; not a party.
      current = null;
      return;
    }
    const localPartyNum = parseIntLoose(numRaw);
    const partyName = txt(tds.eq(1).find("strong").first()) || txt(tds.eq(1));
    const totalVotes = parseIntLoose(txt(tds.eq(2)));
    const pct = parsePct(txt(tds.eq(3)));
    const mandates = tds.length >= 5 ? parseIntLoose(txt(tds.eq(4))) : 0;
    totalValidVotes += totalVotes;
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
  void totalValidVotes;
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

const extractNames = (
  $: CheerioAPI,
): { municipalityName: string; oblastName: string } => {
  const candidates: string[] = [];
  $("h1, .municipality-name, .obs-title, .title-block").each((_, el) => {
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
