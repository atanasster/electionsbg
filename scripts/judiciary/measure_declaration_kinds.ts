// Tier 3a — how many magistrates have a STOCK SNAPSHOT of their estate on record.
//
// WHY THIS NUMBER DECIDES A FEATURE. The ИВСС annual declaration's Таблица 1 is a FLOW: it
// lists property ACQUIRED during the declared period, not property owned. So no annual
// filing, and no pile of annual filings, answers „what does this magistrate own". An ENTRY
// declaration does — column 1 of the form is „към датата на встъпване в длъжност", and it is
// a full snapshot: Сотир Цацаров's July 2022 entry filing lists 11 properties acquired
// between 2003 and 2018.
//
// The accounting therefore closes only where a snapshot exists inside the register's window:
//
//     estate = entry snapshot + Σ annual acquisitions − Σ Таблица-2 disposals
//
// The register starts in 2017, so a magistrate who took office earlier has their entry filing
// outside it, and a disposal can then have no antecedent — subtracting one goes negative.
// Whether „what they own" is publishable at all, for how many people, is exactly the share
// this script measures. See docs/plans/magistrate-declaration-detail-v1.md, Finding 0b.
//
// ⚠️ THE KIND IS ONLY IN THE PDF. The register's index carries a name, a входящ номер and a
// directory — nothing that distinguishes an entry filing from an annual — and its `batch`
// field is the DIRECTORY, which the ИВСС does not use consistently (Цацаров's filing in
// `2025-1` is stamped ЕЖЕГОДНА and covers 2024). So this has to open documents. It reads
// PAGE 2 ONLY, which is where the form prints both the kind and the covered period, and
// discards the bytes.
//
// Sampling is the point. The full corpus is 51,040 filings — roughly 20 hours of polite
// fetching against a rate-limited public register, i.e. an operator run, not a step in any
// chain. `--magistrates N` samples N people and reads ALL of their filings, which is the
// grain the question is asked at: „does THIS person have a snapshot", not „what share of
// filings are snapshots".
//
//   npx tsx scripts/judiciary/measure_declaration_kinds.ts [--magistrates 40] [--seed 7]
//   npx tsx scripts/judiciary/measure_declaration_kinds.ts --all        # the operator run

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  declarationMeta,
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

/** mulberry32 — the textbook LCG's low bits are too weak to sample thousands. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Page 2 only. The kind and the covered period are both printed there, and opening the
 *  other ten pages would triple a run that is already measured in hours. */
const page2 = async (bytes: Uint8Array): Promise<Row[]> => {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false })
    .promise;
  if (doc.numPages < 2) return [];
  const tc = await (await doc.getPage(2)).getTextContent();
  const items: Item[] = tc.items
    .filter((i: any) => typeof i.str === "string" && i.str.trim())
    .map((i: any) => ({
      s: i.str.replace(/\s+/g, " ").trim(),
      x: i.transform[4],
      y: i.transform[5],
    }));
  return toRows(items);
};

const main = async (): Promise<void> => {
  const all = process.argv.includes("--all");
  const nMagistrates = Number(arg("--magistrates") ?? 40);
  const seed = Number(arg("--seed") ?? 7);

  const index: Array<{
    year: number;
    name: string;
    pdf: string;
    batch: string;
  }> = JSON.parse(fs.readFileSync(INDEX, "utf8"));

  const byName = new Map<string, typeof index>();
  for (const e of index) {
    const l = byName.get(e.name) ?? [];
    l.push(e);
    byName.set(e.name, l);
  }

  let names = [...byName.keys()];
  if (!all) {
    const rand = rng(seed);
    const picked = new Set<string>();
    while (picked.size < Math.min(nMagistrates, names.length))
      picked.add(names[Math.floor(rand() * names.length)]);
    names = [...picked];
  }
  const filings = names.reduce((s, n) => s + (byName.get(n)?.length ?? 0), 0);
  console.log(
    `${names.length} magistrate(s), ${filings} filing(s)` +
      (all ? " — FULL CORPUS, expect hours" : ` (sampled, seed ${seed})`),
  );

  const kinds = new Map<string, number>();
  const withSnapshot = new Set<string>();
  let read = 0;
  let failed = 0;
  let periodPrinted = 0;

  for (const name of names) {
    for (const e of byName.get(name) ?? []) {
      try {
        const res = await fetch(new URL(e.pdf, IVSS_REGISTER).href);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const meta = declarationMeta(
          await page2(new Uint8Array(await res.arrayBuffer())),
        );
        read++;
        kinds.set(meta.kind, (kinds.get(meta.kind) ?? 0) + 1);
        if (meta.periodYear != null) periodPrinted++;
        // Entry AND exit both snapshot the whole estate — one at the start of the office,
        // one at its end — so either anchors the arithmetic.
        if (meta.kind === "entry" || meta.kind === "exit")
          withSnapshot.add(name);
        await new Promise((r) => setTimeout(r, 120));
      } catch (err) {
        failed++;
        console.error(`  ${e.pdf}: ${(err as Error).message}`);
      }
    }
    if (names.length > 20 && (names.indexOf(name) + 1) % 10 === 0)
      console.log(`  …${names.indexOf(name) + 1}/${names.length} magistrates`);
  }

  console.log(`\nread ${read} filing(s), ${failed} unreadable\n`);
  // A run where the register was unreachable throughout must say so, not print NaN% and a
  // reassuring „0 magistrates have a snapshot" — which is a claim about the corpus rather
  // than about the run.
  if (!read) {
    console.error(
      "nothing could be read — the register was unreachable or every fetch failed. " +
        "This is NOT a finding about the corpus.",
    );
    process.exitCode = 1;
    return;
  }
  const pct = (n: number): string => ((100 * n) / read).toFixed(1);
  console.log("declaration kind, per filing:");
  for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1]))
    console.log(`  ${k.padEnd(10)} ${String(v).padStart(5)}  ${pct(v)}%`);
  console.log(
    `\ncovered period printed on ${periodPrinted}/${read} (${pct(periodPrinted)}%)`,
  );
  console.log(
    `\n⭐ magistrates with a STOCK SNAPSHOT (entry or exit) in the window: ` +
      `${withSnapshot.size}/${names.length} ` +
      `(${((100 * withSnapshot.size) / names.length).toFixed(1)}%)`,
  );
  console.log(
    `\nThat share is the ceiling on how many magistrates a "what they own" figure could\n` +
      `ever be published for. For the rest, the register holds acquisitions and disposals\n` +
      `with no opening balance, and no arithmetic over them yields an estate.`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
