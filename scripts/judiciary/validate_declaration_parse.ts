// The validation set for the structured declaration reader — "not a spot check".
//
// docs/plans/magistrate-declaration-detail-v1.md Tier 2 sets the bar for this work, and it
// is not "it parsed": it is *"we can tell when it didn't"*. Phase 6 of judiciary-vss-v1.md
// abandoned per-table parsing because good and bad extractions were indistinguishable — a
// 24% cash undercount on one magistrate and a false-positive figure on another, both silent.
// So the reader is only worth having if a run like this one can say, over a real sample,
// how often it is right and how it fails when it is not.
//
// WHAT MAKES THIS A CHECK RATHER THAN A RESTATEMENT. The parsed row count is compared
// against an INDEPENDENT count taken from the raw text layer — ordinal-prefixed rows with
// content, found without the column map — plus the form's own „Нямам нищо за деклариране"
// marker. Two different readings of the same page: if they agree, the map found what a
// person reading the page would; if they disagree, the sample names the file. A harness
// that re-derived the count through the same code path would agree with itself always.
//
// It fetches from the ИВСС register (plain HTTP, bare IP — see sources.ts) and writes
// nothing to the corpus. Sample is deterministic for a given seed so a re-run is comparable.
//
//   npx tsx scripts/judiciary/validate_declaration_parse.ts [--n 60] [--seed 7] [--dir DIR]
//
// `--dir` reads already-downloaded PDFs instead of fetching, for iterating offline.

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  declarationMeta,
  isRefusal,
  readTable,
  toRows,
  type Item,
  type Row,
} from "./declarationTables";
import { IVSS_REGISTER } from "./sources";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const pdfjs = require("pdfjs-dist") as any;

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const INDEX = path.join(ROOT, "raw_data/judiciary/declarations_index.json");

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

/** Deterministic PRNG so a re-run samples the same declarations.
 *
 *  mulberry32 rather than the textbook LCG, whose low bits are so weak that the multiply
 *  overflows JS's 53-bit mantissa and the sequence collapses — measured period 14,469. At
 *  n=60 that is invisible; the Tier-3a pass this file is a template for wants thousands. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** The two tables this reader currently claims. Both are description-and-date tables whose
 *  money column is a single unambiguous „Цена"; the money tables (10-13) are deliberately
 *  NOT here — see the plan for why they need their own evidence. */
const TABLES = [
  {
    id: "T1 недвижимо имущество",
    caption: /Право на собственост и ограничени вещни права/,
    columns: 12,
    // ⚠️ WITHOUT THESE THE HARNESS CHECKS SEGMENTATION AND CALLS IT EXTRACTION. Comparing
    // row COUNTS cannot see a column SHIFT: printed with a centred header — the ordinary
    // way to typeset `1 | 2 | … | 12` — an edge-based assignment moved every value one
    // column left, so „Цена на сделката" held the acquisition year, and the count was
    // unchanged and the agreement 100%. Exactly the failure the reader exists to prevent,
    // invisible to its own evidence.
    //
    // So each mapped column is asserted to hold the SHAPE the form prints there. These are
    // deliberately weak (a year looks like a year, a price looks like a number) because a
    // strong assertion would just be the parser restated — but any one-column shift breaks
    // several of them at once, which is all that is needed.
    shape: {
      8: {
        name: "година на придобиване",
        ok: (s: string) => /^(19|20)\d\d$/.test(s),
      },
      7: { name: "цена на сделката", ok: (s: string) => /^[\d\s.,]+$/.test(s) },
      10: {
        name: "идеална част",
        ok: (s: string) => /^(\d+\/\d+|СИО|[\d.,]+\s*%?)$/i.test(s),
      },
    } as Record<number, { name: string; ok: (s: string) => boolean }>,
  },
  {
    id: "T2 прехвърляне на имоти",
    caption: /Прехвърляне на имоти през предходната година/,
    columns: 10,
    shape: {
      6: { name: "цена на сделката", ok: (s: string) => /^[\d\s.,]+$/.test(s) },
      9: {
        name: "идеална част",
        ok: (s: string) => /^(\d+\/\d+|СИО|[\d.,]+\s*%?)$/i.test(s),
      },
    } as Record<number, { name: string; ok: (s: string) => boolean }>,
  },
] as const;

const pagesOf = async (bytes: Uint8Array): Promise<Row[][]> => {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false })
    .promise;
  const out: Row[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const items: Item[] = tc.items
      .filter((i: any) => typeof i.str === "string" && i.str.trim())
      .map((i: any) => ({
        s: i.str.replace(/\s+/g, " ").trim(),
        x: i.transform[4],
        y: i.transform[5],
      }));
    out.push(toRows(items));
  }
  return out;
};

/** The independent count: ordinal-prefixed rows carrying content, between this table's
 *  caption and whatever ends it, found WITHOUT the column map. */
const rawRowCount = (
  pages: Row[][],
  caption: RegExp,
): { count: number; declaredNothing: boolean; found: boolean } => {
  let count = 0;
  let found = false;
  let declaredNothing = false;
  for (let p = 0; p < pages.length; p++) {
    const rows = pages[p];
    const ci = rows.findIndex((r) => caption.test(r.map((i) => i.s).join(" ")));
    if (ci < 0) continue;
    found = true;
    // The „nothing to declare" marker is printed immediately ABOVE its table's caption.
    declaredNothing = rows
      .slice(Math.max(0, ci - 3), ci)
      .some((r) =>
        /Нямам нищо за деклариране/.test(r.map((i) => i.s).join(" ")),
      );
    for (let q = p; q < pages.length; q++) {
      const from = q === p ? ci : 0;
      let stop = false;
      for (const r of pages[q].slice(from)) {
        const flat = r.map((i) => i.s).join(" ");
        if (q > p && /Таблица № |Нямам нищо за деклариране/.test(flat)) {
          stop = true;
          break;
        }
        if (/^\d+\.$/.test(r[0]?.s ?? "") && r.length > 1) count++;
        else if (q === p && count > 0 && /Таблица № |Нямам нищо/.test(flat)) {
          stop = true;
          break;
        }
      }
      if (stop) break;
    }
    break;
  }
  return { count, declaredNothing, found };
};

const main = async (): Promise<void> => {
  const n = Number(arg("--n") ?? 60);
  const seed = Number(arg("--seed") ?? 7);
  const dir = arg("--dir");

  const index: Array<{
    year: number;
    name: string;
    pdf: string;
    batch: string;
  }> = JSON.parse(fs.readFileSync(INDEX, "utf8"));

  // Stratified across YEAR and BATCH so the sample cannot accidentally be all recent
  // v3.0 forms — the older layout is where a reader is most likely to be wrong.
  const rand = rng(seed);
  const years = [...new Set(index.map((e) => e.year))].sort();
  const sample: typeof index = [];
  for (let i = 0; sample.length < n && i < n * 4; i++) {
    const y = years[Math.floor(rand() * years.length)];
    const b = rand() < 0.5 ? "annual" : "change";
    const pool = index.filter((e) => e.year === y && e.batch === b);
    if (!pool.length) continue;
    const pick = pool[Math.floor(rand() * pool.length)];
    if (!sample.some((s) => s.pdf === pick.pdf)) sample.push(pick);
  }

  const kinds = new Map<string, number>();
  const periods = { present: 0, absent: 0 };
  const perTable = new Map<
    string,
    {
      agree: number;
      disagree: number;
      refused: number;
      notFound: number;
      rows: number;
      goodCells: number;
      badCells: number;
      inexact: number;
      oldForm: number;
      oldFormRows: number;
    }
  >();
  const disagreements: string[] = [];
  const shapeFailures: string[] = [];
  let read = 0;
  let failed = 0;

  for (const e of sample) {
    let bytes: Uint8Array;
    try {
      if (dir) {
        const f = path.join(dir, path.basename(e.pdf));
        if (!fs.existsSync(f)) continue;
        bytes = new Uint8Array(fs.readFileSync(f));
      } else {
        const res = await fetch(new URL(e.pdf, IVSS_REGISTER).href);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        bytes = new Uint8Array(await res.arrayBuffer());
        await new Promise((r) => setTimeout(r, 120));
      }
    } catch (err) {
      failed++;
      console.error(`  fetch failed ${e.pdf}: ${(err as Error).message}`);
      continue;
    }

    let pages: Row[][];
    try {
      pages = await pagesOf(bytes);
    } catch (err) {
      failed++;
      console.error(`  parse failed ${e.pdf}: ${(err as Error).message}`);
      continue;
    }
    read++;

    const meta = declarationMeta(pages[1] ?? []);
    kinds.set(meta.kind, (kinds.get(meta.kind) ?? 0) + 1);
    if (meta.periodYear == null) periods.absent++;
    else periods.present++;

    for (const t of TABLES) {
      const acc = perTable.get(t.id) ?? {
        goodCells: 0,
        badCells: 0,
        inexact: 0,
        oldForm: 0,
        oldFormRows: 0,
        agree: 0,
        disagree: 0,
        refused: 0,
        notFound: 0,
        rows: 0,
      };
      const parsed = readTable(pages, t.caption, t.columns);
      const raw = rawRowCount(pages, t.caption);
      if (isRefusal(parsed)) {
        if (!raw.found) acc.notFound++;
        else if (parsed.kind === "form-version") {
          // EXPECTED, not a problem: the pre-v3.0 form orders its columns differently and
          // is declined by design. Counted so the coverage cost stays visible, but not
          // listed as something to read by hand — 35 of 60 here, which would drown the
          // refusals that DO need a human.
          acc.oldForm++;
          acc.oldFormRows += raw.count;
        } else {
          acc.refused++;
          disagreements.push(
            `${t.id} REFUSED(${parsed.kind}) but the page has ${raw.count} row(s): ${e.pdf}`,
          );
        }
      } else if (parsed.rows.length === raw.count) {
        acc.agree++;
        acc.rows += parsed.rows.length;
        acc.inexact += parsed.rows.filter((x) => !x.exact).length;
        // ⚠️ „Нямам нищо за деклариране" IS NOT USABLE AS A THIRD READING, and a first cut
        // of this harness used it as one. The phrase is the STATIC LABEL of a checkbox the
        // form prints above every table; the tick itself is a graphic, not text, so the text
        // layer carries the label identically whether or not it was ticked. Цацаров's 2026
        // filing prints it directly above four declared properties. Used as evidence it
        // manufactured five false alarms in this very sample.
        // Row segmentation agreed. Now check the CELLS — the half a count cannot see.
        // Only EXACT rows (one run per column) are shape-checked: a sparse row is assigned
        // by nearest header and can merge two runs, which is a known limitation reported
        // separately rather than counted as a shift.
        for (const r of parsed.rows.filter((x) => x.exact))
          for (const [colStr, spec] of Object.entries(t.shape)) {
            const v = r.cells[Number(colStr)];
            if (v == null || v === "") continue; // an empty cell is not a shift
            if (!spec.ok(v)) {
              acc.badCells++;
              shapeFailures.push(
                `${t.id} row ${r.ord} col ${colStr} (${spec.name}) holds ${JSON.stringify(v.slice(0, 32))}: ${e.pdf}`,
              );
            } else acc.goodCells++;
          }
      } else {
        acc.disagree++;
        disagreements.push(
          `${t.id} parsed ${parsed.rows.length} vs raw ${raw.count}: ${e.pdf}`,
        );
      }
      perTable.set(t.id, acc);
    }
  }

  console.log(
    `\nsample ${sample.length}, read ${read}, unreadable ${failed}\n`,
  );
  console.log("declaration kind:");
  for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1]))
    console.log(`  ${k.padEnd(10)} ${v}`);
  console.log(
    `\ncovered period printed: ${periods.present}/${read}` +
      ` (absent on ${periods.absent} — the document's own answer, not a parse failure)\n`,
  );
  for (const [id, a] of perTable) {
    const checked = a.agree + a.disagree + a.refused;
    const pct = checked ? ((100 * a.agree) / checked).toFixed(1) : "—";
    console.log(
      `${id}: ${a.agree}/${checked} agree with the raw count (${pct}%), ` +
        `${a.disagree} disagree, ${a.refused} refused-with-rows, ` +
        `${a.notFound} absent from the document, ${a.rows} rows read`,
    );
  }
  if (shapeFailures.length) {
    console.log(
      `\n⚠️  ${shapeFailures.length} cell(s) hold something the form does not print there ` +
        `— the signature of a COLUMN SHIFT:`,
    );
    for (const f of shapeFailures.slice(0, 20)) console.log(`  ${f}`);
  }
  if (disagreements.length) {
    console.log(`\n⚠️  ${disagreements.length} case(s) to read by hand:`);
    for (const d of disagreements.slice(0, 20)) console.log(`  ${d}`);
  } else {
    console.log("\nno disagreements between the two readings.");
  }
  // A non-zero exit makes this usable as a gate later; today it is a report.
  if (disagreements.length || shapeFailures.length) process.exitCode = 1;
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
