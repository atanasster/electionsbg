// READ-ONLY triage of the legacy A2 class — identity-identical contract rows published by АОП
// under TWO DIFFERENT document ids.
//
// There is no `--apply` and no write path anywhere in this file. It exists because the A2 class
// LOOKS like a clean duplicate population and is not, and the plan's standing instruction is
// "triage only — do not write a rule until the distant-document-id majority is understood".
// This is that understanding, re-derivable in one command rather than asserted in prose.
//
//   npx tsx scripts/procurement/triage_legacy_twins.ts
//
// ── WHAT IT ANSWERS ─────────────────────────────────────────────────────────────────────────
//
// The corpus key cannot tell the two cases apart on the 2011-2015 population: `legacy_csv.ts`
// binds `ID на поръчката` to `tenderId` and then drops it, and that file publishes no УНП — so
// two rows for the same contract look identical whether they came from one procurement filed
// twice or from two genuinely different ones. (On the later dumps the УНП does survive onto the
// row, which is why 24 of the 101 groups are already separable without touching the ingest.)
//
// Reading the RAW dumps back settles it, and the answer is that the majority are NOT duplicates:
// 56 of 101 groups carry two different procurement ids. Those are two procurements that happen to
// share a contract number, value, signing date and subject — exactly the shape whose eviction
// destroyed 46 legitimate rows / €5.15m in an earlier attempt.
//
// The procurement id is published under TWO column names and the dumps disagree on which:
// `ID на поръчката` on 2011-2015/2016/2017/2019/2021/2022-RL, and `Уникален номер на поръчката`
// on the CE dumps from 2020 on, which carry no `ID на поръчката` at all. Both are resolved, by
// the same regexes `legacy_csv.ts` binds. `ТИП ДОКУМЕНТ` is published by ONE of the nine dumps,
// so it cannot discriminate and is not classified on.
//
// Note the 2011-2015 file is NOT a CSV despite its name: it is a JSON array-of-arrays. Parsed as
// CSV its header reads as one 2.6M-field row and every lookup silently misses, which is why the
// first pass over it matched 0 of 83 documents and would have reported that whole 58-group
// population as unclassifiable.
//
// Plan: docs/plans/procurement-same-feed-dedup-v1.md §3.3 / §5.4.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { UNP_HEADER_PATTERNS } from "./unp";
import type { Contract } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MONTH_DIR = path.join(ROOT, "data/procurement/contracts");
const LEGACY_DIR = path.join(ROOT, "raw_data/procurement/legacy");

/** Identity WITHOUT the ocid — two rows agreeing here are the same contract under two document
 *  ids. Deliberately excludes `unp`: on the 2011-2015 file it is blank, and including it would
 *  hide the population this triage exists to characterise. */
const identity = (r: Contract): string =>
  JSON.stringify([
    r.contractId ?? "",
    r.contractorEik,
    r.amount ?? null,
    r.currency ?? null,
    r.title,
    r.cpv ?? "",
    r.awarderEik,
    r.dateSigned ?? "",
  ]);

const loadShards = (): Contract[] => {
  const out: Contract[] = [];
  for (const y of fs.readdirSync(MONTH_DIR).filter((n) => /^\d{4}$/.test(n))) {
    const dir = path.join(MONTH_DIR, y);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const rows = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf8"),
      ) as Contract[];
      for (const r of rows)
        if (
          r.ocid?.startsWith("aop-legacy-") &&
          !r.contractorEik.startsWith("obed-")
        )
          out.push(r);
    }
  }
  return out;
};

/** `null` means the DUMP DOES NOT PUBLISH that column — never "the value is blank".
 *
 *  The distinction is the whole safety property here. A first draft defaulted a missing column to
 *  `""`, so every row in that dump agreed with every other and the group read as "same поръчка" —
 *  the bucket §5.4 wants to build an eviction rule from — on no evidence at all. It mis-filed 11
 *  groups that way, one of them provably two different procurements
 *  (`aop-legacy-2020-65483` vs `-72710`, УНП `00166-2020-0011` vs `00166-2020-0013`). */
interface RawDoc {
  typ: string | null;
  proc: string | null;
  pub: string | null;
}

/** Read one annual dump into `documentId → {ТИП ДОКУМЕНТ, ID на поръчката, ПУБЛИКУВАН НА}`.
 *
 *  Two shapes hide behind the `.csv.gz` extension. 2011-2015 is a JSON array-of-arrays; the rest
 *  are real CSV. Sniffing the first byte is what keeps the 58-group 2011-2015 population from
 *  silently reading as "unmatched in raw CSV". */
const readDump = (
  file: string,
): { docs: Map<string, RawDoc>; cols: string } => {
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = body.trimStart().startsWith("[")
    ? (JSON.parse(body) as string[][])
    : (parse(body, {
        relaxColumnCount: true,
        relaxQuotes: true,
      }) as string[][]);
  // The BOM as an escape, never the literal byte — a raw BOM in the source is invisible in review
  // and trips no-irregular-whitespace, the same reason cross_source.ts writes its separator escaped.
  const hdr = rows[0].map((h) => h.replace(/^\uFEFF/, "").trim());
  // REGEX, not exact match, and the same patterns `legacy_csv.ts` binds. The schemas drift across
  // years, and an exact-match lookup is exactly what silently lost `ID на поръчката` on three
  // dumps and reported eleven groups as "same поръчка" on no evidence.
  const at = (...pats: RegExp[]): number =>
    hdr.findIndex((h) => pats.some((p) => p.test(h)));
  const iDoc = at(/^id на документ$/i, /^номер на документ$/i);
  const iTyp = at(/^тип документ$/i);
  // The procurement identity, in the two forms the dumps publish it. `ID на поръчката` is a bare
  // numeric id (2011-2015 / 2016 / 2017 / 2019 / 2021); the CE dumps from 2020 on carry the УНП
  // instead and no `ID на поръчката` at all. Either one identifies the procurement, so either
  // will do — but "the dump publishes neither" must stay distinguishable from "the two agree".
  const iProc = at(/id.*на.*поръчк/i, ...UNP_HEADER_PATTERNS);
  const iPub = at(/^публикуван на$/i);
  const out = new Map<string, RawDoc>();
  const cols =
    `proc=${iProc >= 0 ? hdr[iProc] : "ABSENT"}  ` +
    `typ=${iTyp >= 0 ? "yes" : "ABSENT"}  pub=${iPub >= 0 ? "yes" : "ABSENT"}`;
  if (iDoc < 0) return { docs: out, cols };
  const cell = (r: string[], i: number): string | null =>
    i >= 0 ? (r[i] ?? "").trim() : null;
  for (const r of rows.slice(1)) {
    const d = (r[iDoc] ?? "").trim();
    if (!d) continue;
    out.set(d, {
      typ: cell(r, iTyp),
      proc: cell(r, iProc),
      pub: cell(r, iPub),
    });
  }
  return { docs: out, cols };
};

const eur = (n: number): string =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const main = (): void => {
  const legacy = loadShards();
  const byIdentity = new Map<string, Contract[]>();
  for (const r of legacy) {
    if (!(r.contractId ?? "") || r.amount == null) continue;
    const k = identity(r);
    const a = byIdentity.get(k);
    if (a) a.push(r);
    else byIdentity.set(k, [r]);
  }
  const dupes = [...byIdentity.values()].filter((rs) => rs.length > 1);
  const a2 = dupes.filter((rs) => new Set(rs.map((r) => r.ocid)).size > 1);
  const a1 = dupes.filter((rs) => new Set(rs.map((r) => r.ocid)).size === 1);

  const surplus = (rs: Contract[]): number => {
    const t = rs.reduce((s, r) => s + (r.amountEur ?? 0), 0);
    return t - t / rs.length;
  };
  const tot = (g: Contract[][]): number =>
    g.reduce((s, rs) => s + surplus(rs), 0);

  console.log(`legacy rows: ${legacy.length}`);
  console.log(
    `A1 same-ocid groups:  ${a1.length}  surplus €${eur(tot(a1))}  (the stale-key class — see dedup_stale_base_keys.ts)`,
  );
  console.log(`A2 multi-ocid groups: ${a2.length}  surplus €${eur(tot(a2))}`);

  // Which dumps we need. The ocid is `aop-legacy-${yearToken}-${documentId}`, and the year token
  // itself contains hyphens (`2011-2015`, `2022-RL`), so split on the LAST one only.
  const split = (ocid: string): [string, string] => {
    const rest = ocid.slice("aop-legacy-".length);
    const i = rest.lastIndexOf("-");
    return [rest.slice(0, i), rest.slice(i + 1)];
  };
  const dumps = new Map<string, Map<string, RawDoc>>();
  console.log(
    `\nraw dumps read (which identity columns each actually publishes):`,
  );
  for (const yr of [
    ...new Set(a2.flatMap((rs) => rs.map((r) => split(r.ocid)[0]))),
  ].sort()) {
    const f = path.join(LEGACY_DIR, `${yr}.csv.gz`);
    if (!fs.existsSync(f)) {
      console.log(`  ${yr.padEnd(10)} MISSING — raw_data/ is gitignored`);
      continue;
    }
    const { docs, cols } = readDump(f);
    dumps.set(yr, docs);
    console.log(
      `  ${yr.padEnd(10)} ${String(docs.size).padStart(7)} docs  ${cols}`,
    );
  }

  const buckets = new Map<string, Contract[][]>();
  for (const rs of a2) {
    const docs = rs.map((r) => {
      const [yr, d] = split(r.ocid);
      return dumps.get(yr)?.get(d);
    });
    let k: string;
    if (docs.some((d) => d === undefined)) {
      k = "UNMATCHED in the raw dump";
    } else {
      // `null` = the dump does not publish the column. It must NOT collapse into "they agree":
      // that is what filed 11 groups under "same поръчка" with nothing supporting it.
      const cmp = (f: keyof RawDoc, same: string, diff: string): string => {
        const vals = docs.map((d) => d![f]);
        if (vals.some((v) => v === null)) return `${f} UNKNOWN`;
        return new Set(vals).size > 1 ? diff : same;
      };
      k =
        cmp("proc", "same поръчка", "DIFFERENT поръчка") +
        " · " +
        cmp("pub", "same pub date", "different pub date");
    }
    const a = buckets.get(k);
    if (a) a.push(rs);
    else buckets.set(k, [rs]);
  }

  console.log(`\nA2 against the raw dumps — what the corpus key cannot see:`);
  for (const [k, v] of [...buckets].sort((a, b) => b[1].length - a[1].length))
    console.log(
      `  ${k.padEnd(52)} ${String(v.length).padStart(4)} groups  €${eur(tot(v))}`,
    );

  const differing = [...buckets]
    .filter(([k]) => k.startsWith("DIFFERENT поръчка"))
    .flatMap(([, v]) => v);
  const unknown = [...buckets]
    .filter(([k]) => k.includes("UNKNOWN"))
    .flatMap(([, v]) => v);
  console.log(
    `\n→ ${differing.length} of ${a2.length} groups (€${eur(tot(differing))}) are TWO DIFFERENT ` +
      `procurements that happen to\n  share a contract number, value, signing date and subject. ` +
      `They are NOT duplicates, and they are the\n  shape whose eviction destroyed 46 legitimate ` +
      `rows / €5.15m before.` +
      (unknown.length
        ? `\n\n  ${unknown.length} group(s) (€${eur(tot(unknown))}) are UNDECIDABLE from the raw ` +
          `dumps — the file publishes\n  no procurement identifier at all. They are not evidence ` +
          `of duplication either way.`
        : ""),
  );
};

main();
