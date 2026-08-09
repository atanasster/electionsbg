// Stage 7, steps 3–5 — gate a proposal, show the review queue, write `auto`, promote to
// `reviewed`.
//
//   npm run opencalls:enrich-review                     gate every proposal, print the queue
//   npm run opencalls:enrich-review -- --apply          … and store the survivors as 'auto'
//                                                       (a proposal with NO survivor is left at
//                                                        'none', so it stays in the queue)
//   npm run opencalls:enrich-review -- --promote <key>  a human signs one off → 'reviewed'
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE OUTPUT IS A REVIEW QUEUE, NOT A WRITE (plan Stage 7.5). Even `--apply` does not publish a
// number: it stores the proposal at `enrichment='auto'`, which invariant 8 bars from every
// sortable and filterable money column. Only `--promote`, one key at a time, with a human
// reading the quotes, moves a figure into `budget_eur` & co. — and therefore into sorting,
// range filters and the tile's „€X общ бюджет".
//
// WHAT `auto` MAY WRITE, and why the list is shorter than the CHECK constraint's.
// 142's `open_calls_money_needs_provenance` bars only the four money columns, but this writer
// also leaves `audience` alone until promotion, for a reason the constraint cannot express:
// ИСУН rows already carry an audience derived from the title at crawl time (`audience.ts`).
// That is source-derived. Overwriting it with an unreviewed model inference would REPLACE a
// known-provenance value with a guess, in the one column the browse page facets on — a
// downgrade disguised as an enrichment. So `auto` writes `beneficiaries_raw` (a verbatim,
// gate-checked span) plus the meta, and nothing else.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// THE DOC TEXT COMES FROM THE WORKSHEET, NEVER A RE-FETCH. The gate's guarantee is „this quote
// occurs in the document the model read". Re-downloading the PDF would re-extract it — a
// different string for the same bytes if the extractor changes at all — and every quote could
// then fail for a reason nobody could see. If the worksheet is gone, the answer is to re-run
// `opencalls:enrich --key`, not to fetch here.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { allRows, end } from "../db/lib/pg";
import {
  runGate,
  valueSupportedByQuote,
  type Claim,
  type Extraction,
  type GateResult,
} from "./enrich_gate";
import { SCRATCH_DIR, scratchSlug, worksheetPath } from "./enrich_extract";

/** What the agent writes: an `Extraction` plus the two fields that identify it. */
export interface Proposal extends Extraction {
  source_key: string;
  doc_url: string;
  /** Optional, and NULL rather than guessed when absent — see `buildMeta`. */
  model?: string;
  extracted_at?: string;
}

export const MONEY_FIELDS = [
  "budget_eur",
  "aid_rate_pct",
  "grant_min_eur",
  "grant_max_eur",
] as const;

/** The worksheet's „## Document text" section — the exact string the model was shown. */
export const docTextFromWorksheet = (worksheet: string): string => {
  const marker = "## Document text";
  const at = worksheet.indexOf(marker);
  if (at === -1) return "";
  // Past the heading line and the parenthetical after it.
  const nl = worksheet.indexOf("\n", at);
  return nl === -1 ? "" : worksheet.slice(nl + 1);
};

/**
 * `enrichment_meta` for a gated proposal.
 *
 * The quotes are the point: at `auto` they are the ONLY thing a reader sees, and at `reviewed`
 * they are what a human checked. `rejected` is kept too — a proposal where four of five fields
 * were dropped is a signal about the document (or the model), and discarding that leaves the
 * next run to rediscover it.
 */
export const buildMeta = (
  p: Proposal,
  g: GateResult,
  gatedAt: string,
): Record<string, unknown> => ({
  // NULL, NOT A GUESS. Only the agent that read the document knows which model it was and when;
  // this process runs later and cannot observe either. Stamping this clock as `extracted_at`
  // and a literal as `model` would make provenance that is invented look like provenance that
  // was recorded — in the one blob whose entire job is to say where a number came from.
  model: p.model ?? process.env.ENRICH_MODEL ?? null,
  extracted_at: p.extracted_at ?? null,
  /** When the gate ran. This one IS observed here. */
  gated_at: gatedAt,
  doc_url: p.doc_url,
  quotes: Object.fromEntries(
    Object.entries(g.accepted)
      .filter(([, v]) => v && typeof v === "object" && "quote" in (v as Claim))
      .map(([k, v]) => [k, (v as Claim).quote]),
  ),
  values: Object.fromEntries(
    Object.entries(g.accepted)
      .filter(([, v]) => v && typeof v === "object" && "value" in (v as Claim))
      .map(([k, v]) => [k, (v as Claim).value]),
  ),
  rejected: g.rejected,
});

/** Read every proposal, reporting the bad ones instead of dying on the first.
 *
 *  A hand-written JSON file WILL sometimes have a trailing comma, and an exception thrown out of
 *  `.map` used to abort the whole queue before printing anything — so a nine-procedure review
 *  produced one stack trace and no output at all. */
const readProposals = (): { ok: Proposal[]; bad: string[] } => {
  if (!existsSync(SCRATCH_DIR)) return { ok: [], bad: [] };
  const ok: Proposal[] = [];
  const bad: string[] = [];
  for (const f of readdirSync(SCRATCH_DIR).filter((n) => n.endsWith(".json"))) {
    let parsed: Proposal;
    try {
      parsed = JSON.parse(
        readFileSync(path.join(SCRATCH_DIR, f), "utf8"),
      ) as Proposal;
    } catch (e) {
      bad.push(`${f}: ${(e as Error).message}`);
      continue;
    }
    if (!parsed?.source_key) {
      bad.push(`${f}: no source_key`);
      continue;
    }
    // THE FILENAME IS DERIVED FROM THE KEY, so a mismatch means the answer was written into
    // another procedure's file — which, before this check, enriched THAT procedure with this
    // one's figures. Every quote would still be grounded, because the gate reads the worksheet
    // named by the key inside the file.
    if (scratchSlug(parsed.source_key) !== f.replace(/\.json$/, "")) {
      bad.push(
        `${f}: source_key ${parsed.source_key} does not match the filename — ` +
          `this answer would be applied to a different procedure`,
      );
      continue;
    }
    ok.push(parsed);
  }
  return { ok, bad };
};

/**
 * The `auto` write. Exported so `enrich_apply.test.ts` asserts its guards rather than restating
 * them — the repo's `opencalls_alerts.ts` pattern.
 *
 * THREE GUARDS, each load-bearing:
 *  - `source = 'isun'` — `(source, source_key)` is the unique key, and `source_key` alone is
 *    not. A ДФЗ row could share a key shape and be silently overwritten.
 *  - `enrichment = 'none'` — never overwrite a promotion, or a 'source' provenance.
 *  - `RETURNING` — so the caller counts writes that happened, not writes it attempted.
 * The four money columns are absent by construction; 142's CHECK would reject them anyway.
 */
export const AUTO_WRITE_SQL = `
  UPDATE open_calls
     SET enrichment = 'auto',
         enrichment_meta = $2::jsonb,
         beneficiaries_raw = COALESCE($3, beneficiaries_raw)
   WHERE source = 'isun' AND source_key = $1 AND enrichment = 'none'
  RETURNING source_key`;

const fmt = (v: unknown): string =>
  typeof v === "number" ? v.toLocaleString("en-US") : String(v);

const review = async (apply: boolean): Promise<void> => {
  const { ok: proposals, bad } = readProposals();
  for (const b of bad) console.log(`SKIPPED ${b}`);
  if (!proposals.length) {
    console.log(
      `No proposals in ${path.relative(process.cwd(), SCRATCH_DIR)}.\n` +
        `Run: npm run opencalls:enrich -- --list`,
    );
    return;
  }

  const gatedAt = new Date().toISOString();
  let stored = 0;

  for (const p of proposals) {
    const ws = worksheetPath(p.source_key);
    if (!existsSync(ws)) {
      console.log(
        `\n${p.source_key}\n  SKIPPED — no worksheet at ${path.relative(process.cwd(), ws)}.` +
          ` The gate must check quotes against the text the model actually read;` +
          ` re-run: npm run opencalls:enrich -- --key ${p.source_key}`,
      );
      continue;
    }
    const docText = docTextFromWorksheet(readFileSync(ws, "utf8"));
    const g = runGate(p, docText);

    console.log(`\n${p.source_key}`);
    console.log(`  doc: ${p.doc_url}`);
    for (const [field, v] of Object.entries(g.accepted)) {
      if (field === "audience") {
        console.log(
          `  ✓ audience        ${(v as string[]).join(", ")}  (held until promotion)`,
        );
        continue;
      }
      const c = v as Claim;
      const held = (MONEY_FIELDS as readonly string[]).includes(field);
      console.log(
        `  ✓ ${field.padEnd(16)} ${fmt(c.value)}${held ? "   (held — invariant 8)" : ""}`,
      );
      console.log(
        `      „${c.quote.slice(0, 150)}${c.quote.length > 150 ? "…" : ""}"`,
      );
    }
    for (const f of g.unitUnstated)
      console.log(
        `  ⚠ ${f.padEnd(16)} the quote names NO currency — 3 of 4 sampled ИСУН documents are in ` +
          "levs, so check the document before promoting this one",
      );
    for (const r of g.rejected)
      console.log(`  ✗ ${r.field.padEnd(16)} ${r.reason}`);
    if (!Object.keys(g.accepted).length && !g.rejected.length)
      console.log(
        "  — the document states none of these figures (a normal outcome)",
      );

    if (!apply) continue;

    // NOTHING ACCEPTED → NOTHING WRITTEN, and the row stays at 'none'.
    //
    // Writing 'auto' here would retire the row for ever: the queue IS `enrichment = 'none'`, so
    // an empty extraction would remove the procedure from it while storing no value and leaving
    // no path back. That is reachable from an honest cause (a document stating no figures) and
    // from a dishonest one (an empty worksheet, or a mis-keyed proposal that would retire an
    // UNRELATED procedure), and the two are indistinguishable afterwards.
    if (!Object.keys(g.accepted).length) {
      console.log(
        "  → left at enrichment='none' — nothing was accepted, so there is nothing to store.",
      );
      continue;
    }

    // `beneficiaries_raw` is the one column `auto` may fill: verbatim, gate-checked, not
    // sortable. Everything else rides in the meta until a human promotes it.
    const benef = g.accepted.beneficiaries?.value;
    const written = await allRows<{ source_key: string }>(AUTO_WRITE_SQL, [
      p.source_key,
      JSON.stringify(buildMeta(p, g, gatedAt)),
      typeof benef === "string" && benef.trim() ? benef : null,
    ]);
    // RETURNING, not an optimistic counter. The WHERE has two guards and either can miss (a
    // stale key, a row already promoted), so „stored 6" with 0 writes was reachable.
    if (written.length) stored++;
    else
      console.log(
        "  → no row matched (already enriched, or not an ИСУН key) — nothing written.",
      );
  }

  if (apply)
    console.log(
      `\nStored ${stored} proposal(s) at enrichment='auto'. No money column was written.\n` +
        `Promote one after reading its quotes:\n` +
        `  npm run opencalls:enrich-review -- --promote <source_key>`,
    );
  else
    console.log(
      `\nReview only — nothing written. Add --apply to store these at enrichment='auto'.`,
    );
};

/**
 * The promotion write. Exported so a gate can assert its guards — same reason as `AUTO_WRITE_SQL`.
 *
 * `enrichment = 'auto'` in the WHERE is what makes this idempotent AND non-destructive: running
 * it twice is a no-op, and it can never overwrite a 'source' provenance the crawl owns.
 */
export const promoteSql = (money: readonly string[]): string => {
  const set = money.map((f, i) => `${f} = $${i + 2}`).join(", ");
  return `UPDATE open_calls
             SET enrichment = 'reviewed'${set ? `, ${set}` : ""}
           WHERE source = 'isun' AND source_key = $1 AND enrichment = 'auto'
          RETURNING source_key`;
};

/**
 * The human sign-off. Moves the gated values out of the meta and into the real columns.
 *
 * ONE KEY AT A TIME, BY DESIGN. A `--promote-all` would make the whole gate decorative: the
 * point of Stage 7 is that a figure reaches the site because a person read its quote, and a
 * flag that promotes fifty-five rows at once is not that person.
 */
const promote = async (key: string): Promise<void> => {
  const [row] = await allRows<{
    source_key: string;
    title: string;
    enrichment: string;
    enrichment_meta: {
      values?: Record<string, unknown>;
      quotes?: Record<string, string>;
      doc_url?: string;
    };
  }>(
    `SELECT source_key, title, enrichment, enrichment_meta
       FROM open_calls WHERE source = 'isun' AND source_key = $1`,
    [key],
  );
  if (!row) {
    console.log(`No open call with source_key = ${key}`);
    process.exitCode = 1;
    return;
  }
  if (row.enrichment !== "auto") {
    console.log(
      `${key} is enrichment='${row.enrichment}', not 'auto' — nothing to promote.` +
        (row.enrichment === "reviewed" ? " It is already signed off." : ""),
    );
    return;
  }

  const values = row.enrichment_meta?.values ?? {};
  const quotes = row.enrichment_meta?.quotes ?? {};
  const benef =
    typeof values.beneficiaries === "string" ? values.beneficiaries : null;

  // RE-GATE AT THE POINT OF PUBLICATION, against the quote stored alongside the value.
  //
  // The meta is not a trusted store: it can be hand-edited, and it can predate a change to the
  // gate itself. Re-checking here costs nothing and closes both — including the case the
  // reviewer found, where a value carrying NO quote at all was promoted into a live column
  // because `quotes[f] ?? ""` merely printed an empty line under it. This is the LAST mechanical
  // check before a number becomes sortable, and the only field-by-field one a human sees.
  const money: string[] = [];
  const refused: string[] = [];
  for (const f of MONEY_FIELDS) {
    if (typeof values[f] !== "number") continue;
    const q = quotes[f];
    if (typeof q !== "string" || !q.trim()) {
      refused.push(`${f}: no quote stored — cannot be published`);
      continue;
    }
    if (!valueSupportedByQuote(values[f] as number, q)) {
      refused.push(`${f}: the stored quote does not state ${fmt(values[f])}`);
      continue;
    }
    money.push(f);
  }

  console.log(`${row.title}\n  doc: ${row.enrichment_meta?.doc_url ?? "?"}\n`);
  for (const f of money)
    console.log(
      `  ${f.padEnd(16)} ${fmt(values[f])}\n      „${quotes[f] ?? ""}"`,
    );
  for (const r of refused) console.log(`  ✗ ${r}`);
  if (benef) console.log(`  beneficiaries    ${benef}`);
  if (!money.length && !benef) {
    // Nothing to sign off on. Leaving it at 'auto' keeps it in the queue, so a later run
    // against a better document can still fill it.
    console.log(
      "  Nothing gated survived — promoting would publish nothing. Left as 'auto'.",
    );
    return;
  }

  const promoted = await allRows<{ source_key: string }>(promoteSql(money), [
    key,
    ...money.map((f) => values[f] as number),
  ]);
  if (!promoted.length) {
    // The row moved between the SELECT and the UPDATE. Better to say so than to print a
    // success message for a write that did not land.
    console.log(
      `\n${key}: no row matched — it is no longer at enrichment='auto'.`,
    );
    process.exitCode = 1;
    return;
  }
  // Say what actually happened. A beneficiaries-only promotion is a REAL and common outcome —
  // „I read the document and it states no figures" is worth recording, because it stops the row
  // cycling through the queue for ever — but it releases nothing, and a message claiming
  // otherwise would be the one lie this whole pipeline exists to prevent.
  console.log(
    money.length
      ? `\n${key} → enrichment='reviewed'. ${money.length} money column(s) now live: ` +
          `sortable, filterable, and counted in the tile's total.`
      : `\n${key} → enrichment='reviewed'. NO money column was released — the document states ` +
          `none. The eligibility text stays; the call still shows „бюджет: не е обявен".`,
  );
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--promote");
  if (pi >= 0) {
    const key = argv[pi + 1];
    if (!key) {
      console.error("--promote needs a source_key");
      process.exitCode = 1;
      return;
    }
    await promote(key);
    return;
  }
  await review(argv.includes("--apply"));
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => end());
