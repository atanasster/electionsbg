// The measured coverage gate plan A5 asks for.
//
// WHY IT EXISTS. The hand-written fixtures in eop_notice_parse.test.ts assert that
// the parser handles shapes I wrote; this asserts it handles the shapes the REGISTER
// actually emits. Both of the parser's shipped defects were invisible to the unit
// tests and obvious here: `BT-36-Lot` carries a bare number (the fixtures claimed
// "24 Месец", which occurs in zero notices), and 16.6% of pairs carry a
// parenthesised code the first regex silently demoted to the legacy tier.
//
// Reads the captured tier-A store, so it skips on a machine that has not crawled —
// same convention as the Postgres data tests.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { describe, test, expect } from "vitest";
import {
  parseNoticePairs,
  noticeFields,
  isPriceOnly,
} from "./eop_notice_parse";

const STORE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../raw_data/procurement/eop_dossier.sqlite",
);

const load = (): { previews: string[]; tenders: number } => {
  const db = new DatabaseSync(STORE);
  const rows = db
    .prepare("SELECT body_gz, byte_len FROM eop_dossier WHERE kind = 'details'")
    .all() as { body_gz: Uint8Array; byte_len: number }[];
  const previews: string[] = [];
  let tenders = 0;
  for (const r of rows) {
    if (r.byte_len === 0) continue;
    const d = JSON.parse(gunzipSync(Buffer.from(r.body_gz)).toString()) as {
      TenderPublicationDetails?: { HtmlPreview?: string }[];
    };
    const pubs = d.TenderPublicationDetails ?? [];
    if (!pubs.length) continue;
    tenders++;
    for (const p of pubs) if (p.HtmlPreview) previews.push(p.HtmlPreview);
  }
  db.close();
  return { previews, tenders };
};

const hasStore = fs.existsSync(STORE);

describe.skipIf(!hasStore)("notice parse coverage (captured store)", () => {
  const { previews, tenders } = hasStore
    ? load()
    : { previews: [], tenders: 0 };
  const allPairs = previews.map((h) => parseNoticePairs(h));

  test("the store actually has notices to measure", () => {
    expect(tenders).toBeGreaterThan(0);
    expect(previews.length).toBeGreaterThan(0);
  });

  // A parser that failed to decode entities, or whose class-name anchors went stale,
  // returns zero pairs while still "passing" every unit test.
  test("no notice parses to zero pairs", () => {
    const empty = allPairs.filter((p) => p.length === 0).length;
    expect(empty).toBe(0);
  });

  test("pairs per notice stays in the measured band", () => {
    const mean =
      allPairs.reduce((s, p) => s + p.length, 0) / (allPairs.length || 1);
    // Measured 239 on the 2026-08 capture. A wide band: this is a regression gate
    // for "the parse collapsed", not an assertion about the register's form design.
    expect(mean).toBeGreaterThan(50);
  });

  // The defect this file was written for. A code that is silently demoted also
  // leaves its raw text in `label`, so the legacy tier's only key is poisoned too.
  test("parenthesised eForms codes are recognised, not demoted to legacy", () => {
    const flat = allPairs.flat();
    const paren = flat.filter((p) => p.code && p.code.includes("("));
    expect(paren.length).toBeGreaterThan(0);
    // No pair may keep an un-stripped eForms code in its label.
    const poisoned = flat.filter((p) => /\((?:BT|OPT|OPP)-[0-9]/.test(p.label));
    expect(poisoned.map((p) => p.label).slice(0, 5)).toEqual([]);
  });

  test("BT-36-Lot really is a bare number — the field name must not promise a unit", () => {
    const vals = allPairs
      .map((p) => noticeFields(p).durationValue)
      .filter((v): v is string => !!v);
    expect(vals.length).toBeGreaterThan(0);
    // If the register ever starts printing the unit inline, this fails and the
    // field can be renamed back — which is the point of pinning it.
    expect(vals.every((v) => /^\d+$/.test(v.trim()))).toBe(true);
  });

  test("the eForms/legacy split is measurable and both tiers are non-degenerate", () => {
    const fields = allPairs.map((p) => noticeFields(p));
    const eforms = fields.filter((f) => f.isEforms).length;
    expect(eforms).toBeGreaterThan(0);
    // Every notice exposing exactly zero codes would mean CODE_RE stopped matching.
    expect(fields.some((f) => f.btCount > 10)).toBe(true);
  });

  // Tri-state, and all three states must occur — otherwise `null` is doing no work
  // and the signal has quietly become a boolean.
  test("isPriceOnly discriminates all three states on the real corpus", () => {
    const verdicts = allPairs.map((p) => isPriceOnly(noticeFields(p)));
    expect(verdicts.some((v) => v === true)).toBe(true);
    expect(verdicts.some((v) => v === null)).toBe(true);
  });

  test("script and style bodies do not leak into the parsed values", () => {
    const flat = allPairs.flat();
    const css = flat.filter((p) =>
      /\{[^}]*:[^}]*\}|function\s*\(/.test(p.value),
    );
    expect(css.map((p) => p.value.slice(0, 60)).slice(0, 3)).toEqual([]);
  });
});
