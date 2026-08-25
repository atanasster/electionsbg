// Pre-generate the /culture hub's headline figures as one small committed JSON,
// so the tiles read a static file instead of firing a query each — and so the
// numbers stop being FROZEN STRINGS in the tile copy.
//
// That freezing is the problem this file exists to end. The hub shipped quoting
// eight figures (€166.7m, 971 contracts, 59 institutions, 40.5% single-bid …)
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
import type { CultureHubStats } from "../../../src/data/culture/hubStats";
import type { CultureFundSourceBreakdowns } from "../../../src/data/culture/fundSources";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/culture/derived/hub_stats.json");
/** The /culture/funds detail pages' per-arm breakdowns — a SECOND artifact, so
 *  the hub blob every /culture view downloads stays at its ~800 B. */
const OUT_SOURCES = path.join(ROOT, "data/culture/derived/fund_sources.json");

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

// ⚠️ THE SHAPE IS DEFINED ONCE, IN `src/data/culture/hubStats.ts`, AND IMPORTED.
// This file carried its own hand-maintained copy until 2026-08-25, so adding one
// field meant editing two interfaces that nothing compared. The failure modes are
// asymmetric and the second is the dangerous one: a field added to the generator
// only is inert, while a field added to the FRONTEND only compiles cleanly and
// reaches production as `undefined` — a render throw with no error boundary
// behind it. `culture_hub_figures.data.test.ts` already imports the same type
// from `src/`, so the direction is established and works under tsx via `@/*`.
//
// What each field IS lives on that interface; what each field is DERIVED FROM
// lives at its query below.

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
  // `names` is a NAME-distinct recipient count, and the key says so: on this arm
  // 1,475 distinct names sit over 1,365 EIK-or-name identities, because two
  // spellings of one читалище are two names. `useFundsHubStats`' rule — a key
  // called `beneficiaryCount` invites a consumer to pick a denominator by
  // accident — applies verbatim.
  const [fundsName] = await allRows<Record<string, string>>(
    `SELECT count(*) n, round(sum(grant_eur)::numeric, 0) eur,
            count(DISTINCT beneficiary_name) names
       FROM fund_projects WHERE ${cultureNameSql("beneficiary_name")}`,
  );
  // The single programme that dominates the name arm. Measured 2026-08-25 it is
  // 2021BG-RRP (the Recovery and Resilience Facility) at 1,292 of 1,560 rows and
  // €117.3m of €147.0m — so „European culture funding" is, on this arm, mostly
  // one instrument paying читалища. A page that does not show this leaves the
  // reader with the wrong subject.
  //
  // ⚠️ THE ROW SHARE AND THE MONEY SHARE ARE DIFFERENT NUMBERS (82.8% vs 79.8%),
  // so BOTH ride here rather than one being derived from the other by a consumer
  // that then labels it whichever way reads better.
  const [topProg] = await allRows<Record<string, string>>(
    `SELECT program_code code, max(program_name) name,
            count(*) n, round(sum(grant_eur)::numeric, 0) eur
       FROM fund_projects WHERE ${cultureNameSql("beneficiary_name")}
      GROUP BY program_code ORDER BY sum(grant_eur) DESC NULLS LAST LIMIT 1`,
  );
  // The overlap — measured rather than assumed, because the two arms are NOT
  // nested and every surface used to say they were. Measured 2026-08-25: 46 of
  // 47. The 47th is ЕИК 000669802, Национална професионална гимназия по
  // полиграфия и фотография — in the register as a national art school, and its
  // NAME carries no culture stem, so `cultureNameSql` correctly cannot reach it.
  //
  // ⚠️ Do NOT close the gap by adding a stem to cultureMatch.ts. That file's
  // header records four measured ways a widened stem inverts a figure, and
  // „полиграф" would be a fifth candidate nobody has measured. The roster is the
  // right identity for this school; the name rule is right to miss it.
  const [fundsBoth] = await allRows<Record<string, string>>(
    `SELECT count(*) n
       FROM fund_projects
      WHERE beneficiary_eik = ANY($1) AND ${cultureNameSql("beneficiary_name")}`,
    [eiks],
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

  // ── the four per-arm breakdowns the DETAIL PAGES chart ────────────────────
  //
  // ⚠️ THEIR OWN ARTIFACT, NOT THE HUB BLOB. They went into hub_stats.json first
  // and took it from 789 B to 4,498 B, past the 4 KB budget
  // `culture_hub_figures.data.test.ts` holds — and that gate is right: /culture
  // downloads the hub blob on every view and uses none of this. A second file
  // that only /culture/funds/<arm> fetches keeps the hub's payload where it was.
  //
  // ⚠️ ONE BREAKDOWN PER ARM, NEVER A SHARED SHAPE. Each is a different quantity
  // over a different population, so they are four arrays rather than one keyed
  // by arm — a shared shape with an `eur` field is one a consumer can
  // concatenate, which is the cross-arm addition this whole family forbids.
  // Each is small and bounded (10 / 12 / 12 / 8 rows).
  // ⚠️⚠️ GROUPED BY EIK, NOT BY NAME, and on THIS arm the distinction is its
  // whole value: it is the reproducible one, reached by an exact EIK match
  // against the register. Measured 2026-08-26, its 31 EIKs sit under 38 NAMES —
  // six bodies are spelled two or three ways in ИСУН — so a name grouping split
  // Министерство на културата across ranks 2 and 9 of the top ten, understating
  // it by €357,777 and pushing two genuinely smaller institutions off the chart.
  // A chart that splits one institution in two, on the arm whose point is that
  // the identity is exact, contradicts the page it sits on.
  //
  // `max(beneficiary_name)` is a REPRESENTATIVE label, deliberately arbitrary
  // among the spellings and never an identity — the EIK is the identity, and it
  // is what the row is keyed and linked on.
  const eikByBeneficiary = await allRows<Record<string, string>>(
    `SELECT beneficiary_eik eik, max(beneficiary_name) name,
            round(sum(grant_eur)::numeric, 0) eur, count(*) n
       FROM fund_projects WHERE beneficiary_eik = ANY($1)
      GROUP BY 1 ORDER BY sum(grant_eur) DESC NULLS LAST LIMIT 10`,
    [eiks],
  );
  // The arm's distinct-body count, so the chart's note can say „10 of N" rather
  // than quoting the arm's PROJECT total over bars whose chips visibly do not
  // add to it.
  const [eikBodies] = await allRows<Record<string, string>>(
    `SELECT count(DISTINCT beneficiary_eik) n FROM fund_projects
      WHERE beneficiary_eik = ANY($1)`,
    [eiks],
  );
  const nameByProgram = await allRows<Record<string, string>>(
    `SELECT program_code code, max(program_name) name,
            round(sum(grant_eur)::numeric, 0) eur, count(*) n
       FROM fund_projects WHERE ${cultureNameSql("beneficiary_name")}
      GROUP BY 1 ORDER BY sum(grant_eur) DESC NULLS LAST LIMIT 12`,
  );
  const interregByProgramme = await allRows<Record<string, string>>(
    `SELECT o.programme_code code, round(sum(p.budget_eur)::numeric, 0) eur,
            count(*) n
       FROM interreg_partners p JOIN interreg_operations o USING (keep_id)
      WHERE p.country = 'Bulgaria' AND ${interregThemeSql("o.title_en")}
      GROUP BY 1 ORDER BY sum(p.budget_eur) DESC NULLS LAST LIMIT 12`,
  );
  // ⚠️ ORDERED BY YEAR, not by money — this one is a TIME series and sorting it
  // by size would draw a ranking that looks like a trend. The ДФЗ arm is heavily
  // front-loaded (2015-2016), which is the shape a flat total hides.
  const agriByYear = await allRows<Record<string, string>>(
    `SELECT year, round(sum(total_eur)::numeric, 0) eur, count(*) n
       FROM agri_subsidies WHERE ${chitalishteNameSql("name")}
      GROUP BY 1 ORDER BY year`,
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
      byNameNames: num(fundsName.names),
      byNameTopProgram: {
        code: topProg?.code ?? "",
        name: topProg?.name ?? "",
        projects: num(topProg?.n),
        eur: num(topProg?.eur),
      },
      chitalishtaEur: num(fundsChit.eur),
      eikExactAlsoByName: num(fundsBoth.n),
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
    // Both ИСУН arms, not just the name one. A zeroed EIK arm — a regression in
    // CULTURE_GROUP_EIKS, or in fund_projects.beneficiary_eik — would otherwise
    // write a blob whose overlap sentence reads „0 от 0 … се хващат и по име",
    // which is a claim rather than an absence. The OVERLAP itself stays out: it
    // is bounded by this arm, so guarding the denominator guards it too, and a
    // legitimately disjoint pair must be reportable.
    [
      "ИСУН EIK-exact",
      out.funds.eikExactProjects,
      "db:load:funds:pg + the culture register",
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

  // ⚠️ ANNOTATED, for the reason the header states about `out`: an untyped
  // object literal is a second, unchecked copy of a shape, and a field renamed
  // on the consumer's interface would compile here and reach production as
  // `undefined`.
  const sources: CultureFundSourceBreakdowns = {
    generatedAt: out.generatedAt,
    eikBodyCount: num(eikBodies.n),
    eikByBeneficiary: eikByBeneficiary.map((r) => ({
      eik: r.eik ?? "",
      name: r.name ?? "",
      eur: num(r.eur),
      projects: num(r.n),
    })),
    byNameByProgram: nameByProgram.map((r) => ({
      code: r.code ?? "",
      name: r.name ?? "",
      eur: num(r.eur),
      projects: num(r.n),
    })),
    interregByProgramme: interregByProgramme.map((r) => ({
      code: r.code ?? "",
      eur: num(r.eur),
      rows: num(r.n),
    })),
    agriByYear: agriByYear.map((r) => ({
      year: num(r.year),
      eur: num(r.eur),
      rows: num(r.n),
    })),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
  fs.writeFileSync(OUT_SOURCES, JSON.stringify(sources, null, 0) + "\n");
  const bytes = fs.statSync(OUT).size;
  console.log(
    `culture fund_sources: ${fs.statSync(OUT_SOURCES).size} B → ` +
      `${path.relative(ROOT, OUT_SOURCES)}`,
  );
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
