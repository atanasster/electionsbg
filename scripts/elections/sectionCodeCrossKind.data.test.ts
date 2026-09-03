// Why kind switching from a polling station drops to the settlement (§Phase 6 item 6) —
// measured against the committed corpora rather than asserted in a comment.
//
// ⚠ THIS GATE EXISTS BECAUSE THE UI NOW MAKES THE CLAIM TO READERS. `PlaceViewNav` prints
// „Номерата на секциите не се пренасят между парламентарни и местни избори…" under the
// switcher on every section page. That sentence is a statement about the data, so it has to
// be one the data still supports — and nothing else in the repo would notice if a future
// ingest aligned the numbering and turned it into a false excuse for a worse destination.
//
// ⚠ THE PLAN'S PHRASING IS HALF RIGHT AND THE HALF THAT IS WRONG IS THE INTERESTING ONE.
// §6 says section codes "do not map reliably between election kinds/cycles". Measured
// 2026-09-04:
//
//   ACROSS CYCLES of one kind the numbering is STABLE
//     parliamentary 2024-10 → 2026-04   12,353 of 12,721 shared   97.1%
//     local         2019    → 2023      12,010 of 12,302 shared   97.6%
//
//   ACROSS KINDS it collapses
//     local 2023 ∩ parliamentary 2026    6,683 of 12,302           54.3%
//     …and of those 6,683, **430 (6.4%) name a DIFFERENT SETTLEMENT** —
//     211100004 is с.Градец parliamentary and гр.Златоград local.
//
// So copy blaming the CYCLES would be wrong about something a reader could check, and the
// 6.4% is the reason the fallback cannot be "look the code up on the other side and use it if
// found": half of what it finds is another town, silently, at a 200.
//
// Skips (never silently passes) when a cycle tree is absent — a fresh clone has no `data/<cycle>`,
// and "no codes to compare" must not read as "the numbering does not carry over".
//
//   npm run test:data

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { reportSkip } from "../lib/report_skip";

const DATA_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data",
);

const PARL = "2026_04_19";
const PARL_PREV = "2024_10_27";
const LOCAL = "2023_10_29_mi";
const LOCAL_PREV = "2019_10_27_mi";

/** Parliamentary stations live in one file per oblast, keyed by station code. */
const parliamentaryStations = (cycle: string): Map<string, string> => {
  const dir = path.join(DATA_ROOT, cycle, "sections", "by-oblast");
  const out = new Map<string, string>();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const blob = JSON.parse(
      fs.readFileSync(path.join(dir, f), "utf8"),
    ) as Record<string, { settlement?: string }>;
    for (const [code, v] of Object.entries(blob))
      out.set(code, (v?.settlement ?? "").trim());
  }
  return out;
};

/** Local stations are one file each, under the obshtina that ran the election. */
const localStations = (cycle: string): Map<string, string> => {
  const root = path.join(DATA_ROOT, cycle, "sections");
  const out = new Map<string, string>();
  if (!fs.existsSync(root)) return out;
  for (const ob of fs.readdirSync(root)) {
    const dir = path.join(root, ob);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as {
        section?: { settlement?: string };
      };
      out.set(f.slice(0, -5), (d.section?.settlement ?? "").trim());
    }
  }
  return out;
};

/** Settlement names are compared folded, so „гр.Банско" and „гр. Банско" are one place — a
 *  punctuation difference is not a station moving town, and counting it as one would inflate
 *  the very figure this gate exists to keep honest. */
const fold = (s: string) => s.toUpperCase().replace(/[^А-ЯЁA-Z0-9]+/gu, "");

const parl = parliamentaryStations(PARL);
const parlPrev = parliamentaryStations(PARL_PREV);
const loc = localStations(LOCAL);
const locPrev = localStations(LOCAL_PREV);

const missing = [
  [PARL, parl],
  [PARL_PREV, parlPrev],
  [LOCAL, loc],
  [LOCAL_PREV, locPrev],
]
  .filter(([, m]) => (m as Map<string, string>).size === 0)
  .map(([c]) => c as string);
const skip = missing.length
  ? `no station corpus for ${missing.join(", ")} — run the ingest, or this is a fresh clone`
  : "";
reportSkip(import.meta.url, skip);

const share = (a: Map<string, string>, b: Map<string, string>) => {
  const shared = [...a.keys()].filter((k) => b.has(k));
  return { shared, pct: (100 * shared.length) / a.size };
};

describe.skipIf(skip)("what a station number survives", () => {
  it("carries over between CYCLES of the same kind — so the copy must not blame cycles", () => {
    // ⚠ THE HALF THAT MAKES THE OTHER HALF MEAN SOMETHING. Without it, "the numbers do not
    // carry over" is untestable hand-waving that any corpus satisfies; with it, the claim is
    // specifically about the kind boundary and is falsifiable.
    expect(share(parl, parlPrev).pct).toBeGreaterThan(90);
    expect(share(loc, locPrev).pct).toBeGreaterThan(90);
  });

  it("does NOT carry over between kinds — half the stations have no twin", () => {
    const { pct } = share(loc, parl);
    expect(pct).toBeLessThan(75);
    expect(pct).toBeGreaterThan(25);
  });

  it("and a shared number is not proof of the same station", () => {
    // ⚠ THE FINDING THAT RULES OUT A CODE LOOKUP ALTOGETHER. A fallback that used the code
    // "when it resolves" would be right about the settlement 93.6% of the time and put the
    // reader in another town for the rest — with no error, no empty state, and a page that
    // reads perfectly.
    const { shared } = share(loc, parl);
    const named = shared.filter((c) => loc.get(c) && parl.get(c));
    expect(named.length).toBeGreaterThan(1000);
    const elsewhere = named.filter(
      (c) => fold(loc.get(c)!) !== fold(parl.get(c)!),
    );
    expect(elsewhere.length).toBeGreaterThan(0);
    expect((100 * elsewhere.length) / named.length).toBeLessThan(25);
  });

  it("the settlement comparison discriminates — it is not folding everything equal", () => {
    // Without this the test above passes on a `fold` that returned a constant, which would
    // report 0% mismatches and read as "the codes agree perfectly".
    expect(fold("гр.Банско")).toBe(fold("гр. Банско"));
    expect(fold("с.Градец")).not.toBe(fold("гр.Златоград"));
  });
});
