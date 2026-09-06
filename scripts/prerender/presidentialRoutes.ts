// Prerendered pages for the `/presidential/:cycle` family (plan T6).
//
// ⚠ A `<loc>` WITH NO PRERENDERED HTML IS A SOFT-404 — it serves the homepage's title and
// canonical — so `scripts/sitemap/index.ts` enumerates the family by CALLING these builders
// rather than re-deriving the population. That is one definition, not two kept in step: a first
// cut duplicated the rules and review found three ways the copy could already have drifted.
// `presidentialFamily.data.test.ts` still compares the COMMITTED shard against them, because
// `npm run sitemap` is a manual command and „changed the builders, did not re-mint" is real.
//
// ⚠ EVERY BODY CARRIES FACTS FROM THE CORPUS, never boilerplate. A prerendered page whose text
// is the same on all 1,325 municipality URLs is thin content that earns a penalty rather than
// traffic — the reason `/council/resolution/**` is function-served with no sitemap entry at
// all. Each body here states who led that place, with how many votes and what share.
//
// ⚠⚠ THE SECTION AND SETTLEMENT LEVELS ARE DELIBERATELY ABSENT. `/presidential/:cycle/
// settlement/:ekatte` is ~5,000 URLs per cycle and `/section/:code` ~12,500, which is 87,500
// pages across five cycles — against a `dist/` already holding ~248k files and a Firebase
// deploy that has FAILED at 453k. Local elections make the same choice for the same reason
// (`route_defs.ts`: „settlement pages … intentionally omitted"). Those routes still serve as
// SPA pages; they are simply not prerendered and not submitted.
//
// ⚠ THE URL IS THE NO-SLASH FORM, and `/en/...` for the mirror — never `/en/.../`. Hosting
// runs `trailingSlash: false`, so a canonical carrying one 301s.

import fs from "node:fs";
import path from "node:path";
import { SITE_URL, type PrerenderRoute } from "./routes";
import { buildWebPageLd } from "./jsonLd";
import { escapeHtml } from "./html";
import type { RegionInfo } from "../../src/data/dataTypes";

/** ⚠ EVERY CORPUS STRING IN A `bodyHtml` GOES THROUGH THIS. `PrerenderRoute`'s own doc says
 *  „pass only safe HTML" and the field is concatenated raw into the page. Nothing in the five
 *  cycles' names carries `<`, `>` or `&` today — measured — but a future ticket name with a
 *  bare `&` would emit invalid HTML into 3,044 indexed pages, and the sibling local builder
 *  escapes for exactly that reason. Numbers do not need it; names do. */
const esc = escapeHtml;

/** Every ingested presidential cycle, oldest first. */
export const presidentialCyclesFor = (projectRoot: string): string[] => {
  const root = path.join(projectRoot, "data");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((d) => /^\d{4}_\d{2}_\d{2}_pvr$/.test(d))
    .sort();
};

type SummaryRound = {
  round: 1 | 2;
  ranking: {
    president: string;
    vicePresident: string;
    votes: number;
    shareOfValid: number;
  }[];
  votes: { valid: number };
  turnout: { pct: number | null };
  abroad: { sections: number; countries: number; ballotsFound: number };
};

type Summary = {
  round1Date: string;
  decidedInRound: 1 | 2;
  winner: { president: string; vicePresident: string };
  rounds: SummaryRound[];
};

const readJson = <T>(file: string): T | null => {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
};

/** `2021-11-14` → `14.11.2021`. ⚠ NEVER the folder id, which is not a date a reader recognises. */
const bgDate = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};

const pct = (fraction: number, digits = 2): string =>
  `${(fraction * 100).toFixed(digits)}%`;

const int = (n: number): string => n.toLocaleString("bg-BG");
const intEn = (n: number): string => n.toLocaleString("en-GB");

type RollupFile = {
  entries: {
    key: string;
    results: { votes: { partyNum: number; totalVotes: number }[] };
  }[];
};

type Ticket = { number: number; president: string; vicePresident: string };

/** The leading ticket per place in one round, with its share of that place's TICKET votes.
 *
 *  ⚠ THE DENOMINATOR IS THE TICKET SUM, not the valid votes — „не подкрепям никого" is valid
 *  and is not in these files. Every body that prints this share says so, because the same
 *  place's share in the national ranking is the smaller number. */
const leadersOf = (
  file: string,
): Map<string, { number: number; votes: number; share: number }> => {
  const out = new Map<
    string,
    { number: number; votes: number; share: number }
  >();
  const rollup = readJson<RollupFile>(file);
  for (const e of rollup?.entries ?? []) {
    let best: { partyNum: number; totalVotes: number } | undefined;
    let total = 0;
    for (const v of e.results.votes) {
      total += v.totalVotes;
      if (
        !best ||
        v.totalVotes > best.totalVotes ||
        (v.totalVotes === best.totalVotes && v.partyNum < best.partyNum)
      )
        best = v;
    }
    // A place that cast nothing has no leader — not ticket 1 with zero votes.
    if (!best || best.totalVotes === 0 || total === 0) continue;
    out.set(e.key, {
      number: best.partyNum,
      votes: best.totalVotes,
      share: best.totalVotes / total,
    });
  }
  return out;
};

type CycleFacts = {
  cycle: string;
  date: string;
  summary: Summary;
  tickets: Map<number, Ticket>;
  /** Round 1 — the round every page leads with, because art. 93 (3) is a test on it. */
  regions: ReturnType<typeof leadersOf>;
  municipalities: ReturnType<typeof leadersOf>;
};

/** ⚠ MEMOISED. The three builders each walk every cycle, so an unmemoised read parses the
 *  region and municipality roll-ups — ~11 MB across five cycles — three times over, to produce
 *  the same object each time. The cache is keyed on the root as well as the cycle because the
 *  tests point it at synthetic trees. */
const cycleCache = new Map<string, CycleFacts | null>();

const readCycle = (projectRoot: string, cycle: string): CycleFacts | null => {
  const key = `${projectRoot}::${cycle}`;
  const hit = cycleCache.get(key);
  if (hit !== undefined) return hit;
  const built = readCycleUncached(projectRoot, cycle);
  cycleCache.set(key, built);
  return built;
};

/** Test-only: the cache above is module state, so a suite that writes a synthetic tree and
 *  reads it twice needs a way back to a known start. */
export const __resetPresidentialCycleCache = (): void => cycleCache.clear();

const readCycleUncached = (
  projectRoot: string,
  cycle: string,
): CycleFacts | null => {
  const dir = path.join(projectRoot, "data", cycle);
  const summary = readJson<Summary>(path.join(dir, "national_summary.json"));
  if (!summary?.rounds?.length) return null;
  const ticketFile = readJson<{ tickets: Ticket[] }>(
    path.join(dir, "tickets.json"),
  );
  return {
    cycle,
    date: bgDate(summary.round1Date),
    summary,
    tickets: new Map((ticketFile?.tickets ?? []).map((t) => [t.number, t])),
    regions: leadersOf(path.join(dir, "tur1", "region_votes.json")),
    municipalities: leadersOf(
      path.join(dir, "tur1", "municipality_votes.json"),
    ),
  };
};

/** `/presidential/:cycle` — one page per cycle, both rounds on it (the runoff is a toggle). */
export const buildPresidentialCycleRoutes = (
  projectRoot: string,
): PrerenderRoute[] => {
  const out: PrerenderRoute[] = [];
  for (const cycle of presidentialCyclesFor(projectRoot)) {
    const f = readCycle(projectRoot, cycle);
    if (!f) continue;
    const r1 = f.summary.rounds[0];
    const lead = r1.ranking[0];
    const w = f.summary.winner;
    const url = `${SITE_URL}/presidential/${cycle}`;
    const title = `Президентски избори ${f.date} — резултати | electionsbg.com`;
    // ⚠ THE DESCRIPTION NAMES THE ROUND THE FIGURE IS FROM. „49.42%" without „на първи тур"
    // reads as the final result, which in every one of these five cycles it is not.
    const description = `Резултати от президентските избори на ${f.date} — избран: ${w.president} и ${w.vicePresident}${
      f.summary.decidedInRound === 2 ? " (на балотаж)" : " (на първи тур)"
    }. На първи тур води ${lead.president} с ${pct(lead.shareOfValid)} от действителните гласове.`;
    const titleEn = `Bulgarian Presidential Election ${f.date} — Results | electionsbg.com`;
    const descriptionEn = `Results of the ${f.date} Bulgarian presidential election — elected: ${w.president} and ${w.vicePresident}${
      f.summary.decidedInRound === 2
        ? " (in the runoff)"
        : " (in the first round)"
    }. ${lead.president} led the first round with ${pct(lead.shareOfValid)} of the valid votes.`;
    const turnout =
      r1.turnout.pct === null
        ? ""
        : ` Избирателна активност на първи тур: ${pct(r1.turnout.pct)}.`;
    const turnoutEn =
      r1.turnout.pct === null
        ? ""
        : ` First-round turnout: ${pct(r1.turnout.pct)}.`;
    out.push({
      path: `presidential/${cycle}`,
      title,
      description,
      bodyHtml: `<h1>Президентски избори ${f.date}</h1><p>${r1.ranking.length} двойки на първи тур, ${int(r1.votes.valid)} действителни гласа.${turnout} Избрани: ${esc(w.president)} и ${esc(w.vicePresident)}.</p>`,
      jsonLd: [buildWebPageLd({ title, description, url })],
      english: {
        title: titleEn,
        description: descriptionEn,
        bodyHtml: `<h1>Bulgarian presidential election ${f.date}</h1><p>${r1.ranking.length} tickets in the first round, ${intEn(r1.votes.valid)} valid votes.${turnoutEn} Elected: ${esc(w.president)} and ${esc(w.vicePresident)}.</p>`,
        jsonLd: [
          buildWebPageLd({
            title: titleEn,
            description: descriptionEn,
            url: `${SITE_URL}/en/presidential/${cycle}`,
          }),
        ],
      },
    });

    // `/presidential/:cycle/abroad` — one page, not a fan-out: the route takes no id.
    const a = r1.abroad;
    const abroadUrl = `${SITE_URL}/presidential/${cycle}/abroad`;
    const abroadTitle = `Президентски избори ${f.date} — секции в чужбина | electionsbg.com`;
    const abroadDescription = `Резултати от секциите в чужбина на президентските избори ${f.date} — ${a.sections} секции в ${a.countries} държави, ${int(a.ballotsFound)} намерени бюлетини.`;
    const abroadTitleEn = `Bulgarian Presidential Election ${f.date} — Sections Abroad | electionsbg.com`;
    const abroadDescriptionEn = `Results from sections abroad in the ${f.date} Bulgarian presidential election — ${a.sections} sections in ${a.countries} countries, ${intEn(a.ballotsFound)} ballots found.`;
    out.push({
      path: `presidential/${cycle}/abroad`,
      title: abroadTitle,
      // ⚠ BALLOTS, NEVER A PERCENTAGE. There is no registered-voter denominator outside the
      // country, so a „turnout" here would be a rate over a roll that does not exist.
      description: abroadDescription,
      jsonLd: [
        buildWebPageLd({
          title: abroadTitle,
          description: abroadDescription,
          url: abroadUrl,
        }),
      ],
      bodyHtml: `<h1>Президентски избори ${f.date} — в чужбина</h1><p>${a.sections} секции в ${a.countries} държави, ${int(a.ballotsFound)} намерени бюлетини. Извън страната няма списък на избирателите, спрямо който да се смята активност.</p>`,
      english: {
        title: abroadTitleEn,
        description: abroadDescriptionEn,
        bodyHtml: `<h1>Bulgarian presidential election ${f.date} — abroad</h1><p>${a.sections} sections in ${a.countries} countries, ${intEn(a.ballotsFound)} ballots found. There is no register of voters outside the country to measure turnout against.</p>`,
        jsonLd: [
          buildWebPageLd({
            title: abroadTitleEn,
            description: abroadDescriptionEn,
            url: `${SITE_URL}/en/presidential/${cycle}/abroad`,
          }),
        ],
      },
    });
  }
  return out;
};

/** `/presidential/:cycle/region/:oblast`. */
export const buildPresidentialRegionRoutes = (
  projectRoot: string,
  regions: RegionInfo[],
): PrerenderRoute[] => {
  // ⚠ `long_name` FIRST — `regions.json` carries it for exactly Sofia's three МИР, whose
  // bare `name` is „23"/„24"/„25". A title reading „Президентски избори — област 23" is the
  // same defect the browser side had.
  const nameOf = new Map(regions.map((r) => [r.oblast, r.long_name || r.name]));
  const nameEnOf = new Map(
    regions.map((r) => [r.oblast, r.long_name_en || r.name_en || r.name]),
  );
  const out: PrerenderRoute[] = [];
  for (const cycle of presidentialCyclesFor(projectRoot)) {
    const f = readCycle(projectRoot, cycle);
    if (!f) continue;
    for (const [code, lead] of f.regions) {
      const name = nameOf.get(code);
      // ⚠ A CODE WITH NO NAME GETS NO PAGE. „Президентски избори — област BLG" is a title
      // about an identifier, and the sitemap would submit it.
      if (!name) continue;
      const t = f.tickets.get(lead.number);
      if (!t) continue;
      const nameEn = nameEnOf.get(code) ?? name;
      const url = `${SITE_URL}/presidential/${cycle}/region/${code}`;
      const title = `Президентски избори ${f.date} — ${name} | electionsbg.com`;
      const description = `Резултати от президентските избори ${f.date} в ${name} — на първи тур води ${t.president} с ${int(lead.votes)} гласа (${pct(lead.share, 1)} от гласовете за двойки).`;
      const titleEn = `Bulgarian Presidential Election ${f.date} — ${nameEn} | electionsbg.com`;
      const descriptionEn = `Results of the ${f.date} Bulgarian presidential election in ${nameEn} — ${t.president} led the first round with ${intEn(lead.votes)} votes (${pct(lead.share, 1)} of the votes cast for a ticket).`;
      out.push({
        path: `presidential/${cycle}/region/${code}`,
        title,
        description,
        bodyHtml: `<h1>${esc(name)} — президентски избори ${f.date}</h1><p>На първи тур води двойката ${esc(t.president)} и ${esc(t.vicePresident)} с ${int(lead.votes)} гласа, или ${pct(lead.share, 1)} от подадените за двойки в областта.</p>`,
        jsonLd: [buildWebPageLd({ title, description, url })],
        english: {
          title: titleEn,
          description: descriptionEn,
          bodyHtml: `<h1>${esc(nameEn)} — Bulgarian presidential election ${f.date}</h1><p>${esc(t.president)} and ${esc(t.vicePresident)} led the first round with ${intEn(lead.votes)} votes, ${pct(lead.share, 1)} of those cast for a ticket in this province.</p>`,
          jsonLd: [
            buildWebPageLd({
              title: titleEn,
              description: descriptionEn,
              url: `${SITE_URL}/en/presidential/${cycle}/region/${code}`,
            }),
          ],
        },
      });
    }
  }
  return out;
};

type MuniFile = { obshtina: string; name: string; name_en?: string };

/** `/presidential/:cycle/municipality/:obshtina`. */
export const buildPresidentialMunicipalityRoutes = (
  projectRoot: string,
): PrerenderRoute[] => {
  const munis =
    readJson<MuniFile[]>(
      path.join(projectRoot, "data", "municipalities.json"),
    ) ?? [];
  const nameOf = new Map(munis.map((m) => [m.obshtina, m.name]));
  const nameEnOf = new Map(munis.map((m) => [m.obshtina, m.name_en ?? m.name]));
  const out: PrerenderRoute[] = [];
  for (const cycle of presidentialCyclesFor(projectRoot)) {
    const f = readCycle(projectRoot, cycle);
    if (!f) continue;
    for (const [code, lead] of f.municipalities) {
      const name = nameOf.get(code);
      if (!name) continue;
      const t = f.tickets.get(lead.number);
      if (!t) continue;
      const nameEn = nameEnOf.get(code) ?? name;
      const url = `${SITE_URL}/presidential/${cycle}/municipality/${code}`;
      const title = `Президентски избори ${f.date} — община ${name} | electionsbg.com`;
      const description = `Резултати от президентските избори ${f.date} в община ${name} — на първи тур води ${t.president} с ${int(lead.votes)} гласа (${pct(lead.share, 1)} от гласовете за двойки).`;
      const titleEn = `Bulgarian Presidential Election ${f.date} — ${nameEn} Municipality | electionsbg.com`;
      const descriptionEn = `Results of the ${f.date} Bulgarian presidential election in ${nameEn} municipality — ${t.president} led the first round with ${intEn(lead.votes)} votes (${pct(lead.share, 1)} of the votes cast for a ticket).`;
      out.push({
        path: `presidential/${cycle}/municipality/${code}`,
        title,
        description,
        bodyHtml: `<h1>Община ${esc(name)} — президентски избори ${f.date}</h1><p>На първи тур води двойката ${esc(t.president)} и ${esc(t.vicePresident)} с ${int(lead.votes)} гласа, или ${pct(lead.share, 1)} от подадените за двойки в общината.</p>`,
        jsonLd: [buildWebPageLd({ title, description, url })],
        english: {
          title: titleEn,
          description: descriptionEn,
          bodyHtml: `<h1>${esc(nameEn)} municipality — Bulgarian presidential election ${f.date}</h1><p>${esc(t.president)} and ${esc(t.vicePresident)} led the first round with ${intEn(lead.votes)} votes, ${pct(lead.share, 1)} of those cast for a ticket in this municipality.</p>`,
          jsonLd: [
            buildWebPageLd({
              title: titleEn,
              description: descriptionEn,
              url: `${SITE_URL}/en/presidential/${cycle}/municipality/${code}`,
            }),
          ],
        },
      });
    }
  }
  return out;
};
