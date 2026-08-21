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
//   CROSS-ATTRIBUTED — the code matched exactly and still names the wrong grant,
//                because a buyer cited somebody else's code, or because
//                `canonicalise()` padded a truncated one onto a real project. The
//                whole `code_and_buyer` / `code_only` split exists for this, and
//                the tests below re-derive BOTH corroborations from the source
//                corpora rather than trusting the stored labels.
//
// ⚠️ THE RE-DERIVATION IS THE POINT. `confidence` is CHECK-enforced against
// `code_verbatim` + `buyer_basis` in 166, so a test asserting „no citable link
// crosses buyers" against the STORED `buyer_basis` is satisfied by the constraint
// alone and would pass on a loader that computed the column backwards — §13's
// „a denominator that is the thing under test". Every corroboration test here
// therefore joins back to contracts / tenders / fund_projects and ignores the
// stored verdict.
//
// Auto-skips ONLY when Postgres is down. An empty table is a FAILURE: both
// corpora it reads are loaded by db:refresh.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  allRows,
  dbReachable,
  end,
  exec,
  isServingDatabase,
  withTx,
} from "../lib/pg";

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
  citableEdges: number;
  citableCodes: number;
  citableTenders: number;
  citableContracts: number;
  codeOnlyEdges: number;
  buyerMismatchEdges: number;
  buyerMismatchCodes: number;
  paddedCodeEdges: number;
  codesWithoutCitableLink: number;
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

/** Every link with the buyer and beneficiary re-derived from the SOURCE corpora.
 *  Nothing here reads `buyer_basis` or `confidence` — that is what makes the
 *  assertions below checks of the loader rather than of 166's CHECK. */
const REDERIVED = `
  SELECT g.pii_code, g.link_kind, g.ref, g.confidence,
         g.code_verbatim, g.buyer_basis,
         COALESCE(c.awarder_eik, t.buyer_eik) AS buyer,
         COALESCE(c.awarder_name, t.buyer_name) AS buyer_name,
         f.beneficiary_eik, f.beneficiary_name,
         COALESCE(c.title, t.subject) AS src_text
    FROM grant_contract_link g
    LEFT JOIN contracts c ON g.link_kind = 'contract' AND c.key = g.ref
    LEFT JOIN tenders  t ON g.link_kind = 'tender'   AND t.unp = g.ref
    LEFT JOIN fund_projects f ON f.contract_number = g.pii_code`;

test.skipIf(skip)("the spine is populated on both sides", async () => {
  const c = await coverage();
  assert.ok(
    c.linkedCodes > 300,
    `only ${c.linkedCodes} ПИИ codes are linked (was 448) — run db:load:grant-links:pg`,
  );
  // BOTH sides, separately. The contract half can be healthy while the tender
  // half is empty (a tenders reload that lost `subject`), and the spine would
  // still look populated.
  assert.ok(c.linkedTenders > 500, `only ${c.linkedTenders} linked procedures`);
  assert.ok(
    c.linkedContracts > 1000,
    `only ${c.linkedContracts} linked contracts`,
  );
  // And the CITABLE half separately again, because that is the only tier a
  // surface may present as an attribution. A corroboration bug that downgraded
  // everything would leave every count above healthy.
  assert.ok(
    c.citableCodes > 300 && c.citableEdges > 2000,
    `only ${c.citableEdges} citable link(s) over ${c.citableCodes} code(s) ` +
      `(was 2,594 over 436) — the corroboration has collapsed`,
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

// ─── Cross-attribution: the defect this table was rebuilt for ─────────────────

test.skipIf(skip)(
  "NO CITABLE LINK CROSSES BUYERS — re-derived, not read back",
  async () => {
    // The headline assertion. `code_and_buyer` is the only tier a surface may
    // render as „this grant paid for this procurement", so every one of those
    // rows must survive a fresh join: the procuring buyer IS the grant's
    // beneficiary, and the grant exists at all.
    //
    // Deliberately NOT `WHERE confidence = 'code_and_buyer' AND buyer_basis <>
    // 'beneficiary'` — 166's CHECK makes that combination unrepresentable, so
    // the assertion would be true of any database and would pass against a
    // loader that filled `buyer_basis` with a constant.
    const rows = await allRows<{
      pii_code: string;
      ref: string;
      buyer_name: string;
      beneficiary_name: string;
    }>(
      `WITH l AS (${REDERIVED})
       SELECT pii_code, ref, buyer_name, beneficiary_name FROM l
        WHERE confidence = 'code_and_buyer'
          AND (beneficiary_eik IS NULL
               OR buyer IS DISTINCT FROM beneficiary_eik)
        ORDER BY pii_code, ref`,
    );
    assert.deepEqual(
      rows.map(
        (r) =>
          `${r.pii_code} ${r.ref}: procured by ${r.buyer_name}, granted to ${r.beneficiary_name}`,
      ),
      [],
      "these links are published as authoritative attributions and name a " +
        "buyer that is not the grant's beneficiary — one institution's " +
        "procurement hanging off another institution's grant",
    );
  },
);

test.skipIf(skip)(
  "…and the buyer check still DISCRIMINATES on today's corpus",
  async () => {
    // §13: a gate must be able to fail. The assertion above is vacuous the
    // moment no link crosses buyers, and a corpus with none looks identical to a
    // corpus where the check was deleted. So assert the counter-examples EXIST
    // and that every one of them was caught.
    const rows = await allRows<{ pii_code: string; confidence: string }>(
      `WITH l AS (${REDERIVED})
       SELECT pii_code, confidence FROM l
        WHERE beneficiary_eik IS NOT NULL
          AND buyer IS NOT NULL
          AND buyer <> beneficiary_eik`,
    );
    assert.ok(
      rows.length > 0,
      "no link in the corpus crosses buyers, so the assertion above proves " +
        "nothing. Was 15 links over 10 codes on 2026-08-21. If procurement " +
        "text really has stopped citing other bodies' codes, retire this test " +
        "deliberately rather than leaving a green tautology behind.",
    );
    assert.deepEqual(
      [...new Set(rows.map((r) => r.confidence))],
      ["code_only"],
      "a cross-buyer link is stored at a confidence other than 'code_only'",
    );
  },
);

test.skipIf(skip)(
  "the ACF case: Плевен's tenders do not hang off Сатиричния театър's grant",
  async () => {
    // BG-RRP-4.020-0001 belongs to Държавен сатиричен театър (ЕИК 000670794) and
    // is one of the procurements examined in ACF's „Милиони зад кулисите". ДКТ
    // „Иван Радоев" Плевен (000403802) cites it on three of its own procedures
    // while holding its own grant, -0005. Named here because it is the single
    // row this whole change exists to stop publishing, and a generic assertion
    // would not say so when it broke.
    const rows = await allRows<{
      ref: string;
      confidence: string;
      buyer: string;
    }>(
      `WITH l AS (${REDERIVED})
       SELECT ref, confidence, buyer FROM l
        WHERE pii_code = 'BG-RRP-4.020-0001' ORDER BY ref`,
    );
    assert.ok(rows.length > 0, "BG-RRP-4.020-0001 no longer links to anything");
    for (const r of rows.filter((x) => x.buyer === "000403802"))
      assert.equal(
        r.confidence,
        "code_only",
        `${r.ref} (ДКТ „Иван Радоев" Плевен) is published as an authoritative ` +
          `attribution to Държавен сатиричен театър's grant`,
      );
    // The grant holder's OWN procurement must survive as citable — a fix that
    // downgraded the whole code would be a different defect wearing this one's
    // clothes.
    assert.ok(
      rows.some(
        (r) => r.buyer === "000670794" && r.confidence === "code_and_buyer",
      ),
      "Държавен сатиричен театър's own procurement under its own grant is no " +
        "longer citable — the buyer check is now rejecting correct links",
    );
  },
);

test.skipIf(skip)(
  "buyer_basis is re-derivable from the source corpora, every row",
  async () => {
    // The mutation check for the stored column: it is what `confidence` is built
    // from, so a column filled correctly-looking but computed wrong produces a
    // fully self-consistent table that satisfies the CHECK and misattributes.
    // Full corpus, not a sample — the rows that move are hand-typing accidents.
    const rows = await allRows<{ pii_code: string; ref: string; got: string }>(
      `WITH l AS (${REDERIVED})
       SELECT pii_code, ref, buyer_basis AS got FROM l
        WHERE buyer_basis IS DISTINCT FROM CASE
                WHEN buyer IS NULL OR beneficiary_eik IS NULL THEN 'unknown'
                WHEN beneficiary_eik = buyer                  THEN 'beneficiary'
                ELSE 'other_buyer' END
        LIMIT 20`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.pii_code}/${r.ref} stored ${r.got}`),
      [],
      "stored buyer_basis disagrees with a fresh join against contracts / " +
        "tenders / fund_projects",
    );
  },
);

test.skipIf(skip)(
  "code_verbatim is re-derivable from the source text, every row",
  async () => {
    // TRUE means the full 4-digit code was written in the procurement text;
    // FALSE means canonicalise() padded a short or truncated spelling onto it.
    //
    // ⚠️ Re-derived with the LOADER's own trailing guard, not with `strpos`. A
    // plain substring test has no equivalent of `(?![0-9])`, so on a text
    // carrying a 5-digit ordinal („BG-RRP-1.007-00171") the loader correctly
    // matches nothing while `strpos` finds „BG-RRP-1.007-0017" inside it — a
    // green loader failing this gate. Latent rather than live (0 rows in either
    // corpus carry a 5-digit ordinal today), which is exactly when it is cheap to
    // close. The left side is deliberately UNANCHORED, because the loader's
    // pattern is too: adding `(^|[^0-9])` would make this test STRICTER than the
    // code it checks, which is the same defect pointing the other way.
    // Measured 2026-08-21: padded links are 9 of 2,616 and carry 2 of the 15
    // buyer mismatches — 22% against 0.5%, a 45x rate — which is why they are
    // barred from the citable tier regardless of the buyer.
    const rows = await allRows<{
      pii_code: string;
      ref: string;
      stored: boolean;
    }>(
      `WITH l AS (${REDERIVED})
       SELECT pii_code, ref, code_verbatim AS stored FROM l
        WHERE code_verbatim IS DISTINCT FROM
              (src_text ~ (replace(pii_code, '.', '\\.') || '(?![0-9])'))
        LIMIT 20`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.pii_code}/${r.ref} stored ${r.stored}`),
      [],
      "stored code_verbatim disagrees with the procurement text it was read from",
    );
  },
);

test.skipIf(skip)(
  "a padded code is never citable — and padding still occurs",
  async () => {
    const rows = await allRows<{ pii_code: string; ref: string }>(
      `SELECT pii_code, ref FROM grant_contract_link
        WHERE NOT code_verbatim AND confidence = 'code_and_buyer'`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.pii_code}/${r.ref}`),
      [],
      "a code this loader padded into existence is published as an " +
        "authoritative attribution — Столична община's truncated " +
        "BG-RRP-1.007-017 pads onto Община Добрич's real project",
    );
    // Non-vacuity, again: with no padded rows the assertion above is free.
    const c = await coverage();
    assert.ok(
      c.paddedCodeEdges > 0,
      "no link came from a padded spelling, so the assertion above proves " +
        "nothing. Was 9 on 2026-08-21 — if the corpus really has stopped " +
        "carrying short codes, retire this test rather than leaving it green.",
    );
  },
);

test.skipIf(skip)(
  "the derivation is enforced by the DATABASE, not just by the loader",
  async () => {
    // §16's „model it so the inversion is unreachable". Without this constraint
    // a future arm can write `code_and_buyer` beside `other_buyer` and every
    // re-derivation test above keeps passing, because they read `confidence`.
    const [r] = await allRows<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) def FROM pg_constraint
        WHERE conname = 'grant_contract_link_confidence_derived'`,
    );
    assert.ok(
      r?.def,
      "grant_contract_link_confidence_derived is missing — confidence is no " +
        "longer tied to the evidence it is supposed to be derived from",
    );
    assert.match(r.def, /code_verbatim/);
    assert.match(r.def, /buyer_basis/);
    // It must call the ONE definition rather than restate the CASE. A constraint
    // carrying its own copy agrees with the loader only until somebody edits one.
    assert.match(
      r.def,
      /grant_link_confidence/,
      "the CHECK restates the derivation instead of calling " +
        "grant_link_confidence() — 166 names four call sites for exactly this " +
        "reason (the kzk_effective_suspension precedent)",
    );
  },
);

test.skipIf(skip)(
  "grant_link_confidence() still DISCRIMINATES over its whole domain",
  async () => {
    // The shared definition is now the single point of failure for every verdict
    // in the table, and a function returning a constant would satisfy the CHECK,
    // the loader and every re-derivation test at once — they all call it. So
    // exercise it directly, over all four inputs, against no stored data.
    const rows = await allRows<{ v: boolean; b: string; got: string }>(
      `SELECT v, b, grant_link_confidence(v, b) got
         FROM (VALUES (true), (false)) a(v),
              (VALUES ('beneficiary'), ('other_buyer'), ('unknown')) c(b)
        ORDER BY v DESC, b`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.v}/${r.b} → ${r.got}`),
      [
        "true/beneficiary → code_and_buyer",
        "true/other_buyer → code_only",
        "true/unknown → code_only",
        "false/beneficiary → code_only",
        "false/other_buyer → code_only",
        "false/unknown → code_only",
      ],
      "grant_link_confidence() no longer maps its domain the way 166 documents " +
        "— exactly one of six inputs may yield an authoritative verdict",
    );
  },
);

test.skipIf(skip)(
  "every stored verdict equals the shared definition's answer",
  async () => {
    // Belt to the CHECK's braces, and not redundant: the CHECK is only enforced
    // on write, so a constraint added NOT VALID, dropped by a hand-run ALTER, or
    // lost with a CASCADE leaves the stored rows unchecked and everything green.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM grant_contract_link
        WHERE confidence
              IS DISTINCT FROM grant_link_confidence(code_verbatim, buyer_basis)`,
    );
    assert.equal(
      Number(r.n),
      0,
      `${r.n} stored row(s) carry a verdict grant_link_confidence() does not give them`,
    );
  },
);

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
    // The corroboration split must be publishable too, and the two must not be
    // the same number: a surface quoting `linkedCodes` while meaning
    // `citableCodes` is the conflation this table was rebuilt to end. Measured
    // 448 vs 436.
    assert.ok(
      c.citableCodes < c.linkedCodes &&
        c.citableEdges < c.tenderEdges + c.contractEdges,
      `citable (${c.citableCodes} codes / ${c.citableEdges} edges) equals the ` +
        `linked total (${c.linkedCodes} codes) — either nothing is being ` +
        `refused, or the split has stopped being computed`,
    );
    assert.equal(
      c.codeOnlyEdges,
      c.tenderEdges + c.contractEdges - c.citableEdges,
      "codeOnlyEdges is not the complement of citableEdges — the coverage " +
        "function's own arithmetic disagrees with itself",
    );
    // Non-vacuity: some code must be unattributable, or the split is not
    // splitting. This is the half that can actually fail on a corpus change.
    assert.ok(
      c.codesWithoutCitableLink > 0,
      `no code lacks a citable link (was 12 of 448) — either the corroboration ` +
        `stopped refusing anything, or the count stopped being computed`,
    );
    // …and the identity that pins the coverage function's arithmetic. The `<=`
    // this replaces was UNFAILABLE — every linked code is in exactly one of the
    // two buckets by construction, so `linkedCodes = citableCodes +
    // codesWithoutCitableLink` holds on any data and any loader bug, while
    // reading as the strictest line in the block (§13's fourth shape). As an
    // equality it at least pins the three counts against each other.
    assert.equal(
      c.codesWithoutCitableLink,
      c.linkedCodes - c.citableCodes,
      `codesWithoutCitableLink (${c.codesWithoutCitableLink}) is not ` +
        `linkedCodes − citableCodes (${c.linkedCodes} − ${c.citableCodes}) — the ` +
        `coverage function's two code counts partition a different set`,
    );
  },
);

test.skipIf(skip)("the worked example in the plan still resolves", async () => {
  // docs/plans/culture-investigative-v1.md §1.6 names this one end to end. If it
  // stops resolving, the plan's evidence for the whole idea is stale.
  const rows = await allRows<{ link_kind: string; ref: string }>(
    `SELECT link_kind, ref FROM grant_contract_link
      WHERE pii_code = 'BG-RRP-4.020-0003' AND confidence = 'code_and_buyer'
      ORDER BY link_kind, ref`,
  );
  assert.ok(
    rows.length > 0,
    "BG-RRP-4.020-0003 (Драматичен театър Ловеч) no longer has an AUTHORITATIVE " +
      "link to any procurement — the plan's §1.6 worked example is the spine's " +
      "evidence, and a `code_only` link cannot carry it",
  );
  const [grant] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM fund_projects WHERE contract_number = 'BG-RRP-4.020-0003'`,
  );
  assert.ok(
    Number(grant.n) > 0,
    "the grant side of the worked example is gone",
  );
});

const SCHEMA_166 = path.join(
  process.cwd(),
  "scripts/db/schema/pg/166_grant_contract_link.sql",
);

test.skipIf(skip)(
  "166 still CLEARS rows that cannot satisfy its own CHECK",
  () => {
    // The static half, and the cheap one. 166's header and sector-dashboard
    // SKILL.md §11 both record that this DELETE is what makes the table
    // recoverable at all — the loader applies the migration BEFORE it reaches its
    // own DELETE, so without this clause a table a buggy loader wrote can never
    // be rebuilt by a fixed one: every run dies in the apply phase on
    // ADD CONSTRAINT. Learned by measurement while writing that migration, and
    // invisible until the day it is needed.
    const sql = fs.readFileSync(SCHEMA_166, "utf8");
    assert.match(
      sql,
      /DELETE FROM grant_contract_link[\s\S]*?grant_link_confidence\(code_verbatim, buyer_basis\)/,
      "166 no longer clears rows whose stored verdict disagrees with " +
        "grant_link_confidence() — a table written by a buggy loader becomes " +
        "unrebuildable, because the loader applies this file before it reaches " +
        "its own DELETE",
    );
  },
);

test.skipIf(skip || isServingDatabase())(
  "…and re-applying 166 really does repair such a table",
  async () => {
    // The behavioural half. The static match above passes on a clause that has
    // stopped working; this one actually drops the constraint, plants exactly the
    // row a buggy loader would leave behind, and re-applies the file — which is
    // the operation that used to fail.
    //
    // ⚠️ Skipped against the SERVING database. It mutates rows, and the repair it
    // proves is a property of the migration, not of any one corpus — so local is
    // where it belongs. It restores the planted row's absence by re-deriving from
    // the row it copied, and asserts the table is whole again at the end.
    const [{ n: beforeN }] = await allRows<{ n: string }>(
      `SELECT count(*)::text n FROM grant_contract_link`,
    );

    const planted = await withTx(async (c) => {
      await c.query(
        `ALTER TABLE grant_contract_link
           DROP CONSTRAINT grant_contract_link_confidence_derived`,
      );
      // A verbatim + beneficiary row mislabelled `code_only`: precisely what a
      // loader that had stopped calling grant_link_confidence() would write.
      const r = await c.query(
        `INSERT INTO grant_contract_link
           (pii_code, link_kind, ref, confidence, basis, code_verbatim, buyer_basis)
         VALUES ('BG-RRP-9.999-9999', 'tender', '__repair_probe__',
                 'code_only', 'tender_subject', true, 'beneficiary')
         RETURNING ref`,
      );
      return r.rowCount ?? 0;
    });
    assert.equal(planted, 1, "could not plant the inconsistent row");

    // The operation under test: this raised 42P16-style on ADD CONSTRAINT before
    // the reconcile DELETE existed, rolling the whole file back.
    await exec(fs.readFileSync(SCHEMA_166, "utf8"));

    const probe = await allRows<{ ref: string }>(
      `SELECT ref FROM grant_contract_link WHERE ref = '__repair_probe__'`,
    );
    assert.deepEqual(
      probe,
      [],
      "the inconsistent row survived a re-apply — 166's reconcile DELETE has " +
        "stopped clearing rows its own CHECK would reject, so the ADD CONSTRAINT " +
        "below it is one buggy load away from being unrunnable",
    );

    const [{ def }] = await allRows<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) def FROM pg_constraint
        WHERE conname = 'grant_contract_link_confidence_derived'`,
    );
    assert.match(
      def,
      /grant_link_confidence/,
      "the derivation CHECK was not restored by the re-apply",
    );

    const [{ n: afterN }] = await allRows<{ n: string }>(
      `SELECT count(*)::text n FROM grant_contract_link`,
    );
    assert.equal(
      afterN,
      beforeN,
      `the repair took ${Number(beforeN) - Number(afterN)} real row(s) with it ` +
        `— the reconcile DELETE is over-matching. Re-run db:load:grant-links:pg`,
    );
  },
);

test.skipIf(skip)(
  "only the confidence, basis and buyer_basis the loader writes appear",
  async () => {
    const rows = await allRows<{ confidence: string; basis: string }>(
      `SELECT DISTINCT confidence, basis FROM grant_contract_link ORDER BY 1, 2`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.confidence}/${r.basis}`).sort(),
      [
        "code_and_buyer/contract_title",
        "code_and_buyer/tender_subject",
        "code_only/contract_title",
        "code_only/tender_subject",
      ],
      "the spine stores a confidence or basis the loader does not write, or has " +
        "stopped writing one — a looser arm must declare its own value rather " +
        "than borrowing an existing tier, and `exact_code` is RETIRED: it named " +
        "a code match as if it were an attribution",
    );
    const bases = await allRows<{ buyer_basis: string }>(
      `SELECT DISTINCT buyer_basis FROM grant_contract_link ORDER BY 1`,
    );
    assert.deepEqual(
      bases.map((r) => r.buyer_basis),
      ["beneficiary", "other_buyer", "unknown"],
      "a buyer_basis value has disappeared from the corpus — 'unknown' covers " +
        "the codes ИСУН does not publish and must not be folded into either " +
        "of the other two",
    );
  },
);
