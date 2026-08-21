// The ONE reader of `company_politicians`, for the three cross-reference builders that join it
// against money: `procurement/cross_reference.ts` (contractor rollups →
// data/procurement/derived/mp_connected.json), `funds/cross_reference.ts` (ИСУН beneficiaries
// → data/funds/derived/mp_connected.json) and `procurement/pep_connected.ts` (the officials
// arm → data/procurement/derived/pep_connected.json).
//
// Both replaced `data/parliament/companies-index.json`, whose registry arm matched an MP by
// NAME with no people-per-name guard. See docs/plans/company-page-consolidation-v1.md (Tier 5).
//
// ⚠️ THE TWO BUILDERS NEED DIFFERENT POPULATIONS, AND THAT IS THE WHOLE REASON THIS MODULE
// EXISTS RATHER THAN ONE SHARED QUERY. `company_politicians` is CONTRACT-RESTRICTED — its
// loader inner-joins procurement money, so every row is "a politically linked CONTRACTOR",
// which is what the A-F contract grade and every MP-tied procurement figure mean by it. The
// procurement builder's join population IS contractors, so that is the right source there.
// The funds builder's is ИСУН beneficiaries, where an MP-linked company that took EU money
// and never won a public contract is exactly the row to report: measured 2026-08-20, the
// restricted set answers **43 of that payload's 303 pairs**. It therefore reads the same gate
// live, through `MP_ARM_ALL_SQL`, which is `MP_ARM_SQL` minus the money join and nothing else.
//
// Both are the same gate: `person_role` at source tr/ngo through Bridge A/B, refused on a
// `tr_name_fold_people` fold the registry says belongs to more than one human, unioned with
// 096's confirmed declared stakes. Neither is "looser"; they differ in what they are joined to.

import { allRows, dbReachable } from "../db/lib/pg";
import { MP_ARM_ALL_SQL } from "../db/load_tr_pg";

export interface MpLinkRow {
  eik: string;
  /** Already parsed and validated — see readMpLinkRows. */
  mpId: number;
  mpName: string;
  relations: unknown[];
}

interface RawRow {
  eik: string;
  ref: string | null;
  politician: string;
  relations: unknown[] | null;
}

/** Which population the caller is joining against. `contractors` reads the served
 *  `company_politicians`; `all` re-derives the same gate live, without the money join. */
export type MpLinkScope = "contractors" | "all";

const SQL: Record<MpLinkScope, string> = {
  contractors: `SELECT cp.eik, cp.ref, cp.politician, cp.relations
                  FROM company_politicians cp
                 WHERE cp.kind = 'mp' AND cp.eik <> ''`,
  all: MP_ARM_ALL_SQL,
};

// Is the link set REACHABLE? — a different question from „does it hold rows", and the split is
// the whole point.
//
//   absent   → no Postgres, or company_politicians was never created: a fresh clone. Both
//              builders SKIP, and the raw corpus they were joining still lands.
//   present  → a load ran. If it then yields no mp rows that is a BROKEN load, and
//              readMpLinkRows throws rather than letting a builder rewrite mp_connected.json
//              empty — which reads as „no MP is linked to anything" at exit 0.
//
// It probes `company_politicians` for BOTH scopes deliberately: the `all` scope reads the
// person layer instead, but a database carrying one and not the other is a half-built state
// nothing here should try to publish from.
export const mpLinkageAvailable = async (): Promise<boolean> => {
  if (!(await dbReachable())) return false;
  const rows = await allRows<{ present: boolean }>(
    "SELECT to_regclass('public.company_politicians') IS NOT NULL AS present",
  );
  return rows[0]?.present === true;
};

// Every mp-arm row for `scope`, with the numeric mpId already parsed out of the `/candidate/
// mp-<id>` ref. `emptyMeans` is the sentence the caller wants in the error — the two corpora
// publish different claims when this silently returns nothing.
//
// ⚠️ THE mpId PARSE LIVES HERE, ONCE, AND IT REJECTS RATHER THAN COERCES. `Number(null)` is
// `0`, which is finite — so a `Number.isFinite` guard over a nullable ref accepts a row with
// no MP as MP id 0. Every entry then collapses onto one id, and `writeMpConnectedShards`
// prunes the real per-MP shards while writing a single `0.json`, at exit 0. That is not
// hypothetical: `company_politicians.ref` is scheduled to stop being a URL string.
const REF_MP_ID = /^\/candidate\/mp-(\d+)$/;

export const readMpLinkRows = async (
  emptyMeans: string,
  scope: MpLinkScope = "contractors",
): Promise<MpLinkRow[]> => {
  const raw = await allRows<RawRow>(SQL[scope]);
  const rows: MpLinkRow[] = [];
  let unparsed = 0;
  for (const r of raw) {
    const m = REF_MP_ID.exec(r.ref ?? "");
    if (!m) {
      unparsed++;
      continue;
    }
    rows.push({
      eik: r.eik,
      mpId: Number(m[1]),
      mpName: r.politician,
      relations: r.relations ?? [],
    });
  }
  if (rows.length === 0) {
    // Name the input the SCOPE actually read. „Run db:load:tr:pg" is the fix for an empty
    // company_politicians and no fix at all for an empty person layer, which is what the
    // 'all' scope reads — and the loader would fail the same way on it.
    const fix =
      scope === "contractors"
        ? "Run db:load:tr:pg (which needs a resolved person layer) first."
        : "The gated person layer is empty — run db:resolve:persons, then " +
          "db:load:declarations:pg -- --resolve.";
    throw new Error(
      `the MP↔company link set (scope=${scope}) yielded no usable mp rows ` +
        `(${raw.length} read, ${unparsed} with an unparseable ref) — ${emptyMeans} ${fix}`,
    );
  }
  // A ref shape change is a silent halving, not a failure, so it is reported rather than
  // inferred from a smaller payload later.
  if (unparsed > 0) {
    console.warn(
      `  ⚠️ ${unparsed}/${raw.length} mp link row(s) carry a ref that is not ` +
        `/candidate/mp-<id> — dropped`,
    );
  }
  return rows;
};

// ---------------------------------------------------------------------------
// The OFFICIALS arm — the same table at kind='official', for pep_connected.ts.
// ---------------------------------------------------------------------------
//
// It replaced `data/officials/derived/company_links.json`, whose confidence model was the
// discredited one its own header described: "high only when the name is rare on BOTH sides —
// unique among officials AND mapped to a single TR company", i.e. the one-company
// straitjacket migration 158's header calls wrong in both directions. 70,525 links over 9,659
// officials, **85.5% of them low-confidence**, of which `pep_connected` then kept only the
// ~579 high-confidence pairs whose company held a contract. Plan:
// docs/plans/company-page-consolidation-v1.md (Tier 6).
//
// ⚠️ THERE IS NO CONFIDENCE GRADE ANY MORE, AND THAT IS THE POINT. Every row here is already
// through migration 148's `tr_name_fold_people` fold — a name the Commerce Registry says
// belongs to more than one human is REFUSED, not scored — or is a declared stake 096
// confirmed against the registry. So the consumer's old `confidence !== "high"` filter has
// nothing left to drop, and the emitted grade is a constant `"high"` describing the SET, not
// a per-row judgement.
//
// ⚠️ NO 'all' SCOPE, unlike the mp side. This arm's join population IS contractors
// (`getContractor(eik)` decides every row), so the contract restriction on
// `company_politicians` costs it nothing — and an unrestricted officials set is 17,608
// companies against 964, a different question nobody here is asking.

export interface OfficialLinkRow {
  eik: string;
  /** The Court-of-Audit officials slug, parsed out of `/officials/<slug>`. */
  slug: string;
  name: string;
  /** 'executive' | 'municipal' | the raw person_role.source when it is neither. */
  tier: string;
  /**
   * ⚠️ THE PERSON'S OFFICE — `councillor`, `deputy_minister`, `state_enterprise` — and NOT
   * their relationship to the company. It comes from `person_role.role`, the same vocabulary
   * the retired `company_links.json` carried, because every consumer contracts this field as
   * the office: `PepConnectedEntry.role` feeds `NsTopOfficial.role`, and
   * `PoliticalOfficialLink.category` falls back to it.
   *
   * `company_politicians.role` is the WRONG column for it and reads as right today only by
   * accident: that table currently holds a pre-2026-08-20 vintage loaded from
   * `pep_connected.json`, where `role` WAS the office. The re-based `OFFICIAL_ARM_SQL` sets it
   * to `array_agg(g.kind …)[1]` — the company relationship — so on the next `db:load:tr:pg`
   * the vocabulary flips from `state_enterprise 284 / councillor 79` to
   * `director 393 / manager 236 / stake 54`, and every consumer starts publishing "director"
   * as a public office. The relationship is in `relations`, where it belongs.
   */
  role: string;
  /**
   * The person's relationship(s) to THIS company. Each entry is `{kind, isCurrent}` or
   * `{kind: 'stake', shareSize, valueEur, declarationYear}`.
   *
   * ⚠️ THE KEY IS `kind` ON THE CURRENT ARM AND `role` ON THE STORED VINTAGE, so a consumer
   * must accept both. `company_politicians` was loaded from `pep_connected.json` until
   * 2026-08-20 and those rows read `[{"role":"director","confidence":"high"}]`; the re-based
   * `OFFICIAL_ARM_SQL` emits `kind`. Reading only `kind` against a database that has not been
   * reloaded yields `undefined` on every row.
   */
  relations: unknown[];
}

const OFFICIAL_REF = /^\/officials\/(.+)$/;

// ⚠️ `tier` COMES FROM `person_role.source`, JOINED AT READ TIME, and it is deliberately not a
// column on company_politicians. The retired builder derived it from the officials register's
// `category` and had exactly two buckets; the person layer has four sources under this arm and
// the extra two are real — measured 2026-08-21: official_exec 415, official_muni 116,
// public_sector 46, mep 2. Collapsing those last two into either bucket would file a hospital
// director under "executive government" or an MEP under "municipal", so they pass through as
// themselves and the consumer renders what it is given (`by_ns.ts` already tolerates a tier it
// does not recognise, via `meta?.tier ?? ""`).
export const readOfficialLinkRows = async (
  emptyMeans: string,
): Promise<OfficialLinkRow[]> => {
  const raw = await allRows<{
    eik: string;
    ref: string | null;
    politician: string;
    office_role: string | null;
    source: string | null;
    relations: unknown[] | null;
  }>(
    // `min(pr.role)` and `min(pr.source)`, not cp.role: see the OfficialLinkRow.role note.
    // A person holding two officials postings gets the alphabetically first of each, which is
    // the same arbitrary-but-stable choice OFFICIAL_ARM_SQL makes for its own ref.
    `SELECT cp.eik, cp.ref, cp.politician, cp.relations,
            min(pr.role)   AS office_role,
            min(pr.source) AS source
       FROM company_politicians cp
       LEFT JOIN person_role pr
         ON pr.person_id = cp.person_id
        AND pr.ref = substring(cp.ref from '^/officials/(.*)$')
      WHERE cp.kind = 'official' AND cp.eik <> ''
      GROUP BY cp.eik, cp.ref, cp.politician, cp.relations`,
  );

  const rows: OfficialLinkRow[] = [];
  let unparsed = 0;
  for (const r of raw) {
    const m = OFFICIAL_REF.exec(r.ref ?? "");
    if (!m) {
      unparsed++;
      continue;
    }
    rows.push({
      eik: r.eik,
      slug: m[1],
      name: r.politician,
      tier:
        r.source === "official_exec"
          ? "executive"
          : r.source === "official_muni"
            ? "municipal"
            : (r.source ?? ""),
      role: r.office_role ?? "",
      relations: r.relations ?? [],
    });
  }
  if (rows.length === 0) {
    throw new Error(
      `company_politicians yielded no usable official rows ` +
        `(${raw.length} read, ${unparsed} with an unparseable ref) — ${emptyMeans} ` +
        `Run db:load:tr:pg (which needs a resolved person layer) first.`,
    );
  }
  if (unparsed > 0) {
    console.warn(
      `  ⚠️ ${unparsed}/${raw.length} official link row(s) carry a ref that is not ` +
        `/officials/<slug> — dropped`,
    );
  }
  return rows;
};
