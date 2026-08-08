// Corpus validation for the label→КИД-2008 division classifier
// (src/lib/naceLabel.ts), which exists because the CR Deeds НКИД field mixes
// НКИД-2003 (NACE Rev.1.1) and КИД-2008 (Rev.2) codes that reuse division numbers
// for different sectors. The unit test (naceLabel.test.ts) pins specific cases;
// THIS test holds the classifier against the REAL crawled labels so a vocabulary
// drift or a regression to the ambiguous CODE surfaces loudly.
//
// Skips (not fails) only when Postgres is unreachable or company_nkid is empty (no
// crawl on this machine) — the scripts/db/tests/*.data.test.ts convention.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { naceDivisionFromLabel } from "../../../src/lib/naceLabel";

const haveDb = await dbReachable();

afterAll(async () => {
  await end();
});

type Row = {
  eik: string;
  nace_code: string | null;
  nace_div: string;
  label: string;
};

test.skipIf(!haveDb)(
  "company_nkid divisions are reproducible from the label and free of the version bug",
  async () => {
    const rows = await allRows<Row>(
      `SELECT eik, nace_code, nace_div, label FROM company_nkid`,
    );
    if (rows.length === 0) return; // no crawl on this machine — nothing to validate

    // 1. Every stored division is exactly what the classifier derives from the label
    //    — proves the loader classified from the LABEL (naceDivisionFromLabel), and
    //    that the mapping is deterministic and reproducible.
    let reproduced = 0;
    for (const r of rows) {
      const div = naceDivisionFromLabel(r.label);
      assert.equal(
        div,
        r.nace_div,
        `stored nace_div ${r.nace_div} != classifier ${div} for ${r.eik}: ${r.label.slice(0, 80)}`,
      );
      if (div) reproduced++;
    }
    assert.equal(
      reproduced,
      rows.length,
      "every stored row must carry a division",
    );

    // 2. THE VERSION-BUG REGRESSION GUARD. Under the old code-based parse, НКИД-2003
    //    wholesale codes (division 51 in Rev.1.1) were read as КИД-2008 division 51
    //    (AIR TRANSPORT), producing thousands of false "off-profile" flags. Almost no
    //    crawled company is an airline, so a spike here means the classifier has
    //    reverted to reading the ambiguous code. Measured label-based: 1.
    const div51 = rows.filter((r) => r.nace_div === "51").length;
    assert.ok(
      div51 < 20,
      `division 51 (air transport) has ${div51} companies — implausibly high; the ` +
        `code-based version bug has likely returned (Rev.1.1 wholesale read as air transport)`,
    );

    // 2b. SUBSTRING-BLEED GUARD. "спорт" is a substring of "транСПОРТ", so an
    //    unanchored sports rule (div 93) once pulled dozens of transport firms into
    //    sports → a false "off-profile" flag. No division-93 company's label may
    //    contain "транспорт". Generalisable smell: a division dominated by a word
    //    from a different sector.
    const sportsWithTransport = rows.filter(
      (r) => r.nace_div === "93" && /транспорт/i.test(r.label),
    );
    assert.equal(
      sportsWithTransport.length,
      0,
      `${sportsWithTransport.length} division-93 (sports) rows contain "транспорт" — ` +
        `the "спорт" rule is matching inside "транспорт" again`,
    );

    // 3. Positive proof the division is NOT taken from the code: a meaningful share of
    //    rows carry a code whose 2-digit prefix DIFFERS from the label-derived
    //    division (the version-mixed НКИД-2003 codes). If this were ~0, we would be
    //    reading the code after all.
    const codeDiffers = rows.filter(
      (r) =>
        r.nace_code &&
        r.nace_code.replace(/\D/g, "").slice(0, 2) !== r.nace_div,
    ).length;
    assert.ok(
      codeDiffers > rows.length * 0.1,
      `only ${codeDiffers}/${rows.length} rows have code≠division — the classifier ` +
        `may be echoing the code rather than reading the label`,
    );

    // 4. Sanity: the corpus is dominated by ordinary sectors (trade, agriculture,
    //    construction, transport), not by exotic divisions — a weak shape check that
    //    the classifier is landing on real economic activity.
    const byDiv = new Map<string, number>();
    for (const r of rows)
      byDiv.set(r.nace_div, (byDiv.get(r.nace_div) ?? 0) + 1);
    const top = [...byDiv.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map((e) => e[0]);
    assert.ok(
      ["46", "47", "01", "41", "49"].some((d) => top.includes(d)),
      `top divisions ${top.join(",")} look wrong — expected trade/agri/construction/transport to dominate`,
    );
  },
);

// PG-backed gate: nkidMismatch (bit 12) is ALIVE and DISCRIMINATING in the served
// contract_risk_cache — it fires on genuinely-disjoint contracts, is available-and-
// not-fired on plausible ones, and its fire rate stays in a conservative band. The
// parity harness proves SQL≡TS; this proves the flag actually does something and
// hasn't collapsed to always-fire (the false-accusation failure) or never-fire.
test.skipIf(!haveDb)(
  "nkidMismatch fires sensibly in contract_risk_cache (alive + conservative)",
  async () => {
    const cache = await allRows<{ n: number }>(
      "SELECT count(*)::int AS n FROM contract_risk_cache",
    );
    if (!cache[0]?.n) return; // cache not built on this machine

    const [{ available, fired }] = await allRows<{
      available: number;
      fired: number;
    }>(
      `SELECT count(*) FILTER (WHERE (available_mask >> 12) & 1 = 1)::int AS available,
              count(*) FILTER (WHERE (fired_mask >> 12) & 1 = 1)::int     AS fired
       FROM contract_risk_cache`,
    );

    // Alive: the check is available on a meaningful set (contractors we crawled)
    // and fires on some of them — a degenerate all-0 mask would pass parity yet
    // ship a dead feature.
    assert.ok(
      available > 0,
      "nkidMismatch is available on 0 contracts — dead check",
    );
    assert.ok(fired > 0, "nkidMismatch fires on 0 contracts — dead check");

    // Conservative: firing on a MAJORITY of available contracts would mean the
    // crosswalk is too tight (the 42%-fire code-version bug looked like this). The
    // label-based build measured ~12%. Hold it well under half.
    const fireRate = fired / available;
    assert.ok(
      fireRate < 0.35,
      `nkidMismatch fires on ${Math.round(fireRate * 100)}% of available contracts ` +
        `(${fired}/${available}) — implausibly high; the crosswalk may be too tight ` +
        `or the version bug has returned`,
    );

    // Every fired row must be genuinely disjoint per the SSOT — no universal CPV,
    // no allowed pairing slipped through into the fired set.
    const [{ leaks }] = await allRows<{ leaks: number }>(
      `SELECT count(*)::int AS leaks
         FROM contract_risk_cache rc
         JOIN contracts c   ON c.key = rc.key
         JOIN company_nkid n ON n.eik = c.contractor_eik
        WHERE (rc.fired_mask >> 12) & 1 = 1
          AND ( EXISTS (SELECT 1 FROM nace_cpv_universal u WHERE u.cpv_div = left(c.cpv, 2))
             OR EXISTS (SELECT 1 FROM nace_cpv_allow a
                         WHERE a.nace_div = n.nace_div AND a.cpv_div = left(c.cpv, 2)) )`,
    );
    assert.equal(
      leaks,
      0,
      `${leaks} fired nkidMismatch rows are actually universal or allowed pairings — ` +
        `the SQL fired-test disagrees with the crosswalk`,
    );
  },
);
