/**
 * `npm run polls:crosscheck` — §6.5, decision 1 of
 * docs/plans/polls-agency-watchers-v1.md. Wikipedia stopped being an
 * ingest input the day the agency-site pipeline (`polls:fetch` →
 * `polls:extract` → `polls:accept`) landed; this is what Wikipedia is
 * still FOR — a report, never a write, comparing the corpus against BG
 * Wikipedia's own polling table.
 *
 *   npm run polls:crosscheck
 *   npm run polls:crosscheck -- --cycle https://bg.wikipedia.org/wiki/...
 *
 * Presidential crosscheck (`--race presidential`) is NOT supported here
 * yet — Tier 4 has not shipped that family's schema (no
 * `data/polls/presidential/*.json` to diff against), the same scoping
 * `polls:accept`/`polls:restamp` already use. Passing it is refused
 * cleanly rather than attempted.
 *
 * ⚠️ WIKIPEDIA IS NOT A SOURCE OF TRUTH — this file used to write
 * `polls.json` directly from it, and that is exactly what stopped:
 * BG Wikipedia polling tables have been observed with renormalized
 * values (some agencies publish raw + decided-voters tables; Wikipedia
 * editors sometimes transcribe the renormalized one), small parties
 * dropped, outright mislabels, and publication-vs-fieldwork date drift.
 * A row this script finds on Wikipedia and not in the corpus ("missing
 * here") is a LEAD to go verify on the agency's own page — never a value
 * to trust and merge.
 *
 * Prints three sections and exits 0 whatever it finds (findings are the
 * point, not a failure) — but still THROWS on a genuine fetch/parse
 * failure (network error, or the page's polling table not found at all),
 * because a silent "0 findings" from a broken parse is indistinguishable
 * from Wikipedia genuinely agreeing with the corpus.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { fetchText } from "../watch/fingerprint";
import { PARLIAMENTARY_PAGE } from "../watch/sources/wiki_polls";
// The agency registry moved out of this file: the listers, the press watcher,
// the cross-check and the ingest all need it, and a second copy is how one of
// them ends up recognising a name the others do not.
import { matchAgency } from "./lib/agencies";
import { collapseSpaces, parseBgFieldworkRange } from "./lib/fieldwork_bg";
import { flagReader } from "./lib/argv";
import { normKey } from "../../src/data/polls/aliases";
import { parseFieldworkEnd } from "../../src/data/polls/fieldwork";
import type { Poll, PollDetail } from "../../src/data/polls/pollsTypes";

const PROD_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let REPO_ROOT = PROD_REPO_ROOT;

/** TEST-ONLY seam, matching accept.ts's/restamp.ts's own convention:
 *  redirects the corpus read to a scratch directory. Pass no argument to
 *  restore the real repo root. */
export const __setCrosscheckRootForTests = (root?: string): void => {
  REPO_ROOT = root ?? PROD_REPO_ROOT;
};

const POLLS_DIR = () => path.join(REPO_ROOT, "data/polls");

// Wikipedia uses rowspan="2" for narrow columns and one row of colored
// stripes for parties; header text varies only in these fixed labels for
// the PARLIAMENTARY page (the presidential pages use three OTHER header
// vocabularies §3 measured — not handled here, since there is no
// presidential corpus yet to diff against; see the file header).
const HEADER_SKIP = new Set([
  "социологическа агенция",
  "агенция",
  "период на проучването",
  "период",
  "извадка",
  "проба",
  "други",
  "не подкрепям никого",
  "никого",
  "преднина",
]);

type ScrapedTable = {
  agencyHeader: number;
  periodHeader: number;
  sampleHeader: number;
  partyColumns: { index: number; nickBg: string }[];
  rows: cheerio.Cheerio<Element>[];
};

const parseTable = (
  $: cheerio.CheerioAPI,
  table: Element,
): ScrapedTable | null => {
  const rows = $(table).find("> tbody > tr").toArray();
  if (!rows.length) return null;
  const headerCells = $(rows[0]).find("> th, > td").toArray();
  let agencyHeader = -1;
  let periodHeader = -1;
  let sampleHeader = -1;
  const partyColumns: { index: number; nickBg: string }[] = [];

  let colIdx = 0;
  for (const th of headerCells) {
    const colspan = parseInt($(th).attr("colspan") ?? "1", 10) || 1;
    const text = collapseSpaces($(th).text()).toLowerCase();
    if (HEADER_SKIP.has(text)) {
      if (text.startsWith("социолог") || text === "агенция")
        agencyHeader = colIdx;
      if (text.startsWith("период")) periodHeader = colIdx;
      if (text === "извадка" || text === "проба") sampleHeader = colIdx;
    } else if (text) {
      partyColumns.push({
        index: colIdx,
        // Stripped of footnote markers the same way the agency cell and
        // value cells already are (parsePct, the agency-text reader below)
        // — a party header carrying `<sup>[a]</sup>` would otherwise fail
        // to normKey-fold against the corpus's clean label.
        nickBg: collapseSpaces(
          $(th).clone().find("sup, .reference").remove().end().text(),
        ),
      });
    }
    colIdx += colspan;
  }
  if (agencyHeader < 0 || periodHeader < 0 || partyColumns.length === 0)
    return null;

  const dataRows: cheerio.Cheerio<Element>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const firstCell = $(row).find("> th, > td").first();
    if (firstCell.is("th")) continue; // header / color stripe
    dataRows.push($(row));
  }
  return {
    agencyHeader,
    periodHeader,
    sampleHeader,
    partyColumns,
    rows: dataRows,
  };
};

const parsePct = (cell: cheerio.Cheerio<Element>): number | null => {
  // Cells often look like  <b>44,6</b><br><small>131</small>  — the <small>
  // holds the seat count, not part of the percentage. cheerio's .text()
  // concatenates without a separator, so "44,6" + "131" would become
  // "44,6131" → 44.6131. Strip <small> first, then prefer <b>'s content.
  const clone = cell.clone();
  clone.find("small, sup, .reference").remove();
  const bold = clone.find("b").first();
  const raw = (bold.length ? bold.text() : clone.text()).trim();
  if (!raw || raw === "-" || raw === "—") return null;
  const first = raw.split(/\s/)[0];
  const num = parseFloat(first.replace(",", "."));
  return Number.isFinite(num) ? num : null;
};

const parseSample = (cellText: string): number | null => {
  const cleaned = cellText.replace(/[\s\u00A0]/g, "").replace(/[^0-9]/g, "");
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
};

const cellByColIdx = (
  $: cheerio.CheerioAPI,
  row: cheerio.Cheerio<Element>,
  target: number,
): cheerio.Cheerio<Element> | null => {
  let col = 0;
  for (const td of row.find("> td, > th").toArray()) {
    const colspan = parseInt($(td).attr("colspan") ?? "1", 10) || 1;
    if (target >= col && target < col + colspan) return $(td);
    col += colspan;
  }
  return null;
};

// Column N → external URL, built from the page's own references list.
// Used to resolve <sup>[N]</sup> footnotes attached to polling rows back to
// the underlying article/agency-press-release URL — far more useful as a
// "missing here" pointer than the wiki cycle URL itself.
const buildCiteNoteMap = ($: cheerio.CheerioAPI): Map<string, string> => {
  const map = new Map<string, string>();
  $(".mw-references-wrap li, .references li").each((_, li) => {
    const id = $(li).attr("id");
    const href = $(li).find("a.external").first().attr("href");
    if (id && href) map.set(id, href);
  });
  return map;
};

const extractRowSource = (
  $: cheerio.CheerioAPI,
  row: cheerio.Cheerio<Element>,
  noteMap: Map<string, string>,
): string | null => {
  for (const a of row.find('a[href^="#cite_note"]').toArray()) {
    const noteId = ($(a).attr("href") ?? "").replace(/^#/, "");
    const url = noteMap.get(noteId);
    if (url) return url;
  }
  for (const a of row.find('a.external, a[class*="external"]').toArray()) {
    const href = $(a).attr("href");
    if (href && !href.startsWith("#") && !href.startsWith("/")) return href;
  }
  return null;
};

export interface WikiRow {
  agencyId: string;
  agencyText: string;
  fieldworkEnd: string;
  fieldworkText: string;
  sample: number | null;
  source: string;
  parties: { nickBg: string; pct: number }[];
}

interface ExtractedRows {
  rows: WikiRow[];
  unknownAgencies: Set<string>;
  unparseablePeriods: { agencyText: string; periodText: string }[];
}

/** Extracts every usable row from ONE already-shape-matched candidate
 *  table. Split out of `readWikiRows` purely for readability — the row
 *  loop and the table-selection loop are two different concerns. */
const extractRows = (
  $: cheerio.CheerioAPI,
  parsed: ScrapedTable,
  noteMap: Map<string, string>,
  url: string,
): ExtractedRows => {
  const rows: WikiRow[] = [];
  const seenKeys = new Set<string>();
  const unknownAgencies = new Set<string>();
  const unparseablePeriods: ExtractedRows["unparseablePeriods"] = [];

  for (const row of parsed.rows) {
    const cells = row.find("> td, > th").toArray();
    if (cells.length < 4) continue;
    const firstColspan = parseInt($(cells[0]).attr("colspan") ?? "1", 10) || 1;
    if (firstColspan > 1) continue; // filler row (campaign-close marker etc.)

    const agencyCell = cellByColIdx($, row, parsed.agencyHeader);
    const periodCell = cellByColIdx($, row, parsed.periodHeader);
    if (!agencyCell || !periodCell) continue;

    const agencyText = collapseSpaces(
      agencyCell.clone().find("sup, .reference").remove().end().text(),
    );
    const periodText = collapseSpaces(periodCell.text());

    if (/централна избирателна комисия|cec/i.test(agencyText)) continue;
    if (/^избори\s/i.test(agencyText)) continue;
    if (!agencyText) continue;

    const matched = matchAgency(agencyText);
    if (!matched) {
      unknownAgencies.add(agencyText);
      continue;
    }
    const fw = parseBgFieldworkRange(periodText);
    if (!fw) {
      unparseablePeriods.push({ agencyText, periodText });
      continue;
    }

    const key = `${matched.id}|${fw.endIso}`;
    if (seenKeys.has(key)) continue; // dedupe within the page
    seenKeys.add(key);

    const sampleCell =
      parsed.sampleHeader >= 0
        ? cellByColIdx($, row, parsed.sampleHeader)
        : null;
    const sample = sampleCell ? parseSample(sampleCell.text()) : null;
    const source = extractRowSource($, row, noteMap) ?? url;

    const parties: { nickBg: string; pct: number }[] = [];
    for (const pc of parsed.partyColumns) {
      const td = cellByColIdx($, row, pc.index);
      if (!td) continue;
      const pct = parsePct(td);
      if (pct !== null) parties.push({ nickBg: pc.nickBg, pct });
    }
    if (parties.length === 0) continue;

    rows.push({
      agencyId: matched.id,
      agencyText,
      fieldworkEnd: fw.endIso,
      fieldworkText: fw.fieldwork,
      sample,
      source,
      parties,
    });
  }

  return { rows, unknownAgencies, unparseablePeriods };
};

/** Fetch and parse one Wikipedia cycle page's polling table into rows keyed
 *  the way the corpus is keyed — `(agencyId, fieldworkEnd)`. A cycle page
 *  is one continuous accumulation of polls (decision 3's "Wikipedia keeps
 *  adding inter-election polls to the same page until the next election is
 *  scheduled"), so this reads the whole table, not a single poll. */
export const readWikiRows = async (
  url: string,
): Promise<{ rows: WikiRow[]; unknownAgencies: Set<string> }> => {
  const html = await fetchText(url);
  if (!html) throw new Error(`empty response fetching ${url}`);
  const $ = cheerio.load(html);

  const tables = $("table.wikitable").toArray();
  const noteMap = buildCiteNoteMap($);
  let parsed: ScrapedTable | null = null;
  for (const t of tables) {
    const candidate = parseTable($, t);
    if (candidate && candidate.partyColumns.length >= 4) {
      parsed = candidate;
      break;
    }
  }
  if (!parsed) {
    throw new Error(
      `no polling table found at ${url} — the BG Wikipedia page likely restructured. ` +
        `Open it in a browser, check the table class/headers, then update parseTable() in scripts/polls/crosscheck.ts.`,
    );
  }
  // The shape match alone doesn't PROVE this is the real polling table —
  // it is today, empirically, on the live page (a second, unrelated
  // `wikitable sortable` on that page has a different header shape) — so
  // the chosen columns are logged once per run, making a future
  // mis-selection visible in the output rather than only inferable from a
  // suspicious pile of `unknownAgencies`.
  console.log(
    `  table selected — party columns: ${parsed.partyColumns.map((p) => p.nickBg).join(", ")}`,
  );

  const extracted = extractRows($, parsed, noteMap, url);
  for (const u of extracted.unparseablePeriods)
    console.warn(
      `  ! could not parse period "${u.periodText}" for ${u.agencyText}`,
    );

  return { rows: extracted.rows, unknownAgencies: extracted.unknownAgencies };
};

interface CorpusEntry {
  poll: Poll;
  details: PollDetail[];
}

const readJsonArray = <T>(file: string): T[] =>
  fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T[]) : [];

/** Every parliamentary corpus poll, keyed the same way as `readWikiRows`'
 *  output. A poll whose own `fieldwork` string does not parse is dropped
 *  from the index (nothing to key it on) rather than reported — that is a
 *  separate, pre-existing corpus defect `polls_corpus.test.ts` already
 *  gates, not something this report exists to surface a second time. */
const corpusIndex = (): Map<string, CorpusEntry> => {
  const polls = readJsonArray<Poll>(path.join(POLLS_DIR(), "polls.json"));
  const details = readJsonArray<PollDetail>(
    path.join(POLLS_DIR(), "polls_details.json"),
  );
  const byId = new Map<string, PollDetail[]>();
  for (const d of details)
    byId.set(d.pollId, [...(byId.get(d.pollId) ?? []), d]);

  const index = new Map<string, CorpusEntry>();
  for (const poll of polls) {
    if ((poll.race ?? "parliamentary") !== "parliamentary") continue;
    const end = parseFieldworkEnd(poll.fieldwork);
    if (!end) continue;
    index.set(`${poll.agencyId}|${end}`, {
      poll,
      details: byId.get(poll.id) ?? [],
    });
  }
  return index;
};

export interface MissingHere {
  agencyId: string;
  fieldworkEnd: string;
  fieldworkText: string;
  sample: number | null;
  source: string;
}

export interface MissingThere {
  pollId: string;
  agencyId: string;
  fieldworkEnd: string;
}

export interface Disagreement {
  pollId: string;
  agencyId: string;
  fieldworkEnd: string;
  sampleMismatch?: { wiki: number; corpus: number };
  labelMismatches: {
    label: string;
    wiki: number;
    corpus: number;
    delta: number;
  }[];
}

export interface ExtraLabel {
  pollId: string;
  agencyId: string;
  fieldworkEnd: string;
  label: string;
  pct: number;
}

export interface CrosscheckReport {
  missingHere: MissingHere[];
  missingThere: MissingThere[];
  disagreements: Disagreement[];
  extraLabels: ExtraLabel[];
}

const PCT_TOLERANCE = 0.5;

export const diffAgainstCorpus = (
  wikiRows: WikiRow[],
  corpus: Map<string, CorpusEntry>,
): CrosscheckReport => {
  const missingHere: MissingHere[] = [];
  const disagreements: Disagreement[] = [];
  const extraLabels: ExtraLabel[] = [];
  const matchedKeys = new Set<string>();

  for (const row of wikiRows) {
    const key = `${row.agencyId}|${row.fieldworkEnd}`;
    const entry = corpus.get(key);
    if (!entry) {
      missingHere.push({
        agencyId: row.agencyId,
        fieldworkEnd: row.fieldworkEnd,
        fieldworkText: row.fieldworkText,
        sample: row.sample,
        source: row.source,
      });
      continue;
    }
    matchedKeys.add(key);

    const sampleMismatch =
      row.sample !== null &&
      entry.poll.respondents !== null &&
      row.sample !== entry.poll.respondents
        ? { wiki: row.sample, corpus: entry.poll.respondents }
        : undefined;

    const corpusByFold = new Map(
      entry.details.map((d) => [normKey(d.nickName_bg).toLowerCase(), d]),
    );
    const labelMismatches: Disagreement["labelMismatches"] = [];
    for (const p of row.parties) {
      const corpusDetail = corpusByFold.get(normKey(p.nickBg).toLowerCase());
      if (!corpusDetail) {
        // A label with no corpus counterpart isn't a VALUE disagreement —
        // it might be a genuinely new/small party — but on an otherwise-
        // matched poll it would otherwise be invisible everywhere in this
        // report (not "missing here", since the poll itself matched; not
        // a disagreement, by the rule above). Surface it as its own
        // informational bucket instead of silently dropping it.
        extraLabels.push({
          pollId: entry.poll.id,
          agencyId: row.agencyId,
          fieldworkEnd: row.fieldworkEnd,
          label: p.nickBg,
          pct: p.pct,
        });
        continue;
      }
      const delta = Math.round((p.pct - corpusDetail.support) * 100) / 100;
      if (Math.abs(delta) > PCT_TOLERANCE) {
        labelMismatches.push({
          label: corpusDetail.nickName_bg,
          wiki: p.pct,
          corpus: corpusDetail.support,
          delta,
        });
      }
    }

    if (sampleMismatch || labelMismatches.length > 0) {
      disagreements.push({
        pollId: entry.poll.id,
        agencyId: row.agencyId,
        fieldworkEnd: row.fieldworkEnd,
        sampleMismatch,
        labelMismatches,
      });
    }
  }

  const missingThere: MissingThere[] = [];
  for (const [key, entry] of corpus) {
    if (matchedKeys.has(key)) continue;
    missingThere.push({
      pollId: entry.poll.id,
      agencyId: entry.poll.agencyId,
      fieldworkEnd: key.split("|")[1],
    });
  }
  missingThere.sort((a, b) => (a.fieldworkEnd < b.fieldworkEnd ? 1 : -1));

  return { missingHere, missingThere, disagreements, extraLabels };
};

const printReport = (report: CrosscheckReport): void => {
  console.log(
    `\n=== missing here — on Wikipedia, not in the corpus (${report.missingHere.length}) ===`,
  );
  if (report.missingHere.length === 0) console.log("  (none)");
  for (const m of report.missingHere) {
    console.log(
      `  ${m.agencyId} ${m.fieldworkEnd} (${m.fieldworkText}, n=${m.sample ?? "?"}) — capture with polls:fetch --agency ${m.agencyId} --url ${m.source}`,
    );
  }

  console.log(
    `\n=== missing there — in the corpus, not on Wikipedia (${report.missingThere.length}, informational) ===`,
  );
  if (report.missingThere.length === 0) console.log("  (none)");
  for (const m of report.missingThere) {
    console.log(`  ${m.pollId} (${m.agencyId}, ${m.fieldworkEnd})`);
  }

  console.log(`\n=== disagreements (${report.disagreements.length}) ===`);
  if (report.disagreements.length === 0) console.log("  (none)");
  for (const d of report.disagreements) {
    console.log(`  ${d.pollId} (${d.agencyId}, ${d.fieldworkEnd}):`);
    if (d.sampleMismatch)
      console.log(
        `    sample: wiki=${d.sampleMismatch.wiki} corpus=${d.sampleMismatch.corpus}`,
      );
    for (const lm of d.labelMismatches)
      console.log(
        `    ${lm.label}: wiki=${lm.wiki} corpus=${lm.corpus} (Δ${lm.delta > 0 ? "+" : ""}${lm.delta})`,
      );
  }

  console.log(
    `\n=== extra labels — on Wikipedia for an otherwise-matched poll, no corpus counterpart (${report.extraLabels.length}, informational) ===`,
  );
  if (report.extraLabels.length === 0) console.log("  (none)");
  for (const e of report.extraLabels) {
    console.log(
      `  ${e.pollId} (${e.agencyId}, ${e.fieldworkEnd}): ${e.label}=${e.pct}`,
    );
  }
  console.log("");
};

export interface Opts {
  race: string;
  cycle: string;
}

export const parseArgv = (argv: string[]): Opts => {
  const flag = flagReader(argv);
  return {
    race: flag("race") ?? "parliamentary",
    cycle: flag("cycle") ?? PARLIAMENTARY_PAGE,
  };
};

export const main = async (argv: string[]): Promise<void> => {
  const opts = parseArgv(argv);
  if (opts.race !== "parliamentary") {
    console.error(
      `--race "${opts.race}" is not supported yet — polls:crosscheck only supports parliamentary today (decision 10's presidential family is a separate, not-yet-built schema with no corpus to diff against)`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`→ ${opts.cycle}`);
  const { rows, unknownAgencies } = await readWikiRows(opts.cycle);
  console.log(`  ${rows.length} polling row(s) read`);
  if (unknownAgencies.size)
    console.warn(
      `  ! unknown agencies skipped: ${[...unknownAgencies].join(" | ")} — add to scripts/polls/lib/agencies.ts if this is a real pollster`,
    );

  const report = diffAgainstCorpus(rows, corpusIndex());
  printReport(report);
  console.log(
    `${report.missingHere.length} missing here, ${report.missingThere.length} missing there, ` +
      `${report.disagreements.length} disagreement(s), ${report.extraLabels.length} extra label(s)`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
