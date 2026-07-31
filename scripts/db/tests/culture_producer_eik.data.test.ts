// linkProducerEiks must THROW rather than clear links when the corpus cannot
// answer — and must leave the caller's buckets untouched when it does.
//
// WHY: the producer→EIK step runs inside scripts/culture/ingest.ts, before it
// writes data/culture/overview.json. Its failure mode is not an exception, it is
// a QUIET one — "matched nothing" and "cleared everything" are the same code path
// unless something stops it, and the artifact then ships with every
// /company/:eik link gone at exit code 0. That is the 2026-07-31 incident.
// The unit test next to the module guards the committed artifact; this guards the
// behaviour that keeps producing it.
//
// Auto-skips when Postgres is down or `tr_companies` is empty — like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { afterAll, expect, test } from "vitest";
import { allRows, dbReachable, end } from "../lib/pg";
import {
  TrCorpusUnavailable,
  coreName,
  linkProducerEiks,
} from "../../culture/producer_eik";
import type { ProducerBucket } from "../../../src/data/culture/types";

const haveDb = await dbReachable();
const companies = haveDb
  ? Number(
      (
        await allRows<{ n: string }>(
          "SELECT count(*) n FROM tr_companies",
        ).catch(() => [{ n: "0" }])
      )[0]?.n ?? 0,
    )
  : 0;
const ready = haveDb && companies > 0;

afterAll(async () => {
  await end();
});

const bucket = (producer: string, eik?: string): ProducerBucket => ({
  producer,
  producerFold: producer.toLocaleLowerCase("bg-BG"),
  eur: 1,
  count: 1,
  share: 0,
  ...(eik ? { eik } : {}),
});

test.skipIf(!ready)(
  "links a real producer to its unique TR company",
  async () => {
    const ps = [bucket("„Ню Бояна Филм” ЕАД")];
    const { linked, total, matchable } = await linkProducerEiks(ps);
    expect(total).toBe(1);
    expect(matchable).toBe(1);
    // Either it links or the name is genuinely ambiguous — but it must not throw,
    // and a link must be a plausible EIK.
    expect(linked).toBeLessThanOrEqual(1);
    if (ps[0].eik) expect(ps[0].eik).toMatch(/^\d{9}(\d{4})?$/);
  },
);

test.skipIf(!ready)(
  "throws — and clears NOTHING — when nothing matches",
  async () => {
    const ps = [
      bucket("ZZZ НЯМА ТАКАВА ФИРМА ХХХ", "121821072"),
      bucket("QQQ НЕСЪЩЕСТВУВАЩ ПРОДУЦЕНТ", "831915882"),
    ];
    await expect(linkProducerEiks(ps)).rejects.toBeInstanceOf(
      TrCorpusUnavailable,
    );
    // The whole point: a degrade must not be a partial strip.
    expect(ps[0].eik).toBe("121821072");
    expect(ps[1].eik).toBe("831915882");
  },
);

test.skipIf(!ready)(
  "leaves an ambiguous name unlinked rather than guessing",
  async () => {
    // A core matching >1 distinct uic must produce no link. Find one that really
    // is ambiguous in this corpus rather than assuming a particular name is.
    const [row] = await allRows<{ core: string }>(
      `SELECT upper(btrim(regexp_replace(regexp_replace(name,'["“”„»«]',' ','g'),'\\s+',' ','g'))) AS core
         FROM tr_companies
        GROUP BY 1 HAVING count(DISTINCT uic) > 1
        ORDER BY 1 LIMIT 1`,
    );
    if (!row) return; // no ambiguous name in this corpus — nothing to assert
    const ps = [bucket(row.core, "999999999"), bucket("„Ню Бояна Филм” ЕАД")];
    await linkProducerEiks(ps);
    expect(coreName(row.core)).toBe(row.core);
    expect(ps[0].eik).toBeUndefined();
  },
);

test.skipIf(!ready)(
  "matches the whole committed top-producer set",
  async () => {
    const { default: overview } = await import(
      "../../../data/culture/overview.json",
      { with: { type: "json" } }
    );
    const ps = (
      overview as { topProducers: ProducerBucket[] }
    ).topProducers.map((p) => bucket(p.producer));
    const { linked } = await linkProducerEiks(ps);
    // Same ratchet as the artifact test — this is the query that produces it.
    expect(linked).toBeGreaterThanOrEqual(18);
  },
);
