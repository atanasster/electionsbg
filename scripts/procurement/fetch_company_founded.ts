// Backfill company incorporation dates → the `company_founded` PG table, for the
// newFirmWinner risk flag. Source: the Registry Agency CR API
//   GET https://portal.registryagency.bg/CR/api/Deeds/{eik}   (no auth, no CAPTCHA)
// The initial-entry date is min(fieldEntryDate) over the whole deed tree.
// ⚠️ Fetched via `curl` (child_process), NOT Node fetch: the host TLS-
// fingerprints and 500s undici but serves curl 200 (verified 2026-07-18).
//
// ⚠️ Rate limit ≈ 1 token / ~5s per IP (HTTP 429, no Retry-After). We pace at
// 1 req / 5s with exponential backoff on 429 and a retry on the occasional empty
// body. The full contractor set is ~28k EIKs ⇒ ~39h — run it unattended.
//
// ⚠️ A date == 2008 is the ТР re-registration date (register launched
// 2008-01-01), not true founding — recorded as-is; harmless for newFirmWinner
// (such firms are old and never fire).
//
// Resumable: skips EIKs already in company_founded. Idempotent upsert.
//
//   tsx scripts/procurement/fetch_company_founded.ts --limit 40      # sample
//   tsx scripts/procurement/fetch_company_founded.ts --since 2023-01-01
//   tsx scripts/procurement/fetch_company_founded.ts --eiks 200859512,121587769
//   tsx scripts/procurement/fetch_company_founded.ts                 # full backfill

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { allRows, withClient, end } from "../db/lib/pg";

const pexec = promisify(execFile);

const DEEDS_URL = (eik: string) =>
  `https://portal.registryagency.bg/CR/api/Deeds/${eik}`;
const PACE_MS = 5000; // 1 req / 5s per the measured token bucket
const MAX_RETRY = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Collect every `fieldEntryDate` (and `recordMinActionDate`) string in the tree
// and return the minimum's date part (YYYY-MM-DD), or null.
const minEntryDate = (root: unknown): string | null => {
  let min: string | null = null;
  const walk = (v: unknown): void => {
    if (v == null) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (
          (k === "fieldEntryDate" || k === "recordMinActionDate") &&
          typeof val === "string" &&
          /^\d{4}-\d\d-\d\d/.test(val)
        ) {
          const d = val.slice(0, 10);
          if (min === null || d < min) min = d;
        } else {
          walk(val);
        }
      }
    }
  };
  walk(root);
  return min;
};

// One EIK → founding date (or null when the register has no dated record).
// ⚠️ MUST use curl, not Node's fetch: the CR host TLS-fingerprints and returns
// HTTP 500 to undici (verified) but 200 to curl. `-w \n%{http_code}` appends the
// status as a trailing line so we can detect 429/500 without --fail eating the body.
const fetchFounded = async (eik: string): Promise<string | null> => {
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    let out: string;
    try {
      const { stdout } = await pexec(
        "curl",
        ["-s", "-m", "30", "-w", "\n%{http_code}", DEEDS_URL(eik)],
        { maxBuffer: 10_000_000 },
      );
      out = stdout;
    } catch {
      await sleep(PACE_MS * (attempt + 1));
      continue;
    }
    const nl = out.lastIndexOf("\n");
    const status = Number(out.slice(nl + 1).trim());
    const body = out.slice(0, nl);
    if (status === 429) {
      await sleep(PACE_MS * Math.pow(2, attempt)); // exp backoff from ~5s
      continue;
    }
    if (status !== 200) return null;
    if (!body.trim()) {
      await sleep(PACE_MS); // transient empty body — one retry
      continue;
    }
    try {
      return minEntryDate(JSON.parse(body));
    } catch {
      return null;
    }
  }
  return null;
};

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const main = async () => {
  const explicit = arg("eiks");
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const since = arg("since"); // only contractors with a contract on/after this date

  let eiks: string[];
  if (explicit) {
    eiks = explicit
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    // Distinct contractor EIKs from the contracts corpus, newest-contract first
    // (most likely to be genuinely-recent firms) — skipping ones already fetched.
    const rows = await allRows<{ contractor_eik: string }>(
      `SELECT contractor_eik
         FROM contracts
        WHERE tag='contract' AND contractor_eik ~ '^[1-9][0-9]{8}$'
          ${since ? "AND date >= $1" : ""}
          AND contractor_eik NOT IN (SELECT eik FROM company_founded)
        GROUP BY contractor_eik
        ORDER BY max(date) DESC
        ${limit ? `LIMIT ${Number(limit)}` : ""}`,
      since ? [since] : [],
    );
    eiks = rows.map((r) => r.contractor_eik);
  }

  console.log(`→ fetching founding dates for ${eiks.length} EIK(s)…`);
  let ok = 0;
  let nulls = 0;
  for (let i = 0; i < eiks.length; i++) {
    const eik = eiks[i];
    const founded = await fetchFounded(eik);
    await withClient((c) =>
      c.query(
        `INSERT INTO company_founded (eik, founded_date, source, fetched_at)
         VALUES ($1, $2, 'registryagency:CR/Deeds', now())
         ON CONFLICT (eik) DO UPDATE
           SET founded_date = EXCLUDED.founded_date,
               source = EXCLUDED.source, fetched_at = now()`,
        [eik, founded],
      ),
    );
    if (founded) ok++;
    else nulls++;
    if ((i + 1) % 10 === 0 || i === eiks.length - 1)
      console.log(`  ${i + 1}/${eiks.length} (${ok} dated, ${nulls} null)`);
    if (i < eiks.length - 1) await sleep(PACE_MS);
  }
  console.log(`✓ done — ${ok} dated, ${nulls} null`);
  await end();
};

main();
