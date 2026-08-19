// Gate for grant_contract_link (migration 166) — the money spine.
//
// It is an EXTRACTION FROM FREE TEXT, so the ways it goes wrong are the ways
// extractions do:
//
//   TOO LOOSE  — a prefix match (`BG-RRP` rather than the full code) links a
//                contract that merely MENTIONS the programme, and a truncated
//                code (component.procedure without the project) collapses every
//                project under one procedure into a single spine, attributing
//                one theatre's contractor to another theatre's grant.
//   TOO NARROW — the extraction stops matching and the table empties, which on a
//                spine surface reads as „this grant bought nothing" rather than
//                as a broken loader.
//   OVERCLAIMED — the spine covers the RRF slice ONLY. ЕФРР and ЕСФ contracts
//                carry no such code, so a surface that does not publish its
//                coverage tells every non-RRF reader their project bought
//                nothing.
//
// Auto-skips ONLY when Postgres is down. An empty table is a FAILURE: both
// corpora it reads are loaded by db:refresh.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

interface Coverage {
  linkedCodes: number;
  tenderEdges: number;
  contractEdges: number;
  linkedTenders: number;
  linkedContracts: number;
  rrfProjects: number;
  fundProjects: number;
  unmatchedCodes: number;
}

const coverage = async (): Promise<Coverage> => {
  const [r] = await allRows<{ r: Coverage }>(
    `SELECT grant_contract_link_coverage() AS r`,
  );
  return r.r;
};

test.skipIf(skip)("the spine is populated on both sides", async () => {
  const c = await coverage();
  assert.ok(
    c.linkedCodes > 300,
    `only ${c.linkedCodes} ПИИ codes are linked (was 449) — run db:load:grant-links:pg`,
  );
  // BOTH sides, separately. The contract half can be healthy while the tender
  // half is empty (a tenders reload that lost `subject`), and the spine would
  // still look populated.
  assert.ok(c.linkedTenders > 500, `only ${c.linkedTenders} linked procedures`);
  assert.ok(
    c.linkedContracts > 1000,
    `only ${c.linkedContracts} linked contracts`,
  );
  // Edges >= entities, always: a tender naming two codes is two edges and one
  // procedure. If they were ever equal, the coverage function would have stopped
  // distinguishing them — the basis ambiguity `funds_hub_stats` forbids.
  assert.ok(
    c.tenderEdges >= c.linkedTenders && c.contractEdges >= c.linkedContracts,
    `edge counts (${c.tenderEdges}/${c.contractEdges}) fell below entity counts ` +
      `(${c.linkedTenders}/${c.linkedContracts}) — they have been confused`,
  );
});

test.skipIf(skip)(
  "every stored code is a FULL, FIXED-WIDTH ПИИ code",
  async () => {
    // The too-loose failure, asserted on the stored values — and asserted on
    // WIDTH, which is the part the first version of this test missed.
    //
    // A shape-only predicate (`[0-9]+` per segment) returns 0 while the table
    // holds „BG-RRP-1.012-002": syntactically fine, and a DIFFERENT project from
    // „-0002" to every join. Every code ИСУН publishes is a 3-digit procedure and
    // a 4-digit project — 14,180 of 14,180 — so anything else stored here is an
    // unpadded spelling the loader failed to canonicalise, or a title truncated
    // mid-code.
    const rows = await allRows<{ pii_code: string }>(
      `SELECT DISTINCT pii_code FROM grant_contract_link
        WHERE pii_code !~ '^BG-RRP-[0-9]+\\.[0-9]{3}-[0-9]{4}$'`,
    );
    assert.deepEqual(
      rows.map((r) => r.pii_code),
      [],
      "these are not canonical ПИИ codes — an unpadded one is a different " +
        "project to every join, and a truncated one merges separate projects",
    );
  },
);

test.skipIf(skip)(
  "ИСУН's own codes are all fixed-width — the premise of padding",
  async () => {
    // Canonicalising by zero-padding only makes sense while the register is
    // uniform. If ИСУН ever publishes a 5-digit project, padding stops being a
    // canonical form and becomes a guess.
    const [r] = await allRows<{ total: string; fixed: string }>(
      `SELECT count(*) total,
              count(*) FILTER (
                WHERE contract_number ~ '^BG-RRP-[0-9]+\\.[0-9]{3}-[0-9]{4}$'
              ) fixed
         FROM fund_projects WHERE contract_number ~ 'BG-RRP'`,
    );
    assert.equal(
      r.fixed,
      r.total,
      `${Number(r.total) - Number(r.fixed)} ИСУН codes are not the 3+4 fixed ` +
        `width the loader pads to — zero-padding is no longer a canonicalisation`,
    );
  },
);

test.skipIf(skip)("the codes overwhelmingly exist in ИСУН", async () => {
  // The join's whole premise. A few unmatched codes are normal (a procurement
  // naming a project ИСУН has not published); a spike means the extraction has
  // started matching something that is not a project code.
  const c = await coverage();
  const share = c.unmatchedCodes / c.linkedCodes;
  assert.ok(
    share < 0.02,
    `${c.unmatchedCodes} of ${c.linkedCodes} linked codes (${(
      share * 100
    ).toFixed(
      1,
    )}%) are unknown to fund_projects — was 1 of 448 (0.2%) after canonicalisation`,
  );
});

test.skipIf(skip)("a ref always names a real tender or contract", async () => {
  const orphanTenders = await allRows<{ ref: string }>(
    `SELECT l.ref FROM grant_contract_link l
      WHERE l.link_kind = 'tender'
        AND NOT EXISTS (SELECT 1 FROM tenders t WHERE t.unp = l.ref)
      LIMIT 10`,
  );
  assert.deepEqual(
    orphanTenders.map((r) => r.ref),
    [],
    "tender refs with no tender",
  );
  const orphanContracts = await allRows<{ ref: string }>(
    `SELECT l.ref FROM grant_contract_link l
      WHERE l.link_kind = 'contract'
        AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.key = l.ref)
      LIMIT 10`,
  );
  assert.deepEqual(
    orphanContracts.map((r) => r.ref),
    [],
    "contract refs with no contract",
  );
});

test.skipIf(skip)(
  "coverage is publishable, and honest about the slice",
  async () => {
    // A spine surface must be able to say „this covers the RRF slice, which is N
    // of M projects". If the denominator ever equalled the numerator, the UI would
    // start implying it covers the whole funds corpus.
    const c = await coverage();
    assert.ok(c.rrfProjects > 0, "no RRF projects in fund_projects");
    assert.ok(
      c.rrfProjects < c.fundProjects,
      `rrfProjects (${c.rrfProjects}) is not below fundProjects (${c.fundProjects}) — ` +
        `the spine would read as covering the whole funds corpus`,
    );
    assert.ok(
      c.linkedCodes < c.rrfProjects,
      `more codes are linked (${c.linkedCodes}) than there are RRF projects ` +
        `(${c.rrfProjects}) — the extraction is finding codes ИСУН does not have`,
    );
  },
);

test.skipIf(skip)("the worked example in the plan still resolves", async () => {
  // docs/plans/culture-investigative-v1.md §1.6 names this one end to end. If it
  // stops resolving, the plan's evidence for the whole idea is stale.
  const rows = await allRows<{ link_kind: string; ref: string }>(
    `SELECT link_kind, ref FROM grant_contract_link
      WHERE pii_code = 'BG-RRP-4.020-0003' ORDER BY link_kind, ref`,
  );
  assert.ok(
    rows.length > 0,
    "BG-RRP-4.020-0003 (Драматичен театър Ловеч) no longer links to any " +
      "procurement — the plan's §1.6 worked example is the spine's evidence",
  );
  const [grant] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM fund_projects WHERE contract_number = 'BG-RRP-4.020-0003'`,
  );
  assert.ok(
    Number(grant.n) > 0,
    "the grant side of the worked example is gone",
  );
});

test.skipIf(skip)(
  "only the confidence and basis the loader writes appear",
  async () => {
    const rows = await allRows<{ confidence: string; basis: string }>(
      `SELECT DISTINCT confidence, basis FROM grant_contract_link ORDER BY 1, 2`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.confidence}/${r.basis}`).sort(),
      ["exact_code/contract_title", "exact_code/tender_subject"],
      "the spine stores a confidence or basis the loader does not write — a looser " +
        "arm must declare its own value rather than borrowing 'exact_code'",
    );
  },
);
