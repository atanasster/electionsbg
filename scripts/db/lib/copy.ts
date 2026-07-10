// Bulk load rows into Postgres with COPY … FROM STDIN instead of multi-row
// INSERT. Used by the loaders whose cost is dominated by shipping the table:
// tr_companies + tr_officers (1.76M rows / 506 MB), contracts (301k / 754 MB),
// tenders (126k / 353 MB).
//
// WHY: a multi-row INSERT sends every value as a bound parameter, caps at 65535
// params per statement (so the loaders chunk to ~6k rows), and pays per-row
// executor overhead. Over the Cloud SQL proxy that made `db:load:*:cloud` take
// ~30 min each regardless of how little changed. COPY streams one framed text
// payload and skips the executor path entirely.
//
// FORMAT: COPY *text* format, not CSV. In CSV an unquoted empty field and a NULL
// are indistinguishable without NULL '<sentinel>' games; text format spells NULL
// as an unescapable \N, so `""` (empty string) and NULL survive the round trip as
// distinct values. That matters here — plenty of these columns are text and
// nullable, and the INSERT path they replace preserved the distinction.
//
// ENCODING is per-column-type-agnostic: we render each JS value to the exact
// text Postgres's input function expects, then escape the five text-format
// metacharacters. Verified byte-identical against the INSERT path via table
// digests (see scripts/db/lib/__test_copy.ts).

import { from as copyFrom } from "pg-copy-streams";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { PoolClient } from "pg";

/**
 * Escape a rendered value for COPY text format.
 * Postgres treats backslash as the escape char and \N as NULL, so a literal
 * backslash MUST be doubled first — otherwise a name containing `\N` would be
 * read back as NULL. Order matters: backslash before the others.
 */
const escapeText = (s: string): string =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");

/**
 * Render one JS value to COPY-text. `null`/`undefined` → the NULL sentinel.
 *
 * - Date       → ISO 8601. String(Date) yields "Wed Jul 10 2026 …", which
 *                Postgres parses with a locale/DateStyle dependency. ISO does not.
 * - number     → String(n). JS prints the shortest representation that round-trips
 *                to the same IEEE-754 double, and float8's input function parses it
 *                back exactly. NaN/Infinity render as-is and float8 accepts both.
 * - boolean    → "true"/"false" (bool input accepts these).
 * - object     → JSON. Covers jsonb columns (tenders.lots) and array-shaped values.
 * - bigint     → String (no precision loss through Number).
 */
const render = (v: unknown): string => {
  if (v === null || v === undefined) return "\\N";
  if (v instanceof Date) return escapeText(v.toISOString());
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return escapeText(JSON.stringify(v));
  return escapeText(String(v));
};

/**
 * COPY `rows` into `table`(`cols`). Caller owns the transaction — this issues no
 * BEGIN/COMMIT, so it composes with the loaders' existing TRUNCATE+load txn.
 *
 * Backpressure is handled by `pipeline`: the Readable only produces the next
 * chunk when the COPY stream drains, so a 1M-row load never buffers the whole
 * payload in memory.
 */
export const copyRows = async (
  c: PoolClient,
  table: string,
  cols: string[],
  rows: unknown[][],
): Promise<number> => {
  if (rows.length === 0) return 0;

  const stream = c.query(
    copyFrom(`COPY ${table} (${cols.join(",")}) FROM STDIN`),
  );

  // Yield in blocks so we do a bounded number of stream writes rather than one
  // per row (a 1M-row load would otherwise be 1M tiny chunks).
  const BLOCK = 2000;
  const source = Readable.from(
    (function* () {
      for (let i = 0; i < rows.length; i += BLOCK) {
        const end = Math.min(i + BLOCK, rows.length);
        let buf = "";
        for (let r = i; r < end; r++)
          buf += rows[r].map(render).join("\t") + "\n";
        yield buf;
      }
    })(),
  );

  await pipeline(source, stream);
  return rows.length;
};
