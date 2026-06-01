// Parser for the 2007 local-election (ЦИКМИ) per-place HTML pages.
//
// The 2007 archive (mi2007.cik.bg, shipped as results_1.zip / results_2.zip)
// predates the modern results.cik.bg page model and the section-CSV bundle.
// It publishes ONE static XHTML page per place, organised by oblast folder:
//
//   <oblast2>/<obshtina4>.html      obshtina page: "Кмет на община" + "Общински съвет"
//   <oblast2>/<settlement8>.html    kmetstvo page: "Кмет на кметство"
//   <oblast2>/r<oblast2><obsh2><N2>.html   район page: "Кмет на район" (Sofia/Plovdiv/Varna)
//
// Round 2 (results_2.zip) mirrors the same paths: a tabular runoff page where a
// place went to балотаж, a "no round 2 here" pointer otherwise, plus prose
// `dec_*` decision pages we ignore (the tabular page carries the same winner).
//
// Tables are identified by their <caption>; the page race-type is derived from
// which captions are present. Resolution (oblast/obshtina/place name) comes from
// the <ol id="breadcrumbs"> list, which is present and uniform on every page.
//
// The mayor/kmetstvo/район tables are 4-col (№ | Кандидат<br><span class="party">
// | гласове | %) with `<tr class="elected">` on the winner — exactly what the
// shared `parseMayorTable` already handles. The council table is 2007-specific:
// each party cell packs `<p><span>N.</span>NAME</p><ol><li>councillor</li></ol>`
// (the <ol> = the elected councillors, count == mandates) followed by
// votes / % / мандати <td>s — handled by `parseMi2007Council` below.

import { load, CheerioAPI, Cheerio } from "cheerio";
import { Element } from "domhandler";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { parseMayorTable } from "./parse_rezultati_html";
import { buildByNickNameLower, resolveLocalParty } from "./local_coalitions";
import { titleCasePersonName } from "./text";
import {
  LocalCouncilCandidate,
  LocalCouncilParty,
  LocalMayorResult,
  LocalRound,
} from "./types";

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

const parseIntLoose = (s: string): number => {
  const n = parseInt(s.replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
};

const parsePct = (s: string): number => {
  const n = parseFloat(s.replace("%", "").replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
};

export type Mi2007Breadcrumb = {
  oblastName: string | null; // "Благоевград" (без "Област ")
  obshtinaName: string | null; // "Банско" (без "община ")
  placeName: string | null; // кметство/район name (3rd crumb), else null
  isTest: boolean; // the placeholder "Община Тест" pages
};

export type Mi2007Page = {
  breadcrumb: Mi2007Breadcrumb;
  // The obshtina-mayor race (KO). Present on obshtina pages (both rounds).
  obshtinaMayor: LocalMayorResult[];
  // The council (ОС). Present on the round-1 obshtina page only.
  council: LocalCouncilParty[];
  // A kmetstvo-mayor race (KK). Present on settlement pages.
  kmetstvoMayor: LocalMayorResult[];
  // A район-mayor race (KR). Present on r*.html pages.
  rayonMayor: LocalMayorResult[];
};

// Parse the <ol id="breadcrumbs"> list: "Област X" / "община Y" / ["кметство Z"
// | "район Z"]. Robust across all page types; the sole resolution source.
const parseBreadcrumb = ($: CheerioAPI): Mi2007Breadcrumb => {
  const crumbs = $("#breadcrumbs li")
    .map((_, li) => collapse($(li).text()))
    .get()
    .filter(Boolean);
  let oblastName: string | null = null;
  let obshtinaName: string | null = null;
  let placeName: string | null = null;
  for (const c of crumbs) {
    const mObl = c.match(/^Област\s+(.+)$/i);
    if (mObl) {
      oblastName = mObl[1].trim();
      continue;
    }
    const mObsh = c.match(/^(?:Столична\s+)?общин[аи]\s+(.+)$/i);
    if (mObsh) {
      obshtinaName = mObsh[1].trim();
      continue;
    }
    // The Sofia crumb sometimes reads "Столична община" with no trailing name.
    if (/^Столична\s+община$/i.test(c)) {
      obshtinaName = "Столична";
      continue;
    }
    const mPlace = c.match(/^(?:кметство|район)\s+(.+)$/i);
    if (mPlace) {
      placeName = mPlace[1].trim();
      continue;
    }
  }
  const isTest =
    /тест/i.test(obshtinaName ?? "") || /тест/i.test(placeName ?? "");
  return { oblastName, obshtinaName, placeName, isTest };
};

// 2007 council table: party cell is `<p><span>N.&nbsp;</span>NAME</p><ol>
// <li>councillor</li>…</ol>` then three numeric <td>s (votes | % | мандати).
// The <ol> list is exactly the elected councillors (length == mandates).
const parseMi2007Council = (
  $: CheerioAPI,
  $table: Cheerio<Element>,
  byNickNameLower: Map<string, string>,
): LocalCouncilParty[] => {
  const out: LocalCouncilParty[] = [];
  $table.find("tr").each((_, tr) => {
    const $tr = $(tr);
    // Header row uses <th>; data rows have exactly 4 direct <td> children.
    const tds = $tr.children("td");
    if (tds.length < 4) return;
    const $nameCell = tds.eq(0);
    const $p = $nameCell.find("p").first();
    const pText = collapse($p.length ? $p.text() : $nameCell.text());
    // Leading "N. " — the ballot number from the <span>.
    const numMatch = pText.match(/^(\d+)\s*\.?\s*/);
    const localPartyNum = numMatch ? parseInt(numMatch[1], 10) : 0;
    const partyName = pText.replace(/^\d+\s*\.?\s*/, "").trim();
    if (!partyName) return;

    const totalVotes = parseIntLoose(collapse(tds.eq(1).text()));
    const pct = parsePct(collapse(tds.eq(2).text()));
    const mandates = parseIntLoose(collapse(tds.eq(3).text()));

    // Elected councillors: the <ol><li> names (all elected by definition).
    const candidates: LocalCouncilCandidate[] = [];
    $nameCell.find("ol li").each((i, li) => {
      const name = collapse($(li).text());
      if (!name) return;
      candidates.push({
        listPos: i + 1,
        name: titleCasePersonName(name),
        prefVotes: 0,
        prefPct: 0,
        isElected: true,
      });
    });

    const resolution = resolveLocalParty(partyName, byNickNameLower);
    out.push({
      localPartyNum,
      localPartyName: partyName,
      primaryCanonicalId: resolution.primaryCanonicalId,
      memberCanonicalIds: resolution.memberCanonicalIds,
      isIndependent: resolution.isIndependent,
      totalVotes,
      pctOfValid: pct,
      mandatesWon: mandates,
      candidates,
    });
  });
  return out;
};

// Classify a results table by its <caption>. Nav/layout tables have none.
type CaptionKind = "obshtina" | "council" | "kmetstvo" | "rayon" | null;
const captionKind = (caption: string): CaptionKind => {
  const c = caption.toLocaleLowerCase("bg");
  if (/общински\s+съвет/.test(c)) return "council";
  if (/кмет\s+на\s+община/.test(c)) return "obshtina";
  if (/кмет\s+на\s+кметство/.test(c)) return "kmetstvo";
  if (/кмет\s+на\s+район/.test(c)) return "rayon";
  return null;
};

export const parseMi2007Page = (
  html: string,
  opts: { round: LocalRound; canonical: CanonicalPartiesIndex | undefined },
): Mi2007Page => {
  const $ = load(html);
  const byNickNameLower = buildByNickNameLower(opts.canonical);
  const breadcrumb = parseBreadcrumb($);

  const page: Mi2007Page = {
    breadcrumb,
    obshtinaMayor: [],
    council: [],
    kmetstvoMayor: [],
    rayonMayor: [],
  };

  $("table").each((_, table) => {
    const $table = $(table);
    const kind = captionKind(collapse($table.find("caption").first().text()));
    if (!kind) return;
    if (kind === "council") {
      page.council.push(...parseMi2007Council($, $table, byNickNameLower));
      return;
    }
    const rows = parseMayorTable($, $table, opts.round, byNickNameLower);
    if (kind === "obshtina") page.obshtinaMayor.push(...rows);
    else if (kind === "kmetstvo") page.kmetstvoMayor.push(...rows);
    else if (kind === "rayon") page.rayonMayor.push(...rows);
  });

  return page;
};
