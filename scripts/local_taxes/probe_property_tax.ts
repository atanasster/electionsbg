// Probe for `extractPropertyTaxIndividualsRate` in lib/extract_naredba.ts.
//
// Runs the extractor against:
//   1. Every cached TAX naredba in raw_data/local_taxes/naredba/ that we
//      know how to read (the obshtini.bg JSON shape), and checks the
//      result against the município's publicly-published rate.
//   2. A handful of synthetic strings that pin down the pick-max
//      behavior — specifically that a "new-build promotional + standard"
//      multi-rate block surfaces the higher (standard) rate, not the
//      first-in-document-order promotional one.
//
// Invoke with:  npx tsx scripts/local_taxes/probe_property_tax.ts
// Exits non-zero if any expectation fails.

import fs from "node:fs";
import path from "node:path";

import { extractPropertyTaxIndividualsRate } from "./lib/extract_naredba";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const CACHE_DIR = path.join(PROJECT_ROOT, "raw_data/local_taxes/naredba");

const decodeHtmlEntities = (s: string): string =>
  s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16)),
    );

const stripHtmlTags = (s: string): string =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n");

const readObshtiniText = (file: string): string => {
  const json = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    paragraphs?: { text?: string }[];
  };
  if (!Array.isArray(json.paragraphs)) {
    throw new Error(`bad obshtini.bg JSON shape: ${file}`);
  }
  return json.paragraphs
    .map((p) => stripHtmlTags(decodeHtmlEntities(p.text ?? "")))
    .join("\n");
};

type CacheProbe = {
  name: string;
  file: string;
  expected: number | null;
  note: string;
};

const CACHE_PROBES: CacheProbe[] = [
  {
    name: "Sofia",
    file: "sof_tax.json",
    expected: 1.875,
    note: "Чл. 15 НОРМД — single rate, SOC Решение № 51 / Протокол № 5",
  },
];

type SyntheticProbe = {
  name: string;
  text: string;
  expected: number | null;
};

const SYNTHETIC_PROBES: SyntheticProbe[] = [
  {
    name: "single anchor + single in-band rate",
    text: "Размерът на данъка върху недвижимите имоти се определя в размер на 1,875 на хиляда върху данъчната оценка на недвижимия имот.",
    expected: 1.875,
  },
  {
    name: "two anchors + two rates — pick max wins",
    text:
      "За нови сгради размерът на данъка върху недвижимите имоти се определя в размер на 1,5 на хиляда върху данъчната оценка. " +
      "За съществуващи сгради размерът на данъка върху недвижимите имоти се определя в размер на 1,8 на хиляда върху данъчната оценка.",
    expected: 1.8,
  },
  {
    name: "rate without 'данъчна оценка' tail — rejected",
    text: "Данък върху недвижимите имоти се определя в размер на 1,8 на хиляда от стойността.",
    expected: null,
  },
  {
    name: "rate without 'недвижими имоти' anchor — rejected",
    text: "Туристически данък 1,8 на хиляда върху данъчната оценка.",
    expected: null,
  },
  {
    name: "out-of-band rate (10‰) — rejected",
    text: "Размерът на данъка върху недвижимите имоти се определя в размер на 10 на хиляда върху данъчната оценка.",
    expected: null,
  },
];

let failed = 0;
const fmt = (v: number | null): string => (v == null ? "null" : String(v));

console.log("== Cached naredba ==");
for (const probe of CACHE_PROBES) {
  const filePath = path.join(CACHE_DIR, probe.file);
  if (!fs.existsSync(filePath)) {
    console.log(`SKIP  ${probe.name} — ${probe.file} not in cache`);
    continue;
  }
  const text = readObshtiniText(filePath);
  const got = extractPropertyTaxIndividualsRate(text);
  const ok = got === probe.expected;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${probe.name} — expected ${fmt(probe.expected)}, got ${fmt(got)}  (${probe.note})`,
  );
}

console.log("\n== Synthetic ==");
for (const probe of SYNTHETIC_PROBES) {
  const got = extractPropertyTaxIndividualsRate(probe.text);
  const ok = got === probe.expected;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${probe.name} — expected ${fmt(probe.expected)}, got ${fmt(got)}`,
  );
}

if (failed > 0) {
  console.error(`\n${failed} probe(s) failed`);
  process.exit(1);
}
console.log("\nAll probes passed.");
