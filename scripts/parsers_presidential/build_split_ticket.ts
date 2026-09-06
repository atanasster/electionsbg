// Split-ticket voting — the ПВР ticket against the НС list of the SAME nominator, in the same
// section, on the same day.
//
//   npx tsx scripts/parsers_presidential/build_split_ticket.ts <cycle> [--write]
//   npx tsx scripts/parsers_presidential/build_split_ticket.ts all --write
//
// ⚠⚠ THE HEADLINE NUMBER IS A FLOOR, AND THAT IS WHAT MAKES IT SAYABLE. „N% of a party's list
// voters did not vote for its ticket" — the phrasing this analysis is usually asked for — is an
// ecological inference: nobody sees which ballot a given voter put in which box. What IS
// observable is set cardinality. In one section, let A be the voters who chose party P's list
// and B those who chose P's ticket; both are subsets of that section's voters, so the number
// who voted differently on the two ballots is |A △ B| ≥ | |A| − |B| |. Summed over sections
// (which are disjoint), `minSplitVoters` is therefore a LOWER BOUND on split ballots that
// assumes nothing at all — not that ticket voters voted the list, not that list voters voted
// the ticket. Every surface must say „поне" / „at least".
//
// ⚠⚠ NINE OF 2021'S 23 TICKETS HAVE NO LIST, AND BOTH FINALISTS ARE AMONG THEM. Радев and
// Герджиков were nominated by инициативни комитети; the parties that BACKED them are a
// political fact the ballot does not record, and attributing a named candidate's votes to
// ГЕРБ-СДС because everyone knows it would be this repo asserting an affiliation no register
// carries. They are listed in `refused` with the reason instead. The consequence is worth
// stating plainly rather than burying: the two most interesting candidates are the two this
// analysis cannot cover.
//
// ⚠ THE MATCH IS THE REGISTER'S OWN NAME, CROSS-CHECKED AGAINST THE BALLOT NUMBER. ЦИК draws
// one numbering covering both ballots, so an entity standing in both carries the same number on
// each — measured, all 14 matched pairs in 2021 agree — and a name match whose numbers disagree
// is REFUSED rather than published. Two independent facts from the source agreeing is evidence;
// deriving one from the other would be none.
//
// ⚠ ROUND ONE ONLY. The runoff is a week later and has no parliamentary ballot beside it.
//
// ⚠ 2011 AND 2016 ALSO SHARE THEIR DAY — with LOCAL elections (`2011_10_23_mi`,
// `2016_11_06_chmi`), not a parliamentary one. A mayoral or council ballot is not a party list
// and the comparison is a different question; this builder looks for the parliamentary sibling
// `data/<YYYY_MM_DD>` and nothing else, so those two cycles produce no file rather than a
// misnamed one.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRESIDENTIAL_FOLDER_RE } from "../lib/electionFolders";
import { UNPLACED_SHARD } from "./aggregate";
import { nameKey } from "./tickets";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DATA_ROOT = path.join(PROJECT_ROOT, "data");

export const SPLIT_TICKET_FILE = "split_ticket.json";

/** ⚠ INTERNAL — NOT SHIPPED. Measured on 2021: the per-oblast rows are **86.9% of the
 *  artifact** (43,797 bytes minified with them, 5,742 without; 434 rows across 14 pairs), and
 *  nothing renders them. They are still computed, because they are what the totals are summed
 *  from and because the sums are asserted against them before the file is written — the check
 *  belongs in the builder rather than in a payload every reader downloads. A future per-oblast
 *  surface adds the field back; until there is one, the tile fetches 44 KB for 14 rows. */
type OblastSplit = {
  oblast: string;
  sections: number;
  ticketVotes: number;
  listVotes: number;
  /** ⚠ SUMMED PER SECTION, never as `|Σticket − Σlist|`. Sections are disjoint sets of voters,
   *  so the per-section bounds add; differencing the national totals first would let a section
   *  where the ticket ran ahead cancel one where it ran behind, and the „floor" would be far
   *  below the truth. The clearest case is 2021's ПАТРИОТИЧЕН ФРОНТ: nationally the ticket
   *  took 8,302 and the list 8,389, a difference of **87** — while the per-section floor is
   *  **8,025**, almost the entire vote. Two totals that look like the same voters, cast in
   *  different places. */
  minSplitVoters: number;
};

export type SplitPair = {
  /** The ballot number — the SAME on both ballots, which is what confirms the match. */
  number: number;
  president: string;
  nominator: string;
  /** The parliamentary list's short name, for a legend that has to fit. */
  listName: string;
  ticketVotes: number;
  listVotes: number;
  minSplitVoters: number;
  sections: number;
};

export type RefusedTicket = {
  number: number;
  president: string;
  nominator: string;
  /** party / coalition / committee / unknown, as the ballot records it. */
  kind: string;
  /**
   * ⚠ FOUR OUTCOMES, NOT TWO, AND THEY ARE DIFFERENT KINDS OF FACT. `committee` and `no-list`
   * are facts about the BALLOT — this nominator put up no list. `ambiguous-name` and
   * `number-mismatch` are facts about OUR MATCHER — the catalogue lists the name twice, or the
   * names folded together while the ballot numbers disagree, which means the fold joined two
   * different organisations. Only the first pair is safe to publish as a finding; the second
   * pair means the corpus moved under the matcher and a human should look, which is why
   * `main()` reports them on stderr.
   */
  reason: "committee" | "no-list" | "ambiguous-name" | "number-mismatch";
  /** True for a pair that reached the runoff — the fact that makes the refusal costly. */
  reachedRunoff: boolean;
};

export type SplitTicket = {
  cycle: string;
  /** The parliamentary election held the same day. */
  sameDayElection: string;
  /** ⚠ THE BOUND'S DERIVATION, IN THE DATA, so no surface can render the number without it. */
  basis: string;
  basisEn: string;
  pairs: SplitPair[];
  refused: RefusedTicket[];
  coverage: {
    basis: string;
    basisEn: string;
    /** Sections present in BOTH corpora — the population every figure above is summed over. */
    sectionsMatched: number;
    /** In the presidential tree and not the parliamentary one, and the reverse. */
    sectionsPvrOnly: number;
    sectionsNsOnly: number;
  };
};

type PvrSection = {
  code: string;
  oblast?: string;
  votes: { partyNum: number; totalVotes: number }[];
};

type NsSection = {
  section: string;
  results?: { votes?: { partyNum: number; totalVotes: number }[] };
};

type Ticket = {
  number: number;
  president: string;
  nominatedBy: { name: string; kind: string };
  rounds?: number[];
};

type CikParty = { number: number; name: string; nickName?: string };

const readJson = <T>(f: string): T | null => {
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
};

export const presidentialCyclesFor = (root = DATA_ROOT): string[] =>
  fs.existsSync(root)
    ? fs
        .readdirSync(root)
        .filter((d) => PRESIDENTIAL_FOLDER_RE.test(d))
        .sort()
    : [];

/** `2021_11_14_pvr` → `2021_11_14`, when that parliamentary tree exists. */
export const sameDayParliamentary = (
  cycle: string,
  root = DATA_ROOT,
): string | null => {
  const day = cycle.replace(/_pvr$/, "");
  return fs.existsSync(path.join(root, day, "sections", "by-oblast"))
    ? day
    : null;
};

/** Every parliamentary section of the same-day election, keyed by section code. */
const nsSectionsByCode = (
  day: string,
  root: string,
): Map<string, NsSection> => {
  const dir = path.join(root, day, "sections", "by-oblast");
  const out = new Map<string, NsSection>();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const shard = readJson<Record<string, NsSection>>(path.join(dir, f)) ?? {};
    for (const s of Object.values(shard)) if (s?.section) out.set(s.section, s);
  }
  return out;
};

const sumVotes = (
  votes: { partyNum: number; totalVotes: number }[] | undefined,
  num: number,
): number =>
  (votes ?? []).reduce(
    (n, v) => n + (v.partyNum === num ? v.totalVotes : 0),
    0,
  );

export const buildSplitTicket = (
  cycle: string,
  root = DATA_ROOT,
): SplitTicket | null => {
  const day = sameDayParliamentary(cycle, root);
  if (!day) return null;
  const tickets =
    readJson<{ tickets: Ticket[] }>(path.join(root, cycle, "tickets.json"))
      ?.tickets ?? [];
  const parties =
    readJson<CikParty[]>(path.join(root, day, "cik_parties.json")) ?? [];
  if (!tickets.length || !parties.length) return null;

  // ⚠ FOLDED ON THE REGISTER'S OWN NAME, then confirmed by the ballot number. A name the
  // parliamentary catalogue lists twice is dropped rather than picked between.
  const byKey = new Map<string, CikParty[]>();
  for (const p of parties) {
    const k = nameKey(p.name);
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }

  const pairs: SplitPair[] = [];
  const refused: RefusedTicket[] = [];
  const matched = new Map<number, CikParty>();
  for (const t of tickets) {
    const hits = byKey.get(nameKey(t.nominatedBy.name)) ?? [];
    const party = hits.length === 1 ? hits[0] : undefined;
    // ⚠ THE NUMBER MUST AGREE. It is a second, independent fact about the same entity, and a
    // disagreement means the fold matched two different organisations with one name.
    if (!party || party.number !== t.number) {
      refused.push({
        number: t.number,
        president: t.president,
        nominator: t.nominatedBy.name,
        kind: t.nominatedBy.kind,
        reason:
          t.nominatedBy.kind === "committee"
            ? "committee"
            : hits.length > 1
              ? "ambiguous-name"
              : hits.length === 1
                ? "number-mismatch"
                : "no-list",
        reachedRunoff: (t.rounds ?? []).includes(2),
      });
      continue;
    }
    matched.set(t.number, party);
    pairs.push({
      number: t.number,
      president: t.president,
      nominator: t.nominatedBy.name,
      listName: party.nickName ?? party.name,
      ticketVotes: 0,
      listVotes: 0,
      minSplitVoters: 0,
      sections: 0,
    });
  }
  if (!pairs.length) return null;

  const ns = nsSectionsByCode(day, root);
  const dir = path.join(root, cycle, "tur1", "sections");
  // ⚠ NULL, LIKE EVERY OTHER MISSING INPUT HERE. An interrupted ingest must skip this cycle,
  // not abort `--pvr all` after its siblings have already been written — and in `main.ts` the
  // throw would escape the loop before the ingest marker is stamped.
  if (!fs.existsSync(dir)) return null;
  const acc = new Map<number, Map<string, OblastSplit>>(
    pairs.map((p) => [p.number, new Map()]),
  );
  let sectionsMatched = 0;
  let sectionsPvrOnly = 0;
  const seen = new Set<string>();

  for (const f of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    // ⚠ `_unplaced` IS EXCLUDED from the per-oblast breakdown for the reason
    // `build_runoff_transfer.ts` gives — „nowhere" is not a geography — but its sections still
    // count toward the coverage totals below, so nothing disappears silently.
    .sort()) {
    const oblast = f.replace(/\.json$/, "");
    for (const s of readJson<PvrSection[]>(path.join(dir, f)) ?? []) {
      seen.add(s.code);
      const other = ns.get(s.code);
      if (!other) {
        sectionsPvrOnly += 1;
        continue;
      }
      sectionsMatched += 1;
      if (oblast === UNPLACED_SHARD) continue;
      for (const [num, party] of matched) {
        const ticketVotes = sumVotes(s.votes, num);
        const listVotes = sumVotes(other.results?.votes, party.number);
        const rows = acc.get(num)!;
        const row = rows.get(oblast) ?? {
          oblast,
          sections: 0,
          ticketVotes: 0,
          listVotes: 0,
          minSplitVoters: 0,
        };
        row.sections += 1;
        row.ticketVotes += ticketVotes;
        row.listVotes += listVotes;
        row.minSplitVoters += Math.abs(ticketVotes - listVotes);
        rows.set(oblast, row);
      }
    }
  }

  for (const p of pairs) {
    const rows = [...acc.get(p.number)!.values()];
    for (const o of rows) {
      p.sections += o.sections;
      p.ticketVotes += o.ticketVotes;
      p.listVotes += o.listVotes;
      p.minSplitVoters += o.minSplitVoters;
    }
    // ⚠ THE FLOOR IS SUMMED PER SECTION, and this is where that stays checkable now that the
    // rows are not shipped. `|Σticket − Σlist|` is also a valid bound and a far weaker one, so
    // a builder that quietly switched to it would still satisfy every consumer.
    if (p.minSplitVoters < Math.abs(p.ticketVotes - p.listVotes))
      throw new Error(
        `${cycle}/#${p.number}: the per-section floor (${p.minSplitVoters}) is below the ` +
          `differenced one (${Math.abs(p.ticketVotes - p.listVotes)}) — it is not a floor`,
      );
  }
  pairs.sort((a, b) => b.listVotes - a.listVotes || a.number - b.number);
  refused.sort((a, b) => a.number - b.number);

  let sectionsNsOnly = 0;
  for (const code of ns.keys()) if (!seen.has(code)) sectionsNsOnly += 1;

  // ⚠ DERIVED, NEVER WRITTEN OUT. The builder is generic over cycles and the counts are right
  // here; a hardcoded „Девет … инициативни комитети" survives verbatim onto a corpus with a
  // different ballot — and the tile renders `coverage.basis` unaltered, so it reaches the reader
  // with no gate in between. `2026_11_08_pvr` is already this skill's worked example.
  const committees = refused.filter((r) => r.reason === "committee").length;
  const finalists = refused.filter((r) => r.reachedRunoff).length;
  const unmatched = refused.length - committees;
  const bgFinalists = finalists
    ? ` Сред тях ${finalists === 1 ? "е и единият, стигнал" : `са и ${finalists === 2 ? "двамата" : finalists}, стигнали`} до балотаж.`
    : "";
  const enFinalists = finalists
    ? ` ${finalists === 1 ? "The one who reached" : `The ${finalists} who reached`} the runoff ${finalists === 1 ? "is" : "are"} among them.`
    : "";

  return {
    cycle,
    sameDayElection: day,
    basis:
      "Долна граница, не оценка. Не се вижда кой бюлетина е пуснал в коя урна — вижда се " +
      "колко гласа е получил кандидатът и колко листата на същия вносител в същата секция. " +
      "Гласувалите за листата и гласувалите за двойката са две множества от една и съща " +
      "секция, затова разминаващите се гласове са ПОНЕ разликата между броя им. Числото е " +
      "минимум: истинският брой може да е много по-голям, но не и по-малък.",
    basisEn:
      "A lower bound, not an estimate. Nobody sees which ballot a voter put in which box — " +
      "what is seen is how many votes the ticket took and how many the same nominator's list " +
      "took in the same section. Those are two sets drawn from one section's voters, so the " +
      "number who voted differently on the two ballots is AT LEAST the difference between " +
      "their sizes. The figure is a minimum: the true number may be far larger, never smaller.",
    pairs,
    refused,
    coverage: {
      basis:
        "Само първият тур — балотажът е седмица по-късно и няма парламентарна бюлетина до " +
        `него. ${committees} от двойките са издигнати от инициативни комитети и нямат листа, ` +
        `с която да се сравнят.${bgFinalists} Партиите, които са ги подкрепили, не са ` +
        "отбелязани в бюлетината и не се приписват тук." +
        (unmatched
          ? ` За още ${unmatched} вносителят не беше свързан еднозначно с листа в ` +
            "парламентарния каталог."
          : "") +
        // ⚠ THE VOTE FIGURES ARE DOMESTIC-ONLY AND THE ARTIFACT SAYS SO. The presidential tree
        // keeps sections abroad in `abroad.json` rather than in `tur1/sections`, so they have no
        // ticket row to compare — measured 2021, that is 750 sections and takes ДПС's list
        // figure to 253,257 against a published national 341,000. The FLOOR is unaffected:
        // restricting a sum of non-negative per-section terms to a subset of disjoint sections
        // yields a weaker bound, never an overstated one.
        ` Сравняват се само секциите, които присъстват и в двата протокола: ${sectionsMatched}` +
        (sectionsNsOnly
          ? `. Секциите извън страната (${sectionsNsOnly}) нямат президентска редица в този ` +
            "масив и остават извън сравнението, затова числата тук са под националните " +
            "резултати."
          : "."),
      basisEn:
        "Round one only — the runoff is a week later with no parliamentary ballot beside it. " +
        `${committees} tickets were nominated by initiative committees and have no list to ` +
        `compare against.${enFinalists} The parties that backed them are not recorded on the ` +
        "ballot and are not attributed here." +
        (unmatched
          ? ` For a further ${unmatched}, the nominator could not be resolved to exactly one ` +
            "list in the parliamentary catalogue."
          : "") +
        ` Only sections present in both protocols are compared: ${sectionsMatched}` +
        (sectionsNsOnly
          ? `. The ${sectionsNsOnly} sections outside the country have no presidential row in ` +
            "this corpus and stay out of the comparison, so the figures here sit below the " +
            "published national results."
          : "."),
      sectionsMatched,
      sectionsPvrOnly,
      sectionsNsOnly,
    },
  };
};

/**
 * Build one cycle's split-ticket file and write it. Returns the path RELATIVE TO `root` — the
 * shape `ingestPresidentialCycle` puts in its `files` list — or `null`.
 *
 * ⚠ `null` HAS FOUR CAUSES, not one: no same-day parliamentary sibling (the ordinary case, four
 * of five cycles), an unreadable `tickets.json` or `cik_parties.json`, a missing
 * `tur1/sections`, and a fold that matched no nominator at all. Only the first is expected.
 * `sameDayParliamentary()` is what separates them, and the CLI calls it for that reason.
 */
export const writeSplitTicket = (
  cycle: string,
  {
    indent = 2,
    root = DATA_ROOT,
    built,
  }: { indent?: number; root?: string; built?: SplitTicket | null } = {},
): string | null => {
  // ⚠ ONE WRITER FOR BOTH ENTRY POINTS — this module's CLI and `scripts/main.ts`. A second
  // `writeFileSync` beside the dry-run summary would be a second answer to „what does this file
  // look like", and the two drift on the next field added. `built` lets the CLI hand over the
  // object it already has rather than paying for a second build, which is the other half.
  built = built ?? buildSplitTicket(cycle, root);
  if (!built) return null;
  const rel = path.join(cycle, SPLIT_TICKET_FILE);
  fs.writeFileSync(
    path.join(root, rel),
    `${JSON.stringify(built, null, indent)}\n`,
  );
  return rel;
};

const main = (): void => {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error(
      "usage: build_split_ticket.ts <cycle|all> [--write]  (dry run without --write)",
    );
    process.exitCode = 1;
    return;
  }
  for (const cycle of target === "all" ? presidentialCyclesFor() : [target]) {
    const built = buildSplitTicket(cycle);
    if (!built) {
      console.log(
        `${cycle}: no same-day parliamentary election — nothing to build`,
      );
      continue;
    }
    const json = `${JSON.stringify(built, null, 2)}\n`;
    console.log(
      `${cycle}: ${built.pairs.length} ticket(s) with a list, ${built.refused.length} refused ` +
        `(${built.refused.filter((r) => r.reachedRunoff).length} of them reached the runoff), ` +
        `${built.coverage.sectionsMatched} sections matched ` +
        `(${built.coverage.sectionsPvrOnly} ПВР-only, ${built.coverage.sectionsNsOnly} НС-only) — ` +
        `${(json.length / 1024).toFixed(1)} KB`,
    );
    for (const p of built.pairs.slice(0, 5))
      console.log(
        `    #${p.number} ${p.listName}: ticket ${p.ticketVotes} vs list ${p.listVotes}, ` +
          `at least ${p.minSplitVoters} split`,
      );
    if (!write) continue;
    console.log(`  wrote data/${writeSplitTicket(cycle, { built })}`);
  }
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
