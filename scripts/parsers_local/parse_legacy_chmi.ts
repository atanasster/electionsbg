// Parser for the LEGACY per-kmetstvo chmi pages (umbrellas chmi2012-2015,
// chmi2016-2018, chmi2019-2023).
//
// Unlike the modern chmi (one OIK-município page per partial), these older
// umbrellas publish one numbered page per individual race — a single village
// (кметство) / município (община) / район mayor by-election. Each page:
//   • a heading that names the race + place, in one of two shapes:
//       "Резултати за кмет на кметство <S>, община <O>, област <OBL> / DATE"
//       "Резултати за кмет на община <O>, област <OBL> / DATE"        (2012-2018)
//       "Частични избори за кметове на кметства на <DATE>"            (2019-2023,
//          place not in the heading — taken from the section code / breadcrumb)
//   • a single 4-column mayor table (№ / Кандидат|Партия / Гласове / % ), which
//     the existing `parseMayorTable` already handles (strong/em/br candidate
//     cell, elected-class OR winner-inference).
//
// The obshtina is resolved from the heading's "община X" where present, else
// from the 9-digit section codes on the page (first 4 digits = OIK).

import { load } from "cheerio";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { parseMayorTable, parseCouncilTable } from "./parse_rezultati_html";
import { buildByNickNameLower } from "./local_coalitions";
import { LocalCouncilParty, LocalMayorResult, LocalRound } from "./types";

export type LegacyRaceType = "kmetstvo" | "obshtina" | "rayon" | "council";

export type LegacyChmiResult = {
  raceType: LegacyRaceType;
  /** Кметство/район name for those races; the município name for an obshtina
   * race. Empty when the page heading didn't carry it (resolved later). */
  placeName: string;
  /** Obshtina name parsed from "община X" in the heading, when present. */
  obshtinaName: string | null;
  oblastName: string | null;
  /** 4-digit OIK derived from the first 9-digit section code on the page. */
  oikFromSection: string | null;
  round: LocalRound;
  /** Mayor candidates for kmetstvo/obshtina/район races. */
  candidates: LocalMayorResult[];
  /** Council parties for a "нови избори за общински съветници" page. */
  councilParties: LocalCouncilParty[];
};

const RACE_WORD: Record<string, LegacyRaceType> = {
  кметство: "kmetstvo",
  община: "obshtina",
  район: "rayon",
};

// "Резултати за кмет на <race> <name>[, община <obsh>], област <obl> / DATE".
// Anchor on "Резултати за" — 2016-2018 pages carry an earlier bare
// "Кмет на кметство" section label that would otherwise capture the prefix.
const NAMED_HEADING =
  /Резултати\s+за\s+кмет\s+на\s+(кметство|община|район)\s+(.+?)(?:,\s*община\s+(.+?))?,\s*област\s+(.+?)\s*(?:\/|$)/i;

// "Резултати за общински съветници на община <obsh>, област <obl> / DATE" —
// a full council re-election (нови избори за общински съветници).
const COUNCIL_HEADING =
  /Резултати\s+за\s+общински\s+съветници\s+(?:на\s+)?(?:община\s+)?(.+?),\s*област\s+(.+?)\s*(?:\/|$)/i;

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

export const parseLegacyChmiPage = (
  html: string,
  opts: { round: LocalRound; canonical: CanonicalPartiesIndex | undefined },
): LegacyChmiResult | null => {
  const $ = load(html);
  const byNickNameLower = buildByNickNameLower(opts.canonical);

  const headingText = collapse(
    $("h1, h2, h3, h4, .breadcrumb, .title-block")
      .map((_, e) => $(e).text())
      .get()
      .join(" "),
  );

  const secMatch = html.match(/\b(\d{9})\b/);
  const oikFromSection = secMatch ? secMatch[1].slice(0, 4) : null;

  // Council re-election ("нови избори за общински съветници") — parse the
  // council table instead of a mayor table.
  const cm = headingText.match(COUNCIL_HEADING);
  if (cm && /общински\s+съветници/i.test(headingText)) {
    const $ctable = $("table").first();
    if ($ctable.length === 0) return null;
    $ctable.find("tr.graph-row").removeClass("graph-row");
    const councilParties = parseCouncilTable($, $ctable, byNickNameLower);
    if (councilParties.length === 0) return null;
    return {
      raceType: "council",
      placeName: collapse(cm[1]),
      obshtinaName: collapse(cm[1]),
      oblastName: collapse(cm[2]),
      oikFromSection,
      round: opts.round,
      candidates: [],
      councilParties,
    };
  }

  let raceType: LegacyRaceType = "kmetstvo";
  let placeName = "";
  let obshtinaName: string | null = null;
  let oblastName: string | null = null;

  const m = headingText.match(NAMED_HEADING);
  if (m) {
    raceType = RACE_WORD[m[1].toLocaleLowerCase("bg")] ?? "kmetstvo";
    placeName = collapse(m[2]);
    // "кмет на община X" → X is the obshtina itself; "кмет на кметство S,
    // община O" → O is the obshtina, S the village.
    obshtinaName = raceType === "obshtina" ? placeName : (m[3] ?? null);
    if (obshtinaName) obshtinaName = collapse(obshtinaName);
    oblastName = collapse(m[4]);
  } else {
    // 2019-2023 generic heading: race type only; the place is the trailing
    // token after the date in the title block, e.g.
    //   "Частични избори за кметове на кметства на 23 октомври 2022 г. Илинденци"
    if (/кмет\w*\s+на\s+общин/i.test(headingText)) raceType = "obshtina";
    else if (/кмет\w*\s+на\s+район/i.test(headingText)) raceType = "rayon";
    else raceType = "kmetstvo";
    const titleBlock = collapse(
      $(".title-block, .obs-title").first().text() || headingText,
    );
    const trailing = titleBlock.match(/\d{4}\s*г\.?\s*(.+?)\s*$/);
    placeName = trailing ? collapse(trailing[1]) : "";
  }

  const $table = $("table").first();
  if ($table.length === 0) return null;
  // 2019-2023 puts the actual candidate data in <tr class="graph-row">, which
  // parseMayorTable treats as a decorative bar and skips. Strip that token
  // (keeping "elected") so the data rows are read. Harmless for the earlier
  // umbrellas, whose data rows carry no class.
  $table.find("tr.graph-row").removeClass("graph-row");
  const candidates = parseMayorTable($, $table, opts.round, byNickNameLower);
  if (candidates.length === 0) return null;

  return {
    raceType,
    placeName,
    obshtinaName,
    oblastName,
    oikFromSection,
    round: opts.round,
    candidates,
    councilParties: [],
  };
};
