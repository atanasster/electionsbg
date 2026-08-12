// Correctness gate for declared stakes → public contracts (096).
//
// This surface publishes "this named official's company holds public contracts" off a
// declaration form THAT CARRIES NO EIK, so every link is inferred. A wrong inference is a
// fabricated conflict of interest attached to a real person's name.
//
// TESTING DISCIPLINE — read before adding a case here.
//
// The first version of this file passed every test while four critical defects were live,
// because each test was written IN TERMS OF THE PIPELINE'S OWN EXPRESSIONS: the gate-B test
// re-ran the matview's own EXISTS clause against the matview's own output; the gate-A test
// called declared_company_norm() to check declared_company_norm()'s result, which made it
// structurally incapable of noticing that the function truncated "БОКАД" to "БОК" and
// resolved a declarant to an unrelated company. That is the same trap the reverted T3.7 work
// fell into (see its note in docs/plans/persons-declarations-audit-v1.md) — there by
// re-implementing the arithmetic, here by re-implementing the filter.
//
// So the rule for this file: EXPECTATIONS ARE COMPUTED INDEPENDENTLY, in TypeScript, from
// raw table rows — never by re-running the SQL under test. A test that calls
// declared_company_norm, or repeats the matview's WHERE clause, is not a test.
//
// Auto-skips when Postgres is down or the stakes are not loaded.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_stake_company') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_stake_company",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / no resolved stakes";

afterAll(async () => {
  await end();
});

// An INDEPENDENT normaliser. Deliberately NOT a port of declared_company_norm's regex: it
// tokenises on whitespace and drops a legal form only when it is a WHOLE trailing token,
// which is the property the SQL is supposed to have. If the SQL ever again strips letters
// off the end of a real word, the two disagree and the tests below fail.
const LEGAL_FORMS = new Set([
  "ЕООД",
  "ООД",
  "ЕАД",
  "АД",
  "АДСИЦ",
  "ЕТ",
  "КД",
  "КДА",
  "СД",
  "ДЗЗД",
]);

const normIndependently = (raw: string): string => {
  const words = raw
    .replace(/[„“”"'`.,]/g, " ")
    .toUpperCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  // Strip at most ONE trailing form: the SQL pattern is $-anchored, so it can match only
  // once. Popping repeatedly here would make the oracle disagree with a correct
  // implementation on the rare "X ООД ЕООД".
  //
  // A name that is NOTHING BUT a legal form ("АД", "СД" — 5 such rows exist) reduces to the
  // empty string, matching the SQL's NULL. That is the wanted behaviour: a bare legal form
  // is not a usable match key and must never resolve anything.
  if (words.length >= 1 && LEGAL_FORMS.has(words[words.length - 1]))
    words.pop();
  return words.join(" ");
};

// THE NORMALISER ITSELF, against the independent oracle over real registry names.
//
// This test exists because the output-level gate-A test below CANNOT catch a broken
// normaliser: when the regex truncates "БОКАД" to "БОК", gates B and C happen to reject the
// resulting false match, so nothing wrong reaches the matview and every downstream assertion
// still passes. Verified by mutation — reintroducing the original `\s*` regex leaves all
// output-level tests green. The defect is only visible by interrogating the function.
test.skipIf(skip)(
  "declared_company_norm strips only whole trailing legal-form tokens",
  async () => {
    // Every registry name that ends in the LETTERS of a legal form — the exact population
    // the anchor bug mangles — plus a broad sample for general agreement.
    //
    // The targeted arm is taken WHOLE (9,268 rows) rather than sharing a LIMIT with the broad
    // one. It used to: `(regex OR uic LIKE '1%') ORDER BY uic LIMIT 40000` sorts the low EIKs
    // to the front, so only 525 of those 9,268 survived the cut and just 41 of them came from
    // the regex arm — 94% of the population this test exists for went unsampled, and the
    // ORDER BY added to fix the flakiness is what caused it. The mutation was still caught,
    // on a twentieth of the margin the comment claimed.
    const rows = await allRows<{ name: string; sql: string | null }>(`
      (SELECT name, declared_company_norm(name) AS sql
         FROM tr_companies
        WHERE entity_class = 'company' AND name ~ '(АД|ОД|ЕТ|КД|СД)$')
      UNION ALL
      (SELECT name, declared_company_norm(name)
         FROM tr_companies
        WHERE entity_class = 'company' AND uic LIKE '1%'
        -- ORDER BY, so the broad arm is the SAME 40k rows every run. A bare LIMIT let the
        -- planner return different rows each time, which made this gate flaky.
        ORDER BY uic
        LIMIT 40000)
    `);
    // Floored against the targeted arm alone, so a future truncation of it fails loudly
    // rather than silently shrinking the sample back to a rounding error.
    assert.ok(rows.length > 9000, "sample too small to be meaningful");
    const disagree = rows.filter((r) => {
      const oracle = normIndependently(r.name);
      const got = r.sql ?? "";
      return oracle !== got;
    });
    assert.deepEqual(
      disagree
        .slice(0, 15)
        .map(
          (d) =>
            `"${d.name}" => SQL "${d.sql}" vs "${normIndependently(d.name)}"`,
        ),
      [],
      `${disagree.length} registry names normalise differently than a whole-token strip`,
    );
  },
);

// GATE A. Every resolved pair must agree on the name once whole-token legal forms come off.
// This is the test that would have caught "БОК ООД" → БОКАД and "Травъл План ООД" →
// ТРАВЪЛ ПЛАНЕТ, both of which the expression-level version passed.
test.skipIf(skip)(
  "every resolved company actually bears the declared name",
  async () => {
    const rows = await allRows<{
      declared: string;
      registry: string;
      uic: string;
    }>(`
      SELECT DISTINCT sc.company_name AS declared, c.name AS registry, sc.uic
        FROM declaration_stake_company sc
        JOIN tr_companies c ON c.uic = sc.uic
    `);
    assert.ok(rows.length > 0, "no resolved companies — fixture is empty");
    const mismatched = rows.filter(
      (r) => normIndependently(r.declared) !== normIndependently(r.registry),
    );
    assert.deepEqual(
      mismatched.map((m) => `"${m.declared}" => "${m.registry}" (${m.uic})`),
      [],
      "a declared name resolved to a company that does not bear that name",
    );
  },
);

// Every published row, with the two names the gates turn on: the declarant's fold, and the
// fold of whoever the FILING says holds the stake. `translit_bg_latin` is the repo-wide name
// fold — the same one person.name_fold is built with — so reading it here is reading an
// input, not re-running a gate. Everything the gates actually decide (which companies are
// candidates, which are confirmed, whether one survives) is recomputed in TypeScript below.
type Published = {
  declaration_id: string;
  seq: number;
  slug: string;
  uic: string;
  company_name: string;
  share_size: string | null;
  stake_kind: string | null;
  item_type: string | null;
  stake_year: number;
  holder_name: string | null;
  holder_is_declarant: boolean;
  name_fold: string;
  holder_fold: string | null;
};

const published = haveDb
  ? await allRows<Published>(`
      SELECT sc.declaration_id::text, sc.seq, p.slug, sc.uic, sc.company_name,
             sc.share_size, sc.stake_kind, sc.item_type, sc.stake_year,
             sc.holder_name, sc.holder_is_declarant, p.name_fold,
             translit_bg_latin(sc.holder_name) AS holder_fold
        FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
    `)
  : [];

const confirmFoldOf = (r: Published): string =>
  r.holder_name == null ? r.name_fold : (r.holder_fold ?? "");

// GATE A′ + GATE B + UNIQUENESS, recomputed end to end.
//
// Gate A used to require the declared name to identify ONE trading company outright, and this
// test asserted exactly that. It no longer does: a name borne by two companies is now allowed
// through when the registry itself settles which — the declared holder is an owner or officer
// at one of them and not the other. So the property to hold is no longer "ambiguous names are
// dropped" but the stronger, harder one: THE PUBLISHED EIK IS THE ONLY CANDIDATE THE HOLDER'S
// OWN REGISTRY FOOTPRINT ADMITS. A name still ambiguous after the footprint speaks must be
// dropped, not resolved to a first match.
test.skipIf(skip)(
  "each published EIK is the only candidate the declared holder is registered at",
  async () => {
    assert.ok(published.length > 0, "nothing published — fixture is empty");

    const registry = await allRows<{ uic: string; name: string }>(
      "SELECT uic, name FROM tr_companies WHERE entity_class = 'company'",
    );
    const byNorm = new Map<string, string[]>();
    for (const c of registry) {
      const k = normIndependently(c.name);
      if (!k) continue;
      const at = byNorm.get(k);
      if (at) at.push(c.uic);
      else byNorm.set(k, [c.uic]);
    }

    // The footprint, raw: every owner/officer record whose folded name is one the published
    // rows confirm on. Two tables because the register records the two roles separately.
    const folds = [...new Set(published.map(confirmFoldOf))].filter(Boolean);
    const foot = await allRows<{ uic: string; name_fold: string }>(
      `SELECT uic, name_fold FROM tr_person_roles WHERE name_fold = ANY($1)
       UNION
       SELECT uic, name_fold FROM tr_officers     WHERE name_fold = ANY($1)`,
      [folds],
    );
    const atCompany = new Set(foot.map((f) => `${f.name_fold} ${f.uic}`));

    const bad: string[] = [];
    for (const r of published) {
      const fold = confirmFoldOf(r);
      const candidates = byNorm.get(normIndependently(r.company_name)) ?? [];
      const confirmed = candidates.filter((u) => atCompany.has(`${fold} ${u}`));
      const where = `${r.slug} "${r.company_name}" => ${r.uic}`;
      if (!candidates.includes(r.uic))
        bad.push(`${where}: resolved EIK does not bear the declared name`);
      else if (confirmed.length === 0)
        bad.push(`${where}: "${fold}" is registered at none of the candidates`);
      else if (confirmed.length > 1)
        bad.push(
          `${where}: still ambiguous after the footprint (${confirmed.join(", ")}) — must be dropped`,
        );
      else if (confirmed[0] !== r.uic)
        bad.push(`${where}: the footprint singles out ${confirmed[0]} instead`);
    }
    assert.deepEqual(bad.slice(0, 15), [], `${bad.length} bad resolution(s)`);
  },
);

// A stake row names ONE company, so it may resolve to at most one EIK. The matview's PK is
// (declaration_id, seq, uic), which permits two rows per stake — that is the shape a
// widened gate A produces if the uniqueness requirement is ever dropped rather than moved,
// and it would render one declared holding as two companies on the profile.
test.skipIf(skip)("no stake row resolves to more than one EIK", async () => {
  const seen = new Map<string, Set<string>>();
  for (const r of published) {
    const k = `${r.declaration_id}#${r.seq}`;
    const at = seen.get(k);
    if (at) at.add(r.uic);
    else seen.set(k, new Set([r.uic]));
  }
  const multi = [...seen.entries()].filter(([, u]) => u.size > 1);
  assert.deepEqual(
    multi.map(([k, u]) => `${k} => ${[...u].join(", ")}`),
    [],
    "a single declared stake was resolved to several companies",
  );
});

// GATE C, on the person the name match actually places.
//
// It used to be asserted of the DECLARANT, which was right while every row was confirmed
// through the declarant. Now a family row is confirmed through its holder, so the declarant's
// own namesake risk is beside the point for it: the declarant's identity comes from the
// declaration, not from a name match into the registry. What must hold is that the CONFIRMING
// name belongs to exactly one active person.
//
// `= 1`, never `<= 1`. Zero means the person layer holds nobody by that name, which is not
// evidence the name is unique — `person` is not a census. 624 candidate rows sit at zero.
test.skipIf(skip)(
  "every published row's confirming name identifies exactly one active person",
  async () => {
    const counts = await allRows<{ fold: string; n: string }>(
      `SELECT name_fold AS fold, count(*) n FROM person
        WHERE status = 'active' AND name_fold = ANY($1) GROUP BY 1`,
      [[...new Set(published.map(confirmFoldOf))].filter(Boolean)],
    );
    const byFold = new Map(counts.map((c) => [c.fold, Number(c.n)]));
    const risky = published.filter(
      (r) => (byFold.get(confirmFoldOf(r)) ?? 0) !== 1,
    );
    assert.deepEqual(
      [
        ...new Set(
          risky.map(
            (r) =>
              `${r.slug}/${r.uic}: "${confirmFoldOf(r)}" matches ${byFold.get(confirmFoldOf(r)) ?? 0} active person(s)`,
          ),
        ),
      ].slice(0, 15),
      [],
      "gate C is not holding on the confirming person",
    );
  },
);

// The own arm, stated separately. On an own row the confirming name IS the declarant's, so
// this is subsumed by the test above and is deliberately no stronger than it — the point is
// that a future widening of gate C (a second identity source, say) cannot quietly relax the
// arm carrying the declarant's own money without a second gate going red.
test.skipIf(skip)(
  "no OWN-arm row belongs to a namesake-ambiguous declarant",
  async () => {
    const counts = await allRows<{ fold: string; n: string }>(
      `SELECT name_fold AS fold, count(*) n FROM person
      WHERE status = 'active' AND name_fold = ANY($1) GROUP BY 1`,
      [[...new Set(published.map((r) => r.name_fold))]],
    );
    const byFold = new Map(counts.map((c) => [c.fold, Number(c.n)]));
    const risky = published.filter(
      (r) => r.holder_is_declarant && (byFold.get(r.name_fold) ?? 0) !== 1,
    );
    assert.deepEqual(
      [...new Set(risky.map((r) => `${r.slug} ("${r.name_fold}")`))],
      [],
      "a namesake-ambiguous declarant was published on their own arm",
    );
  },
);

// THE ATTRIBUTION RULE, which is the whole reason the family arm carries a flag rather than
// simply joining the rest. A spouse's company is not the filer's holding: it may be shown,
// attributed to its holder, and it must not enter any money figure computed for the filer.
//
// Non-emptiness is asserted first and is not padding — the two checks below are both
// vacuously true of an empty family arm, so without it a regression that silently stopped
// resolving family rows would leave this file green.
test.skipIf(skip)(
  "family holdings are published but never counted as the person's",
  async () => {
    const family = published.filter((r) => !r.holder_is_declarant);
    assert.ok(
      family.length > 0,
      "no family-held stake resolved at all — the holder arm has stopped working",
    );
    assert.deepEqual(
      family.filter((r) => r.holder_name == null).map((r) => r.slug),
      [],
      "a row with no declared holder was flagged as somebody else's",
    );

    // What the serving function publishes as the PERSON's public money, against the arm the
    // matview says each EIK came from.
    const served = await allRows<{ slug: string; eik: string }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
    )
    SELECT t.slug, e ->> 'eik' AS eik
      FROM target t
      CROSS JOIN LATERAL jsonb_array_elements(person_stake_procurement(t.slug)) e
  `);
    const own = new Set(
      published
        .filter((r) => r.holder_is_declarant)
        .map((r) => `${r.slug} ${r.uic}`),
    );
    const leaked = served.filter((s) => !own.has(`${s.slug} ${s.eik}`));
    assert.deepEqual(
      leaked.map((l) => `${l.slug}/${l.eik}`),
      [],
      "a company the filing attributes to someone else was counted as the person's public money",
    );
  },
);

// THE COLLAPSE, recomputed independently — one row per (person, company) out of many filings.
//
// This is the test the byte-stability one below CANNOT be: both of its calls read the same
// heap in the same order, so they agree by construction whatever the sort key is. The
// property that matters is that the published row does not depend on physical row order, and
// the only way to check it is to derive the winner from raw rows under the documented rule.
//
// It exists because the key was NOT a total order: `(stake_year, declaration_id)` left 332
// own-arm groups tied — one filing listing a company twice, as a share row and a role row —
// and 168 of them disagreed on a collapsed field. Measured on the rows actually served, 8 of
// 70 flipped `stakeKind` and 7 flipped `shareSize` between the two possible tiebreaks. A
// board seat published as a shareholding, under a conflict-of-interest heading, differently
// after each REFRESH of identical data.
//
// The rule, from 096: latest year, then latest filing, then prefer the SHARE row where one
// filing declares both, then lowest seq. `firstYear`/`lastYear` come from the same own-arm
// rows — asserted here because both money tests take the span AS GIVEN and only recompute the
// contract arithmetic over it, so a regression that widened the span to include family years
// would leave every other assertion in this file green.
test.skipIf(skip)(
  "each served row is the latest own declaration for that company",
  async () => {
    const served = await allRows<{
      slug: string;
      eik: string;
      declared_name: string | null;
      share_size: string | null;
      stake_kind: string | null;
      item_type: string | null;
      first_year: string;
      last_year: string;
    }>(`
      WITH target AS MATERIALIZED (
        SELECT DISTINCT p.slug FROM declaration_stake_company sc
          JOIN person p ON p.person_id = sc.person_id
      )
      SELECT t.slug,
             e ->> 'eik'          AS eik,
             e ->> 'declaredName' AS declared_name,
             e ->> 'shareSize'    AS share_size,
             e ->> 'stakeKind'    AS stake_kind,
             e ->> 'itemType'     AS item_type,
             e ->> 'firstYear'    AS first_year,
             e ->> 'lastYear'     AS last_year
        FROM target t
        CROSS JOIN LATERAL jsonb_array_elements(person_stake_procurement(t.slug)) e
    `);
    assert.ok(served.length > 0, "nothing served — fixture is empty");

    const own = new Map<string, Published[]>();
    for (const r of published) {
      if (!r.holder_is_declarant) continue;
      const k = `${r.slug} ${r.uic}`;
      const at = own.get(k);
      if (at) at.push(r);
      else own.set(k, [r]);
    }

    // 096's ORDER BY, written out. Negative = a sorts first.
    const rank = (a: Published, b: Published): number =>
      b.stake_year - a.stake_year ||
      Number(b.declaration_id) - Number(a.declaration_id) ||
      Number(b.stake_kind === "share") - Number(a.stake_kind === "share") ||
      a.seq - b.seq;

    const bad: string[] = [];
    for (const s of served) {
      const rows = own.get(`${s.slug} ${s.eik}`) ?? [];
      if (rows.length === 0) {
        bad.push(`${s.slug}/${s.eik}: served with no own-arm row behind it`);
        continue;
      }
      // The key must decide, not the scan: no two rows may tie on all of it.
      const ties = rows.filter((r) =>
        rows.some((o) => o !== r && rank(r, o) === 0),
      );
      if (ties.length > 0) {
        bad.push(
          `${s.slug}/${s.eik}: ${ties.length} rows tie on the whole sort key — the pick is scan order`,
        );
        continue;
      }
      const win = [...rows].sort(rank)[0];
      const years = rows.map((r) => r.stake_year);
      const at = `${s.slug}/${s.eik}`;
      if (s.declared_name !== win.company_name)
        bad.push(
          `${at}: declaredName ${s.declared_name} !== ${win.company_name}`,
        );
      if (s.share_size !== win.share_size)
        bad.push(`${at}: shareSize ${s.share_size} !== ${win.share_size}`);
      if (s.stake_kind !== win.stake_kind)
        bad.push(`${at}: stakeKind ${s.stake_kind} !== ${win.stake_kind}`);
      if (s.item_type !== win.item_type)
        bad.push(`${at}: itemType ${s.item_type} !== ${win.item_type}`);
      if (Number(s.first_year) !== Math.min(...years))
        bad.push(`${at}: firstYear ${s.first_year} !== ${Math.min(...years)}`);
      if (Number(s.last_year) !== Math.max(...years))
        bad.push(`${at}: lastYear ${s.last_year} !== ${Math.max(...years)}`);
    }
    assert.deepEqual(
      bad.slice(0, 15),
      [],
      `${bad.length} served row(s) disagree`,
    );
  },
);

// THE REMAINDER'S REASONS (096 person_declared_stake_status, T4b).
//
// This payload explains a REFUSAL — why 84% of declared stakes are not linked — so its failure
// mode is not an empty list, it is a reason that reads as weaker or stronger than the truth.
// Several of them are one word apart and mean different things about a NAMED company or a
// named person: `absent` says no company of that name is registered, `unconfirmed` says one is
// and the register does not place the declared holder in it, `namesake` says it places someone
// of that name and the name is shared, `unverified` says it places someone of that name and we
// hold nobody by it. Publishing any of these as another is a false statement about the world.
//
// Recomputed here from raw `tr_companies`, `tr_person_roles`, `tr_officers` and `person` rows
// through the file's own independent normaliser, never by re-running the function's own CASE.
test.skipIf(skip)(
  "every unlinked stake carries the reason the register actually supports",
  async () => {
    // The sample must include the FAMILY arm: `linked` exists for it, and a person whose only
    // resolutions are family rows (mp-2647 is exactly that) is invisible to an own-arm-only
    // sample. Drawn from `published` unfiltered for that reason.
    const slugs = [...new Set(published.map((r) => r.slug))]
      .sort()
      .slice(0, 60);
    assert.ok(slugs.length > 10, "sample too small to be meaningful");

    const rows = await allRows<{
      slug: string;
      declared_name: string;
      holder_name: string | null;
      reason: string;
      eik: string | null;
      candidates: { eik: string; name: string | null }[];
    }>(
      `SELECT s AS slug, e ->> 'declaredName' AS declared_name,
              e ->> 'holderName' AS holder_name, e ->> 'reason' AS reason,
              e ->> 'eik' AS eik, e -> 'candidates' AS candidates
         FROM unnest($1::text[]) s
         CROSS JOIN LATERAL jsonb_array_elements(person_declared_stake_status(s)) e`,
      [slugs],
    );
    assert.ok(rows.length > 0, "no declared stakes for the sampled people");

    // No bucket may be empty. Without this, a CASE that collapsed two reasons into one would
    // leave every per-row assertion below satisfied — the reason it exists is that the first
    // cut of this test asserted `unconfirmed` and `namesake` IDENTICALLY, so rewriting the
    // CASE to emit only one of them stayed green.
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
    for (const reason of ["linked", "absent", "unconfirmed", "ambiguous"])
      assert.ok(
        (counts.get(reason) ?? 0) > 0,
        `no "${reason}" row in a ${rows.length}-row sample — the bucket collapsed`,
      );

    const registry = await allRows<{ uic: string; name: string }>(
      "SELECT uic, name FROM tr_companies WHERE entity_class = 'company'",
    );
    const byNorm = new Map<string, string[]>();
    for (const c of registry) {
      const k = normIndependently(c.name);
      if (!k) continue;
      const at = byNorm.get(k);
      if (at) at.push(c.uic);
      else byNorm.set(k, [c.uic]);
    }

    // The confirming fold per (slug, declared name, holder) — the SAME triple the function
    // groups on. Keyed on the name alone, this oracle collapses exactly where the pipeline
    // used to, and the 192 rows that published a refusal as a link passed it.
    const foldOf = new Map<string, string>();
    const stakes = await allRows<{
      slug: string;
      company_name: string;
      holder_name: string | null;
      fold: string;
    }>(
      `SELECT p.slug, s.company_name, s.holder_name,
              CASE WHEN s.holder_name IS NULL THEN p.name_fold
                   ELSE translit_bg_latin(s.holder_name) END AS fold
         FROM declaration_stake s
         JOIN declaration d ON d.declaration_id = s.declaration_id
         JOIN person p ON p.person_id = d.person_id
        WHERE p.slug = ANY($1) AND s.company_name IS NOT NULL`,
      [slugs],
    );
    const key = (slug: string, name: string, holder: string | null): string =>
      `${slug} ${normIndependently(name)} ${normIndependently(holder ?? "")}`;
    for (const r of stakes)
      foldOf.set(key(r.slug, r.company_name, r.holder_name), r.fold);

    // The raw footprint and the raw person counts — the two inputs gates B and C turn on.
    const folds = [...new Set(foldOf.values())];
    const foot = await allRows<{ uic: string; name_fold: string }>(
      `SELECT uic, name_fold FROM tr_person_roles WHERE name_fold = ANY($1)
       UNION
       SELECT uic, name_fold FROM tr_officers     WHERE name_fold = ANY($1)`,
      [folds],
    );
    const atCompany = new Set(foot.map((f) => `${f.name_fold} ${f.uic}`));
    const nPerson = new Map(
      (
        await allRows<{ fold: string; n: string }>(
          `SELECT name_fold AS fold, count(*) n FROM person
            WHERE status = 'active' AND name_fold = ANY($1) GROUP BY 1`,
          [folds],
        )
      ).map((c) => [c.fold, Number(c.n)]),
    );

    // What the matview resolved, per (person, name, HOLDER) — never per (person, name).
    const linkedTo = new Map<string, string>();
    for (const r of published)
      linkedTo.set(key(r.slug, r.company_name, r.holder_name), r.uic);

    const bad: string[] = [];
    for (const r of rows) {
      const k = key(r.slug, r.declared_name, r.holder_name);
      const at = `${r.slug} "${r.declared_name}" / ${r.holder_name ?? "self"}`;
      const cands = byNorm.get(normIndependently(r.declared_name)) ?? [];
      const resolved = linkedTo.get(k);
      const fold = foldOf.get(k);
      const hasFootprint = cands.some((u) => atCompany.has(`${fold} ${u}`));

      // `linked` must mean the matview resolved THIS holder's claim, and nothing else may
      // carry an EIK. This is the pair that catches a refusal published as a link.
      if (resolved != null && r.reason !== "linked")
        bad.push(`${at}: resolved to ${resolved} but reported "${r.reason}"`);
      if (r.reason === "linked" && resolved == null)
        bad.push(`${at}: reported linked with no matview row for this holder`);
      if ((r.eik != null) !== (r.reason === "linked"))
        bad.push(`${at}: eik ${r.eik} against reason "${r.reason}"`);
      if (r.reason === "linked" && r.eik !== resolved)
        bad.push(`${at}: linked to ${r.eik}, matview says ${resolved}`);

      // The claims about the register, checked against the register.
      if (r.reason === "absent" && cands.length > 0)
        bad.push(
          `${at}: "absent" but ${cands.length} compan(ies) bear the name`,
        );
      if (r.reason === "ambiguous" && cands.length < 2)
        bad.push(`${at}: "ambiguous" but only ${cands.length} candidate(s)`);
      if (["unconfirmed", "namesake", "unverified"].includes(r.reason)) {
        if (cands.length !== 1)
          bad.push(
            `${at}: "${r.reason}" but ${cands.length} candidates, expected 1`,
          );
        // The property that separates the three, recomputed rather than restated.
        if (r.reason === "unconfirmed" && hasFootprint)
          bad.push(
            `${at}: "unconfirmed" but "${fold}" IS in the register there`,
          );
        if (r.reason !== "unconfirmed" && !hasFootprint)
          bad.push(
            `${at}: "${r.reason}" with no registry footprint for "${fold}"`,
          );
        const n = nPerson.get(fold ?? "") ?? 0;
        if (r.reason === "namesake" && n < 2)
          bad.push(
            `${at}: "namesake" but "${fold}" matches ${n} active person(s)`,
          );
        if (r.reason === "unverified" && n > 1)
          bad.push(
            `${at}: "unverified" but "${fold}" matches ${n} — that is a namesake`,
          );
      }

      // Candidates are named ONLY where naming them all is the honest move. Anywhere else an
      // EIK beside a person's name is the assertion the gates declined to make.
      const named = r.candidates.map((c) => c.eik);
      if (r.reason !== "ambiguous" && named.length > 0)
        bad.push(
          `${at}: "${r.reason}" named ${named.join(", ")} — only ambiguous may`,
        );
      if (r.reason === "ambiguous") {
        const wrong = named.filter((e) => !cands.includes(e));
        if (named.length !== cands.length || wrong.length > 0)
          bad.push(
            `${at}: candidates ${named.join(", ")} against register ${cands.join(", ")}`,
          );
      }
    }
    assert.deepEqual(bad.slice(0, 15), [], `${bad.length} wrong reason(s)`);
  },
);

// One declared name resolves to at most one EIK PER HOLDER. The per-row gate above is a
// different property, and this is the one `byname`'s min(sc.uic) rests on — possible to
// violate in principle (two family holders of one declared name, each confirmed at a
// different company), so it is asserted rather than assumed.
test.skipIf(skip)(
  "one declared name resolves to at most one EIK per holder",
  async () => {
    const seen = new Map<string, Set<string>>();
    for (const r of published) {
      const k = `${r.slug} ${normIndependently(r.company_name)} ${normIndependently(r.holder_name ?? "")}`;
      const at = seen.get(k);
      if (at) at.add(r.uic);
      else seen.set(k, new Set([r.uic]));
    }
    assert.deepEqual(
      [...seen.entries()]
        .filter(([, u]) => u.size > 1)
        .map(([k, u]) => `${k} => ${[...u].join(", ")}`),
      [],
      "one holder's claim on one declared name resolved to several companies",
    );
  },
);

// One verdict per declared name AND HOLDER, not per filing. A person who declared the same
// company for eight years has one unresolved company, and eight identical rows saying so would
// read as eight separate problems — but their SPOUSE's claim on the same company is a
// different question with a different answer, so it keeps its own row.
test.skipIf(skip)(
  "the reasons are deduplicated by declared name and holder",
  async () => {
    const rows = await allRows<{
      slug: string;
      declared_name: string;
      holder_name: string | null;
    }>(
      `SELECT s AS slug, e ->> 'declaredName' AS declared_name,
            e ->> 'holderName' AS holder_name
       FROM unnest($1::text[]) s
       CROSS JOIN LATERAL jsonb_array_elements(person_declared_stake_status(s)) e`,
      [[...new Set(published.map((r) => r.slug))].sort().slice(0, 40)],
    );
    assert.ok(rows.length > 0, "no verdicts for the sampled people");
    const seen = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.slug} ${normIndependently(r.declared_name)} ${normIndependently(r.holder_name ?? "")}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    assert.deepEqual(
      [...seen.entries()]
        .filter(([, n]) => n > 1)
        .map(([k, n]) => `${k} x${n}`),
      [],
      "one holder's claim on one declared company was reported more than once",
    );
    // The client keys on exactly this pair, so a duplicate would silently drop a verdict —
    // and a key that collapsed two holders would hand one of them the other's answer, which is
    // the defect the per-holder grouping exists to prevent. Verified non-vacuous: the sample
    // does contain names carrying more than one holder.
    const perName = new Map<string, Set<string>>();
    for (const r of rows) {
      const k = `${r.slug} ${normIndependently(r.declared_name)}`;
      const at = perName.get(k) ?? new Set<string>();
      at.add(normIndependently(r.holder_name ?? ""));
      perName.set(k, at);
    }
    assert.ok(
      [...perName.values()].some((h) => h.size > 1),
      "no declared company in the sample has two holders — this gate proves nothing",
    );
  },
);

// FIXTURE: Сергей Станишев, the profile this arm was built for (person-page-completeness-v1
// T4a). Both of his own-filed stakes must stay unlinked, for two different reasons — which is
// what makes the pair worth pinning:
//
//   • „Призма Къмпани ЕООД" is declared with NO holder, so it is his own, and no company of
//     that name has him in its registry footprint. Gate B drops it. This is the false-
//     attribution case: the block's premise is "the registry confirms this", and it does not.
//   • „Актив груп ЕООД" is held by Моника Любомирова Станишева, who is an officer at 14
//     companies and ABSENT FROM `person` entirely. Gate C's `= 1` therefore drops it. It is
//     the case that motivated the family arm, and it is not recoverable without an identity
//     source the person layer does not have; see 096's header.
test.skipIf(skip)(
  "the Stanishev filing publishes neither of its unconfirmed stakes",
  async () => {
    const his = published.filter((r) => r.slug === "mp-868");
    assert.deepEqual(
      his.map((r) => `${r.company_name} => ${r.uic}`),
      [],
      "a Stanishev stake resolved that no registry footprint confirms",
    );
  },
);

// THE MONEY, recomputed in TypeScript from raw contract rows. This is what catches the annex
// double-count (a 'contractAmendment' row added on top of an already post-annex amount_eur)
// and the €0 consortium-member placeholders — neither of which any expression-level test saw.
test.skipIf(skip)(
  "served totals match an independent sum over solo, non-annex contracts",
  async () => {
    const served = await allRows<{
      slug: string;
      eik: string;
      total: string;
      count: string;
      first_year: string;
      last_year: string;
      while_eur: string;
    }>(`
      WITH target AS MATERIALIZED (
        SELECT DISTINCT p.slug
          FROM declaration_stake_company sc
          JOIN person p ON p.person_id = sc.person_id
      )
      SELECT t.slug,
             e ->> 'eik' AS eik,
             e ->> 'totalEur' AS total,
             e ->> 'contractCount' AS count,
             e ->> 'firstYear' AS first_year,
             e ->> 'lastYear' AS last_year,
             e ->> 'whileDeclaredEur' AS while_eur
        FROM target t
        CROSS JOIN LATERAL jsonb_array_elements(person_stake_procurement(t.slug)) e
    `);
    assert.ok(served.length > 0, "nothing served — fixture is empty");

    // Raw rows for exactly those EIKs, with NO filtering applied server-side.
    const eiks = [...new Set(served.map((s) => s.eik))];
    const raw = await allRows<{
      contractor_eik: string;
      tag: string;
      consortium_role: string | null;
      amount_eur: number | null;
      yr: string | null;
    }>(
      `SELECT contractor_eik, tag, consortium_role, amount_eur,
              nullif(left(COALESCE(nullif(date_signed, ''), date), 4), '') AS yr
         FROM contracts WHERE contractor_eik = ANY($1)`,
      [eiks],
    );

    for (const s of served) {
      const mine = raw.filter(
        (r) =>
          r.contractor_eik === s.eik &&
          r.tag === "contract" &&
          r.consortium_role !== "member",
      );
      const expTotal = Math.round(
        mine.reduce((a, r) => a + (r.amount_eur ?? 0), 0),
      );
      const lo = Number(s.first_year);
      const hi = Number(s.last_year);
      const expWhile = Math.round(
        mine
          .filter((r) => {
            const y = r.yr && /^\d{4}$/.test(r.yr) ? Number(r.yr) : null;
            return y != null && y >= lo && y <= hi;
          })
          .reduce((a, r) => a + (r.amount_eur ?? 0), 0),
      );
      const where = `${s.slug}/${s.eik}`;
      // The server rounds the SUM, as does this expectation, so they must agree exactly — a
      // drift would mean the server rounded per row instead
      // (reference_procurement_eur_sum_basis).
      assert.equal(Number(s.total), expTotal, `totalEur wrong for ${where}`);
      assert.equal(
        Number(s.count),
        mine.length,
        `contractCount wrong for ${where}`,
      );
      assert.equal(
        Number(s.while_eur),
        expWhile,
        `whileDeclaredEur wrong for ${where}`,
      );
    }
  },
);

// A company whose entire procurement record is annexes or €0 placeholders must not surface
// at all — the block's premise is "this company holds public contracts".
test.skipIf(skip)("no served company has a nil contract take", async () => {
  const rows = await allRows<{ slug: string; eik: string }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug
        FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
    )
    SELECT t.slug, e ->> 'eik' AS eik
      FROM target t
      CROSS JOIN LATERAL jsonb_array_elements(person_stake_procurement(t.slug)) e
     WHERE COALESCE((e ->> 'totalEur')::numeric, 0) <= 0
  `);
  assert.deepEqual(
    rows.map((r) => `${r.slug}/${r.eik}`),
    [],
    "a company with no contract value was published under a conflict-of-interest heading",
  );
});

// The rendered period and the counted period must be the same span. The UI draws
// firstYear–lastYear as a range, so the arithmetic has to cover it contiguously; a discrete
// set of filed years would silently omit the gaps a reader sees included.
test.skipIf(skip)(
  "the aligned span is contiguous, matching the rendered range",
  async () => {
    const rows = await allRows<{
      slug: string;
      eik: string;
      lo: string;
      hi: string;
      expected: string;
      got: string;
    }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug, p.person_id
        FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
    ),
    served AS (
      SELECT t.slug, t.person_id,
             e ->> 'eik' AS eik,
             (e ->> 'firstYear')::int AS lo,
             (e ->> 'lastYear')::int AS hi,
             (e ->> 'whileDeclaredCount')::int AS got
        FROM target t
        CROSS JOIN LATERAL jsonb_array_elements(person_stake_procurement(t.slug)) e
    )
    SELECT s.slug, s.eik, s.lo::text, s.hi::text, s.got::text AS got,
           (SELECT count(*) FROM contracts c
             WHERE c.contractor_eik = s.eik AND c.tag = 'contract'
               AND c.consortium_role IS DISTINCT FROM 'member'
               AND left(COALESCE(nullif(c.date_signed, ''), c.date), 4) ~ '^\\d{4}$'
               AND left(COALESCE(nullif(c.date_signed, ''), c.date), 4)::int
                   BETWEEN s.lo AND s.hi)::text AS expected
      FROM served s
  `);
    assert.ok(rows.length > 0, "nothing served — fixture is empty");
    const wrong = rows.filter((r) => r.got !== r.expected);
    assert.deepEqual(
      wrong.map(
        (r) =>
          `${r.slug}/${r.eik} ${r.lo}-${r.hi}: got ${r.got}, span has ${r.expected}`,
      ),
      [],
      "the aligned count does not cover the rendered span contiguously",
    );
  },
);

// The raw parse must stay a faithful record of the XML. The form has no EIK column, so a
// non-NULL uic in declaration_stake means inference leaked back into the source table.
test.skipIf(skip)(
  "the inferred EIK never leaks into declaration_stake",
  async () => {
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_stake WHERE uic IS NOT NULL",
    );
    assert.equal(
      Number(r.n),
      0,
      "declaration_stake.uic was written — inference must stay in the derived layer",
    );
  },
);

// Payload determinism (reference_pg_payload_determinism): the same call must be byte-stable,
// or a redeploy churns the diff and the changelog misreports what changed.
test.skipIf(skip)("the payload is byte-stable across calls", async () => {
  const [r] = await allRows<{ same: boolean; n: string }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug
        FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
    ),
    two AS (
      SELECT person_stake_procurement(t.slug)::text AS a,
             person_stake_procurement(t.slug)::text AS b
        FROM target t
    )
    SELECT bool_and(a = b) AS same, count(*) AS n FROM two
  `);
  assert.ok(Number(r.n) > 0, "no slugs exercised");
  assert.equal(r.same, true, "the payload is not byte-stable");
});

// §6 PRIVACY GATE. A person who is not active + public must get an empty payload even
// though the matview holds their rows — the gate lives in the serving function.
test.skipIf(skip)(
  "the serving function enforces the privacy gate",
  async () => {
    const hidden = await allRows<{ slug: string; r: unknown[]; s: unknown[] }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug
        FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
       WHERE p.status <> 'active' OR NOT p.is_public_figure
       LIMIT 50
    )
    SELECT t.slug, person_stake_procurement(t.slug) AS r,
           person_declared_stake_status(t.slug) AS s
      FROM target t
  `);
    const leaked = hidden.filter(
      (h) => (h.r as unknown[]).length > 0 || (h.s as unknown[]).length > 0,
    );
    assert.deepEqual(
      leaked.map((l) => l.slug),
      [],
      "a non-public / non-active person was served stake rows",
    );
    // BOTH functions, because both serve declaration-derived facts about a named person off
    // the same `person` predicate, and the newer one carries a company name and an EIK. The
    // local corpus may hold no hidden person with stakes, in which case this is vacuous —
    // which is itself worth saying rather than reading as coverage.
    if (hidden.length === 0)
      console.warn(
        "privacy gate: no non-public person with declared stakes in this corpus — vacuous",
      );
  },
);
