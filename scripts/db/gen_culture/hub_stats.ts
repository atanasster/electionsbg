// Pre-generate the /culture hub's headline figures as one small committed JSON,
// so the tiles read a static file instead of firing a query each — and so the
// numbers stop being FROZEN STRINGS in the tile copy.
//
// That freezing is the problem this file exists to end. The hub shipped quoting
// eight figures (€157.9m, 881 contracts, 42 institutions, 42.0% single-bid …)
// as literals, beside film figures the PRERENDER interpolates from
// data/culture/overview.json — so half the page self-updated and half did not,
// indistinguishably to a reader. `culture_hub_figures.data.test.ts` currently
// holds the literals honest; this replaces them at the source.
//
//   npm run db:gen-culture-hub-stats
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠️ ITS SLOT IN `db:refresh` IS AFTER `db:load:interreg:pg` — the LAST loader in
// the chain — and that is not where it visually belongs.
//
// The natural instinct is to put it beside db:gen-hub-stats and
// db:gen-sector-stats, which sit ~40 steps earlier after db:load:ngo-funding:pg.
// Placed there it would regenerate its ИСУН arm (db:load:funds:pg) and its
// director count (db:resolve:persons, step 45) from the PREVIOUS vintage and
// commit them — precisely the drift those two generators' own placement note was
// written to prevent, one sector over.
//
// `person_role` is the binding constraint TODAY: db:resolve:persons is step 45,
// and everything else this reads is loaded earlier. The last-loader slot is
// therefore safe rather than tight — see the note on INPUTS below, which is the
// machine-readable form of the argument. refresh_coverage.test.ts holds the
// membership.
//
// There is NO `:cloud` half, and that is not an omission. This writes a committed
// FILE, not a table: it ships via bucket:sync, so a cloud reload does not touch
// it and a local `db:refresh` is what makes it current.
// ═══════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { allRows, end } from "../lib/pg";
import {
  missingRelations,
  isEmpty,
  warnSkip,
} from "../gen_procurement/preflight";
import { CULTURE_GROUP_EIKS } from "../../../src/lib/kulturaReferenceData";
import {
  cultureNameSql,
  chitalishteNameSql,
  interregThemeSql,
} from "../../../src/lib/cultureMatch";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/culture/derived/hub_stats.json");

/** Every relation a figure below reads, and the db:refresh step that fills it —
 *  the machine-readable form of the placement note in the header. */
const INPUTS: Record<string, string> = {
  contracts: "db:load:pg",
  contract_risk_cache: "db:load:pg",
  fund_projects: "db:load:funds:pg",
  agri_subsidies: "db:load:agri:pg",
  person_role: "db:resolve:persons",
  interreg_partners: "db:load:interreg:pg",
  interreg_operations: "db:load:interreg:pg",
};

// ⚠️ `tenders` is NOT here, because no query below reads it — and declaring an input a generator does
// not read is not harmless padding. It makes the preflight refuse to run on a
// database that would have produced a perfectly good artifact, and it lets a
// chain-position argument cite a dependency that does not exist. (This file's
// header cited exactly that until the review caught it.)
//
// It is the fingerprint of the one arm this blob still lacks: the „Процедури"
// tile shows no number. When it lands, add `tenders` back here.
//
// The Interreg relations ARE read (see the thematic arm below), and that is what
// now genuinely PINS this generator after db:load:interreg:pg rather than merely
// making the slot safe.

export interface CultureHubStats {
  /** ISO date the figures were derived. A reader of the JSON can tell its age. */
  generatedAt: string;
  procurement: {
    contracts: number;
    eur: number;
    buyers: number;
    suppliers: number;
    singleBid: number;
    bidKnown: number;
    /** The whole-corpus rate, carried BESIDE the sector's — the tile's claim is
     *  „typical, not exceptional", which is a comparison and not a number. */
    nationalSingleBid: number;
    nationalBidKnown: number;
    firstDate: string | null;
  };
  risk: { grades: Record<string, number> };
  funds: {
    /** EIK-exact over the register. Reproducible; a strict subset of `byName`. */
    eikExactEur: number;
    eikExactProjects: number;
    /** Name-matched via cultureMatch — a floor with a fuzzy edge. */
    byNameEur: number;
    byNameProjects: number;
    chitalishtaEur: number;
  };
  agri: { chitalishtaEur: number; chitalishtaRows: number };
  /** THEMATIC — joined through the operation's title. A different question from
   *  „culture bodies doing Interreg", and ~4.4x apart from it. */
  interreg: {
    thematicEur: number;
    partnerRows: number;
    partners: number;
    /** Of `partnerRows`. ~21%: an EIK-keyed surface answers only for these. */
    rowsWithEik: number;
  };
  people: { culturalInstituteRoles: number };
}

const num = (v: unknown): number => Number(v ?? 0);

const main = async () => {
  const t0 = Date.now();

  const missing = await missingRelations(Object.keys(INPUTS));
  if (missing.length) {
    warnSkip(
      "culture hub_stats",
      `missing relation(s): ${missing
        .map((m) => `${m} (${INPUTS[m]})`)
        .join(", ")}`,
      `Run the loader(s) named in brackets, or the whole chain: npm run db:refresh`,
    );
    await end();
    process.exit(0);
  }
  if (await isEmpty("contracts")) {
    warnSkip(
      "culture hub_stats",
      "contracts is empty (db:load:pg)",
      "Load the procurement corpus first: npm run db:load:pg",
    );
    await end();
    process.exit(0);
  }

  const eiks = [...CULTURE_GROUP_EIKS];

  const [proc] = await allRows<Record<string, string>>(
    `SELECT count(*) n, round(sum(amount_eur)::numeric, 0) eur,
            count(DISTINCT awarder_eik) buyers,
            count(DISTINCT contractor_eik) suppliers,
            count(*) FILTER (WHERE number_of_tenderers = 1) sb,
            count(*) FILTER (WHERE number_of_tenderers IS NOT NULL) bk,
            min(date) first_date
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [eiks],
  );
  const [nat] = await allRows<Record<string, string>>(
    `SELECT count(*) FILTER (WHERE number_of_tenderers = 1) sb,
            count(*) FILTER (WHERE number_of_tenderers IS NOT NULL) bk
       FROM contracts WHERE tag = 'contract'`,
  );
  const gradeRows = await allRows<{ grade: string; n: string }>(
    `SELECT r.grade, count(*) n
       FROM contracts c JOIN contract_risk_cache r ON r.key = c.key
      WHERE c.tag = 'contract' AND c.awarder_eik = ANY($1)
      GROUP BY 1 ORDER BY 1`,
    [eiks],
  );
  const [fundsEik] = await allRows<Record<string, string>>(
    `SELECT count(*) n, round(sum(grant_eur)::numeric, 0) eur
       FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
    [eiks],
  );
  const [fundsName] = await allRows<Record<string, string>>(
    `SELECT count(*) n, round(sum(grant_eur)::numeric, 0) eur
       FROM fund_projects WHERE ${cultureNameSql("beneficiary_name")}`,
  );
  const [fundsChit] = await allRows<Record<string, string>>(
    `SELECT round(sum(grant_eur)::numeric, 0) eur
       FROM fund_projects WHERE ${chitalishteNameSql("beneficiary_name")}`,
  );
  const [agri] = await allRows<Record<string, string>>(
    `SELECT count(*) n, round(sum(total_eur)::numeric, 0) eur
       FROM agri_subsidies WHERE ${chitalishteNameSql("name")}`,
  );
  // The Interreg THEMATIC arm — culture-and-heritage money reaching Bulgaria,
  // joined through the OPERATION's title rather than through a beneficiary set.
  // It is a different question from „culture bodies doing Interreg" and the two
  // are ~4.4x apart, so the key says which. This is `interregThemeSql`'s first
  // consumer outside its own gate.
  //
  // The EIK coverage rides WITH the money because an EIK-keyed surface can only
  // answer for the ~21% of partner rows that carry one — a figure published
  // without it silently drops four fifths of the answer.
  const [interreg] = await allRows<Record<string, string>>(
    `SELECT count(*) n, count(p.eik) with_eik,
            count(DISTINCT p.partner_name) partners,
            round(sum(p.budget_eur)::numeric, 0) eur
       FROM interreg_partners p
       JOIN interreg_operations o USING (keep_id)
      WHERE p.country = 'Bulgaria' AND ${interregThemeSql("o.title_en")}`,
  );

  const [people] = await allRows<Record<string, string>>(
    `SELECT count(DISTINCT person_id) n FROM person_role
      WHERE role = 'cultural_institute'`,
  );

  const out: CultureHubStats = {
    generatedAt: new Date().toISOString().slice(0, 10),
    procurement: {
      contracts: num(proc.n),
      eur: num(proc.eur),
      buyers: num(proc.buyers),
      suppliers: num(proc.suppliers),
      singleBid: num(proc.sb),
      bidKnown: num(proc.bk),
      nationalSingleBid: num(nat.sb),
      nationalBidKnown: num(nat.bk),
      firstDate: proc.first_date ?? null,
    },
    risk: {
      grades: Object.fromEntries(gradeRows.map((r) => [r.grade, num(r.n)])),
    },
    funds: {
      eikExactEur: num(fundsEik.eur),
      eikExactProjects: num(fundsEik.n),
      byNameEur: num(fundsName.eur),
      byNameProjects: num(fundsName.n),
      chitalishtaEur: num(fundsChit.eur),
    },
    agri: { chitalishtaEur: num(agri.eur), chitalishtaRows: num(agri.n) },
    interreg: {
      thematicEur: num(interreg.eur),
      partnerRows: num(interreg.n),
      partners: num(interreg.partners),
      rowsWithEik: num(interreg.with_eik),
    },
    people: { culturalInstituteRoles: num(people.n) },
  };

  // A blank ARM must not overwrite a good file with zeroes — the same rule
  // preflight.ts states for its two: a partial artifact reconciles against
  // nothing and is strictly worse than not running.
  //
  // EVERY arm, not just the first. The first cut guarded only `contracts`, which
  // left a reachable hole: `person_role` present-but-EMPTY (a database that has
  // never run db:resolve:persons — 081 creates the table, the resolver fills it)
  // publishes „0 директори" on a tile whose destination lists 224. A zero here is
  // never „none"; it is always „this loader has not run", and the two must not
  // look alike to a reader.
  const arms: [string, number, string][] = [
    [
      "contracts",
      out.procurement.contracts,
      "db:load:pg + the culture register",
    ],
    ["bid-known contracts", out.procurement.bidKnown, "db:load:pg"],
    ["national bid-known", out.procurement.nationalBidKnown, "db:load:pg"],
    [
      "risk grades",
      Object.keys(out.risk.grades).length,
      "db:load:pg (contract_risk_cache)",
    ],
    ["ИСУН name-matched", out.funds.byNameProjects, "db:load:funds:pg"],
    ["ДФЗ читалища", out.agri.chitalishtaRows, "db:load:agri:pg"],
    [
      "culture-institute roles",
      out.people.culturalInstituteRoles,
      "db:resolve:persons",
    ],
  ];
  const blank = arms.filter(([, n]) => !n);
  if (blank.length) {
    warnSkip(
      "culture hub_stats",
      `empty arm(s): ${blank.map(([name]) => name).join(", ")}`,
      `Run the loader(s) that fill them — ${blank
        .map(([name, , remedy]) => `${name}: ${remedy}`)
        .join("; ")}`,
    );
    await end();
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
  const bytes = fs.statSync(OUT).size;
  console.log(
    `culture hub_stats: ${bytes} B → ${path.relative(ROOT, OUT)} in ${(
      (Date.now() - t0) /
      1000
    ).toFixed(1)}s`,
  );
  await end();
  process.exit(0);
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
