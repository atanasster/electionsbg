#!/usr/bin/env node
// One-shot: minify every .json file under public/ in place.
//
// Why: Vite copies public/ verbatim; nothing in the build pipeline strips
// whitespace from data JSON. Several writers in scripts/ default to
// `JSON.stringify(o, null, 2)`, so a chunk of public/ ships pretty-printed.
// Aggregate sample showed ~28% raw savings (~7% post-gzip) plus a real
// browser parse-time win on big files like parliament/connections.json.
//
// Idempotent: files that are already minified are skipped (no rewrite,
// so mtime/size unchanged → next gsutil rsync skips them too).
//
// Safe: any file that fails JSON.parse is left alone with a warning.

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, relative } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const PUBLIC = resolve(ROOT, "public");

console.log(`Scanning ${PUBLIC} for .json files...`);

const files = execSync(`find "${PUBLIC}" -type f -name "*.json"`, {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024, // half-million paths fits comfortably
})
  .trim()
  .split("\n")
  .filter(Boolean);

console.log(`Found ${files.length.toLocaleString()} .json files. Minifying...\n`);

let processed = 0;
let rewritten = 0;
let bytesBefore = 0;
let bytesAfter = 0;
let parseErrors = 0;
const errorSamples = [];

const t0 = Date.now();
const progressEvery = Math.max(1, Math.floor(files.length / 20));

for (const file of files) {
  processed++;
  if (processed % progressEvery === 0) {
    const pct = ((processed / files.length) * 100).toFixed(0);
    process.stdout.write(`  ${pct}% (${processed.toLocaleString()}/${files.length.toLocaleString()})\r`);
  }

  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    continue;
  }
  if (!raw) continue;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    parseErrors++;
    if (errorSamples.length < 5) errorSamples.push(relative(ROOT, file));
    continue;
  }

  const minified = JSON.stringify(parsed);
  if (minified.length >= raw.length) continue; // already minified or no win

  bytesBefore += raw.length;
  bytesAfter += minified.length;
  writeFileSync(file, minified);
  rewritten++;
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const saved = bytesBefore - bytesAfter;
const pct = bytesBefore > 0 ? ((saved / bytesBefore) * 100).toFixed(1) : "0";

console.log(`\nDone in ${elapsed}s.`);
console.log(`  Processed:    ${processed.toLocaleString()}`);
console.log(`  Rewritten:    ${rewritten.toLocaleString()}`);
console.log(`  Skipped:      ${(processed - rewritten - parseErrors).toLocaleString()}  (already minified)`);
console.log(`  Parse errors: ${parseErrors.toLocaleString()}`);
if (errorSamples.length > 0) {
  console.log(`    samples:    ${errorSamples.join(", ")}`);
}
console.log(`  Saved:        ${formatBytes(saved)}  (${pct}% of touched files)`);

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
