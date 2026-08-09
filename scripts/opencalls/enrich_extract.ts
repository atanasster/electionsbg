// Stage 7, step 1–2 — prepare one procedure for extraction, and validate what comes back.
//
//   npm run opencalls:enrich -- --list                 what still needs enrichment
//   npm run opencalls:enrich -- --key isun:<guid>      fetch the doc, write the worksheet
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE MODEL IS THE AGENT RUNNING THE SKILL, NOT AN API CALL FROM THIS SCRIPT. That is the whole
// reason Stage 7 is a skill (plan §8.3.7) rather than a step inside `update-open-calls`: reading
// a 52-page „Условия за кандидатстване" costs tokens per document and must not happen on a cron.
// So this script does the two deterministic halves — fetch the text, then check the answer — and
// leaves the reading to the skill. There is no API key here and none is wanted.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// WHY A WORKSHEET FILE rather than stdout. The document text is 50–150 KB; piping it through a
// terminal transcript is wasteful and lossy. The worksheet is written to `scratch/opencalls/`
// (gitignored) so the agent reads exactly the bytes the gate will later check its quotes
// against — the same string, not a re-fetch. A re-fetch would be a different extraction of the
// same PDF, and every quote could then fail for a reason nobody could see.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { allRows, end } from "../db/lib/pg";
import { fetchDoc, pickDoc, DOC_PREFERENCE } from "./enrich_fetch";
import { MIN_QUOTE_CHARS } from "./enrich_gate";
import { AUDIENCES } from "./types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCRATCH_DIR = path.resolve(HERE, "../../scratch/opencalls");

export interface Candidate {
  source_key: string;
  title: string;
  source_url: string;
  docs: { label: string; url: string }[];
}

/**
 * Procedures whose money is still unknown.
 *
 * `enrichment = 'none'` only — NOT `'auto'`, which is already extracted and waiting for a human,
 * and never `'source'`/`'reviewed'`, which would mean re-deriving a figure a person already
 * signed off. Re-running the skill must be cheap and idempotent, which it only is if the queue
 * shrinks as work lands.
 */
export const CANDIDATES_SQL = `
  SELECT source_key, title, source_url, docs
    FROM open_calls
   WHERE source = 'isun'
     AND enrichment = 'none'
     AND jsonb_array_length(docs) > 0
   ORDER BY COALESCE(closes_at, 'infinity'::timestamptz), source_key
`;

/** One sanitiser, used by both the worksheet path and the answer path the worksheet prints.
 *  Two copies of it meant the instructions could name a file the reader never writes to. */
export const scratchSlug = (sourceKey: string): string =>
  sourceKey.replace(/[^a-z0-9]+/gi, "_");

export const worksheetPath = (sourceKey: string): string =>
  path.join(SCRATCH_DIR, `${scratchSlug(sourceKey)}.md`);

export const proposalPath = (sourceKey: string): string =>
  path.join(SCRATCH_DIR, `${scratchSlug(sourceKey)}.json`);

/** The instruction block the agent reads. Kept next to the gate so the two cannot drift. */
export const WORKSHEET_RULES = `## Rules — read before extracting

1. **Every field needs a verbatim QUOTE from the document text below.** Not a summary of it,
   not a re-typing of it: a span you can find by searching this file. A field you cannot quote
   is OMITTED. Omitting is the correct, expected outcome for most fields on most documents.
2. **Quote the SENTENCE, not the number.** A quote shorter than ${MIN_QUOTE_CHARS} characters is
   rejected outright — "5 000" occurs in any long document by accident and proves nothing. The
   quote must also STATE the value: a real sentence with a number that is not the one you claim
   is rejected too, and that is the check that catches a figure recalled rather than read.
3. **Currency.** Every \`_eur\` field must be supported by a quote that is in EURO. Bulgaria
   adopted the euro on 2026-01-01 and older documents state levs; a correctly-quoted lev figure
   stored as euro is a grounded lie and is the single most likely way a wrong number ships. If
   the document gives levs only, either quote a sentence that also names the euro figure, or
   omit the field. Do NOT convert and quote the lev sentence.
4. **\`audience\`** is derived from the eligibility text, so it survives only if
   \`beneficiaries\` does. Allowed values: ${AUDIENCES.join(", ")}.
5. Nothing here is published by writing this file. It goes through
   \`scripts/opencalls/enrich_gate.ts\`, which re-checks every quote mechanically, and then to a
   human. Guessing is not rewarded — it is caught and reported.`;

export const buildWorksheet = (
  c: Candidate,
  doc: { label: string; filename: string; url: string },
  text: string,
): string =>
  `# ${c.title}

- key: \`${c.source_key}\`
- procedure: ${c.source_url}
- document: **${doc.label}** (${doc.filename || "no filename"})
- document URL: ${doc.url}
- extracted characters: ${text.length}

${WORKSHEET_RULES}

## Write your answer to \`${path.relative(process.cwd(), proposalPath(c.source_key))}\`

\`\`\`json
{
  "source_key": ${JSON.stringify(c.source_key)},
  "doc_url": ${JSON.stringify(doc.url)},
  "budget_eur":    { "value": 0, "quote": "" },
  "aid_rate_pct":  { "value": 0, "quote": "" },
  "grant_min_eur": { "value": 0, "quote": "" },
  "grant_max_eur": { "value": 0, "quote": "" },
  "beneficiaries": { "value": "", "quote": "" },
  "audience": []
}
\`\`\`

Delete every key you cannot quote. An object with only \`beneficiaries\` is a good answer; an
object with all five fields and one invented quote is a bad one.

---

## Document text (the gate checks quotes against EXACTLY this)

${text}
`;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const keyArg = argv.indexOf("--key");
  if (keyArg >= 0 && !argv[keyArg + 1]) {
    // Silently listing instead would look like the key was not in the queue — the one message
    // that sends someone hunting through the database rather than at their own command line.
    console.error(
      "--key needs a source_key (see: npm run opencalls:enrich -- --list)",
    );
    process.exitCode = 1;
    return;
  }
  const wantKey = keyArg >= 0 ? argv[keyArg + 1] : undefined;

  const rows = await allRows<Candidate>(CANDIDATES_SQL);

  if (!wantKey) {
    console.log(
      `${rows.length} ИСУН procedures with enrichment='none' and at least one document\n`,
    );
    for (const r of rows) {
      const pick = pickDoc(r.docs ?? []);
      console.log(
        `  ${r.source_key}  ${pick ? `[${pick.label}]` : "[NO USABLE DOC]"}  ${r.title.slice(0, 70)}`,
      );
    }
    if (rows.length)
      console.log(
        `\nPreference order: ${DOC_PREFERENCE.join(" › ")}\n` +
          `Next: npm run opencalls:enrich -- --key ${rows[0].source_key}`,
      );
    return;
  }

  const row = rows.find((r) => r.source_key === wantKey);
  if (!row) {
    // Not an error worth a stack trace: the usual cause is that this procedure is already
    // enriched, which is a completed state rather than a failure.
    console.log(
      `${wantKey} is not in the queue — already enriched, or it publishes no documents.`,
    );
    return;
  }

  const pick = pickDoc(row.docs ?? []);
  if (!pick) {
    console.log(
      `${wantKey}: no document matches the preference order (${DOC_PREFERENCE.join(", ")}).\n` +
        `Published: ${(row.docs ?? []).map((d) => d.label).join(" | ") || "none"}`,
    );
    return;
  }

  const doc = await fetchDoc(pick);
  if (!doc.text) {
    console.log(`${wantKey}: ${doc.kind} — ${doc.skipReason}`);
    return;
  }

  mkdirSync(SCRATCH_DIR, { recursive: true });
  const out = worksheetPath(row.source_key);
  writeFileSync(out, buildWorksheet(row, doc, doc.text), "utf8");
  console.log(
    `${row.source_key}: ${doc.kind}, ${doc.bytes} bytes → ${doc.text.length} chars of text\n` +
      `Worksheet: ${path.relative(process.cwd(), out)}`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => end());
