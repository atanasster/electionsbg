// Both arms of company_politicians, re-based onto the gated person layer (Tier 4a + 4b).
//
// WHAT IS AT STAKE. Every row is "this named MP is linked to this named company", and the
// table feeds the A-F risk grade on 409,644 contracts (112's fired-mask bits 1 and 2), the
// client-side risk scorer (033), contractor_rank.is_mp_tied (122) and four of 124's
// aggregates. A wrong row is a public accusation with a number attached.
//
// IT RUNS THE SHIPPED QUERY. `MP_ARM_SQL` is imported from the loader, not re-typed here —
// the MP_ROLES_SQL precedent: that query raised 0P000 on every run for two days while its
// caller's catch printed "Postgres unreachable", because the unit tests mocked the database
// and nothing ever parsed the SQL. A test that re-types the query cannot catch that class.
//
// ⚠️ THIS ASSERTS THE QUERY, NOT THE TABLE. company_politicians only changes when
// db:load:tr:pg runs, so on a database whose last TR load predates this change the table
// still holds the name-matched vintage while the query below is already correct. That is the
// ordinary "inert until the corpus is rebuilt" state this repo documents everywhere — but it
// does mean a green run here is NOT evidence that the served table is re-based.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { MP_ARM_SQL, OFFICIAL_ARM_SQL } from "../load_tr_pg";

type Row = {
  eik: string;
  politician: string;
  ref: string;
  role: string | null;
  total_eur: string | null;
  person_id: string | null;
  relations: {
    kind?: string;
    isCurrent?: boolean;
    shareSize?: string | null;
    valueEur?: number;
  }[];
};

const reachable = async (): Promise<string | false> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_stake_company",
    );
    if (Number(c.n) === 0) return "declaration_stake_company is empty";
    const [p] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE source = 'mp'",
    );
    if (Number(p.n) === 0)
      return "no mp roles — the person layer is unresolved";
    return false;
  } catch {
    return "Postgres unreachable";
  }
};

const skip = await reachable();
let rows: Row[] = [];
let officialRows: Row[] = [];
if (!skip) {
  rows = await allRows<Row>(MP_ARM_SQL);
  officialRows = await allRows<Row>(OFFICIAL_ARM_SQL);
}

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "the arm is non-empty and one row per (person, company)",
  async () => {
    assert.ok(rows.length > 0, "the mp arm produced no rows at all");
    // The GROUP BY is (eik, person_id) and the ref carries the person, so a repeated
    // (eik, ref) pair would mean one MP listed twice against one company.
    const seen = new Set(rows.map((r) => `${r.eik}|${r.ref}`));
    assert.equal(
      seen.size,
      rows.length,
      "a (company, MP) pair appears more than once",
    );
  },
);

test.skipIf(skip)(
  "every company on this arm actually holds contracts",
  async () => {
    // The restriction that keeps the table meaning "politically linked CONTRACTOR". Without
    // it the set goes 964 → 17,608 and every consumer's question changes silently.
    const [bad] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM unnest($1::text[]) AS e(eik)
      WHERE NOT EXISTS (SELECT 1 FROM contracts c WHERE c.contractor_eik = e.eik)`,
      [rows.map((r) => r.eik)],
    );
    assert.equal(
      bad.n,
      "0",
      "a company with no contracts reached the contractor table",
    );
  },
);

test.skipIf(skip)("every person on this arm is an MP", async () => {
  const ids = rows.map((r) => r.ref.replace("/candidate/mp-", ""));
  const [bad] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM unnest($1::text[]) AS m(id)
      WHERE NOT EXISTS (SELECT 1 FROM person_role pr
                         WHERE pr.source = 'mp' AND split_part(pr.ref, ':', 1) = m.id)`,
    [ids],
  );
  assert.equal(bad.n, "0", "a non-MP reached the mp arm");
  // The ref format is load-bearing: load_graph_pg.ts and 112 both parse it with a regex.
  for (const r of rows)
    assert.match(r.ref, /^\/candidate\/mp-[^/]+$/, `bad ref shape: ${r.ref}`);
});

test.skipIf(skip)(
  "no row rests on a shared or unmeasured name fold",
  async () => {
    // ⚠️ PER (PERSON, COMPANY), NOT PER COMPANY. The first version passed the person array
    // and then never referenced it, so it asked „does ANY unique-folded person link to this
    // company" — which a second, properly-gated person at the same company satisfies while
    // the row under test rests on a shared fold. It catches the mutation by luck, not by
    // construction.
    const bad = await allRows<{ eik: string; ref: string }>(
      `SELECT x.eik, x.ref
         FROM unnest($1::text[], $2::text[]) AS x(eik, ref)
        WHERE NOT EXISTS (
          SELECT 1 FROM person_role pr
            JOIN person pe ON pe.person_id = pr.person_id
            JOIN tr_person_roles t
              ON t.uic = pr.ref AND t.name_fold = pe.name_fold
            JOIN tr_name_fold_people f
              ON f.name_fold = pe.name_fold AND f.people_n = 1
            JOIN person_role mp ON mp.person_id = pe.person_id AND mp.source = 'mp'
           WHERE pr.ref = x.eik AND pr.source IN ('tr','ngo')
             AND pr.confidence IN ('exact_id','high','manual')
             AND pe.status = 'active' AND pe.is_public_figure
             AND '/candidate/mp-' || split_part(mp.ref, ':', 1) = x.ref)
          AND NOT EXISTS (
          SELECT 1 FROM declaration_stake_company sc
            JOIN person_role mp ON mp.person_id = sc.person_id AND mp.source = 'mp'
           WHERE sc.uic = x.eik AND sc.holder_is_declarant
             AND '/candidate/mp-' || split_part(mp.ref, ':', 1) = x.ref)`,
      [rows.map((r) => r.eik), rows.map((r) => r.ref)],
    );
    assert.deepEqual(
      bad,
      [],
      "a (company, MP) row has no gated basis of its own — it rests on somebody else's link",
    );
  },
);

test.skipIf(skip)(
  "a withdrawn registry role is marked isCurrent:false",
  async () => {
    // 17 of the served rows rest SOLELY on erased tr_person_roles entries, and
    // relationLabel renders „(бивш)" off this flag. Without it a former partner publishes as
    // current. Both sides asserted: the flag must exist AND must not be constant.
    const withFlag = rows.filter((r) =>
      (r.relations ?? []).some((x) => x.isCurrent !== undefined),
    );
    assert.ok(withFlag.length > 0, "no relation carries isCurrent at all");
    const former = rows.filter((r) =>
      (r.relations ?? []).some((x) => x.isCurrent === false),
    );
    assert.ok(
      former.length > 0,
      "no relation is marked former — isCurrent has stopped discriminating, so a withdrawn " +
        "registry role now publishes as a current one",
    );
    // A DECLARED row carries no erasure date, so it must never claim currency either way.
    for (const r of rows)
      for (const rel of r.relations ?? [])
        if (rel.kind === "stake" || rel.kind === "declared_role")
          assert.equal(
            rel.isCurrent,
            undefined,
            `${r.eik}: a declared relation claims a currency no filing can support`,
          );
  },
);

test.skipIf(skip)("every emitted relation kind has a label", async () => {
  // relationLabel falls through to `rel.kind` when its KEY has no entry, so an unmapped kind
  // prints the raw ASCII token in BOTH languages — which is what 'role' did.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(
      "src/screens/components/candidates/procurement/relationLabel.ts",
      "utf8",
    ),
  );
  const kinds = new Set<string>();
  for (const r of rows)
    for (const rel of r.relations ?? []) if (rel.kind) kinds.add(rel.kind);
  assert.ok(
    kinds.size > 1,
    "only one relation kind emitted — the sample is too thin",
  );
  for (const k of kinds)
    assert.match(
      src,
      new RegExp(`\\b${k}:\\s*\\{`),
      `relationLabel has no entry for kind "${k}" — it will print the raw token`,
    );
});

test.skipIf(skip)(
  "a `stake` chip never carries a role label in shareSize",
  async () => {
    // 089: on a ROLE row share_size holds the ROLE ITSELF („ЧЛЕН НА СД"). Labelling every
    // declared row 'stake' published a board seat as a shareholding with the job title in the
    // size field — which is what the first cut of this query did.
    for (const r of rows)
      for (const rel of r.relations ?? [])
        if (rel.kind === "stake" && rel.shareSize)
          assert.ok(
            /[0-9]/.test(rel.shareSize),
            `${r.eik}: a stake chip carries a role label as its size: ${rel.shareSize}`,
          );
  },
);

test.skipIf(skip)(
  "a standing holding is not repeated once per filing",
  async () => {
    // 8,878 rows collapsed to 114 when the DISTINCT ON landed. A group with several 'stake'
    // entries means the per-(person, company) dedup has come undone.
    for (const r of rows) {
      const stakes = (r.relations ?? []).filter((x) => x.kind === "stake");
      assert.ok(
        stakes.length <= 1,
        `${r.eik} / ${r.politician}: ${stakes.length} stake chips — the DISTINCT ON is not deduping`,
      );
    }
  },
);

test.skipIf(skip)(
  "the headline role is deterministic across two runs",
  async () => {
    // array_agg without an ORDER BY returns scan order, which a REFRESH rewrites — so the
    // chip's leading label could change between two loads of identical data.
    const again = await allRows<Row>(MP_ARM_SQL);
    const key = (r: Row) => `${r.eik}|${r.ref}|${r.role}`;
    assert.deepEqual(
      rows.map(key).sort(),
      again.map(key).sort(),
      "the headline role is not stable between two runs of the same query",
    );
  },
);

test.skipIf(skip)(
  "the money is contract-tag money, not every row in the corpus",
  async () => {
    // amount_eur is already the post-annex current value, so counting amendments adds each
    // increase twice; every other consumer in the repo filters tag = 'contract'.
    // SORTED before slicing: `rows` comes back in scan order, so an unordered slice checks a
    // different 25 rows on every run — and only 14 of 114 EIKs have amendments at all, which
    // is the case this test exists for.
    const sample = [...rows]
      .sort((a, b) => a.eik.localeCompare(b.eik))
      .slice(0, 40);
    for (const r of sample) {
      const [want] = await allRows<{ eur: string }>(
        `SELECT round(COALESCE(sum(amount_eur) FILTER (WHERE tag = 'contract'), 0))::text AS eur
         FROM contracts WHERE contractor_eik = $1`,
        [r.eik],
      );
      assert.equal(
        r.total_eur,
        want.eur,
        `${r.eik}: total_eur is not the tag-filtered sum`,
      );
    }
  },
);

// ── the OFFICIAL arm ────────────────────────────────────────────────────────────────────
//
// ⚠️ THE TWO ARMS ARE ONE QUERY, PARAMETERISED BY WHO QUALIFIES. Everything that makes a row
// trustworthy is shared, so the invariants below are the mp arm's re-run against the other
// person predicate — and a divergence means someone forked the builder, which is exactly
// what this Tier is undoing.

test.skipIf(skip)(
  "the official arm is non-empty and one row per (person, company)",
  async () => {
    assert.ok(
      officialRows.length > 0,
      "the official arm produced no rows at all",
    );
    const seen = new Set(officialRows.map((r) => `${r.eik}|${r.ref}`));
    assert.equal(
      seen.size,
      officialRows.length,
      "an (official, company) pair repeats",
    );
    for (const r of officialRows)
      // ⚠️ THE SLUG CHARSET, not `[^/]+`. The loose form accepts spaces and Cyrillic, so it
      // was GREEN while the arm minted `/officials/Атанаска Ангелова Атанасова` — refs that
      // fail officials_person_slug() and render a live dead <Link>. Only sources whose
      // person_role.ref IS a Court-of-Audit slug belong here; magistrate stores a Cyrillic
      // full name and regulator a `seat:Name`, and adding either puts 9 dead links on the
      // company page. Mutation-checked by re-adding magistrate.
      assert.match(
        r.ref,
        /^\/officials\/[a-z0-9-]+$/,
        `ref is not an officials slug — it will 404: ${r.ref}`,
      );
  },
);

test.skipIf(skip)(
  "every person on the official arm holds an OFFICE",
  async () => {
    // ⚠️ NOT „is not an MP". That reading admitted 457 people holding no office at all — 288
    // election candidates and 176 local-roster rows — and 112 SUMS f_mp + f_pep into the fired
    // count, so they inflated the contract grade shift by 38%.
    const slugs = officialRows.map((r) => r.ref.replace("/officials/", ""));
    const [bad] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM unnest($1::text[]) AS s(slug)
      WHERE NOT EXISTS (
        SELECT 1 FROM person_role pr
         WHERE pr.ref = s.slug
           AND pr.source IN ('official_exec','official_muni','public_sector','president',
                             'mep','diplomat','regulator','magistrate'))`,
      [slugs],
    );
    assert.equal(bad.n, "0", "someone with no office reached the official arm");
  },
);

test.skipIf(skip)(
  "the official arm obeys the same rules as the mp arm",
  async () => {
    // Contract-restricted, deduped, correctly labelled — the shared builder's guarantees.
    const [noContracts] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM unnest($1::text[]) AS e(eik)
      WHERE NOT EXISTS (SELECT 1 FROM contracts c WHERE c.contractor_eik = e.eik)`,
      [officialRows.map((r) => r.eik)],
    );
    assert.equal(
      noContracts.n,
      "0",
      "a company with no contracts reached the contractor table",
    );
    for (const r of officialRows) {
      const stakes = (r.relations ?? []).filter((x) => x.kind === "stake");
      assert.ok(
        stakes.length <= 1,
        `${r.eik}: ${stakes.length} stake chips — dedup is undone`,
      );
      for (const rel of r.relations ?? []) {
        if (rel.kind === "stake" && rel.shareSize)
          assert.ok(
            /[0-9]/.test(rel.shareSize),
            `${r.eik}: a stake chip carries a role label: ${rel.shareSize}`,
          );
        if (rel.kind === "stake" || rel.kind === "declared_role")
          assert.equal(
            rel.isCurrent,
            undefined,
            `${r.eik}: a filing claims currency`,
          );
      }
    }
    // isCurrent must still discriminate on this arm too.
    assert.ok(
      officialRows.some((r) =>
        (r.relations ?? []).some((x) => x.isCurrent === false),
      ),
      "no official relation is marked former — a withdrawn registry role publishes as current",
    );
  },
);

test.skipIf(skip)(
  "the two arms cover different people, not the same set twice",
  async () => {
    // They legitimately OVERLAP on companies (an ex-minister now in the chamber), but if one
    // arm were a subset of the other the split would be carrying no information and 112 would
    // be double-counting one link as two fired flags.
    const mpEiks = new Set(rows.map((r) => r.eik));
    const offEiks = new Set(officialRows.map((r) => r.eik));
    assert.ok(mpEiks.size > 0 && offEiks.size > 0);
    const onlyMp = [...mpEiks].filter((e) => !offEiks.has(e));
    const onlyOff = [...offEiks].filter((e) => !mpEiks.has(e));
    assert.ok(
      onlyMp.length > 0,
      "every mp company is also an official company",
    );
    assert.ok(
      onlyOff.length > 0,
      "every official company is also an mp company",
    );
  },
);

test.skipIf(skip)(
  "one person's one link never fires BOTH risk flags unboundedly",
  async () => {
    // ⚠️ 112 SUMS f_mp + f_pep into the fired count that becomes the A-F grade, so a person
    // who is both an MP and an office-holder AT THE SAME COMPANY has one relationship counted
    // as two risk signals. Pre-existing — the retired artifacts overlapped the same way — so
    // this BOUNDS it rather than fixing it, which is what stops the re-base growing it
    // silently. The sibling test above asserts the arms cover different COMPANIES, which is
    // nearly tautological at 411 vs 106; this is the assertion that comment was about.
    const byPair = new Map<string, Set<string>>();
    for (const [arm, list] of [
      ["mp", rows],
      ["official", officialRows],
    ] as const)
      for (const r of list) {
        const k = `${r.eik}|${r.politician}`;
        if (!byPair.has(k)) byPair.set(k, new Set());
        byPair.get(k)!.add(arm);
      }
    const both = [...byPair.values()].filter((v) => v.size === 2).length;
    assert.ok(
      both <= 60,
      `${both} (person, company) pairs fire BOTH f_mp and f_pep — one relationship counted ` +
        "as two risk signals. Was 42 when measured; a jump means an arm has widened.",
    );
  },
);

test.skipIf(skip)(
  "both arms carry a real person_id, not just a URL string",
  async () => {
    // ⚠️ Tier 4c. `ref` is an app ROUTE, and five sites in load_graph_pg plus 112's LIKE used
    // to recover a person from it by regex — a bridge that breaks on a roster re-slug and
    // silently drops that person's edges. person_id is the identity those regexes approximated.
    //
    // Asserted on the QUERY, not on the stored table: the column is new, so every existing row
    // is NULL until the next db:load:tr:pg, and a test reading the table would fail for the
    // wrong reason on a database nobody has reloaded yet.
    for (const [arm, list] of [
      ["mp", rows],
      ["official", officialRows],
    ] as const) {
      assert.ok(list.length > 0, `${arm} arm is empty`);
      for (const r of list)
        assert.ok(
          r.person_id !== null && r.person_id !== undefined,
          `${arm}: ${r.eik} / ${r.politician} carries no person_id`,
        );
    }
    // And it must be a REAL person, not a number that happens to parse.
    const ids = [...rows, ...officialRows].map((r) => String(r.person_id));
    const [bad] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM unnest($1::bigint[]) AS x(id)
      WHERE NOT EXISTS (SELECT 1 FROM person p
                         WHERE p.person_id = x.id
                           AND p.status = 'active' AND p.is_public_figure)`,
      [ids],
    );
    assert.equal(
      bad.n,
      "0",
      "a person_id does not resolve to an active public figure",
    );
  },
);

test.skipIf(skip)(
  "the ref and the person_id name the SAME person",
  async () => {
    // They coexist — ref is still the href the company page renders — so they must agree.
    // A divergence would put one person's name on another's link.
    const mismatched: string[] = [];
    for (const r of officialRows) {
      const slug = r.ref.replace("/officials/", "");
      const [ok] = await allRows<{ n: string }>(
        `SELECT count(*) n FROM person_role pr
        WHERE pr.ref = $1 AND pr.person_id = $2`,
        [slug, r.person_id],
      );
      if (ok.n === "0") mismatched.push(`${r.ref} vs person_id ${r.person_id}`);
    }
    // ⚠️ THE MP ARM TOO — it was the untested half, it carries the extra
    // `min(m.mp_id::bigint)` pick, and it is the one 031/033/077/122 all key on. A person
    // holding two mp_ids whose min lands on the other person's id is what this catches.
    for (const r of rows) {
      const id = r.ref.replace("/candidate/mp-", "");
      const [ok] = await allRows<{ n: string }>(
        `SELECT count(*) n FROM person_role pr
          WHERE pr.source = 'mp' AND split_part(pr.ref, ':', 1) = $1
            AND pr.person_id = $2`,
        [id, r.person_id],
      );
      if (ok.n === "0") mismatched.push(`${r.ref} vs person_id ${r.person_id}`);
    }
    assert.deepEqual(
      mismatched.slice(0, 5),
      [],
      "ref and person_id name different people",
    );
  },
);
