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
// text Postgres's input function expects, then escape the four text-format
// metacharacters (backslash, newline, CR, and the tab delimiter). Round-trip
// verified in scripts/db/tests/copy.data.test.ts, which runs under `test:data`.

import { from as copyFrom, type CopyStreamQuery } from "pg-copy-streams";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { PoolClient } from "pg";

/** Flush the encoded buffer once it reaches this many characters. Sized in BYTES
 *  rather than rows because row width varies ~50× across the callers (a tr_officers
 *  row is a few dozen chars; a contracts row averages ~2.5 KB), so a row-count
 *  block would make the in-flight volume swing by the same factor — the exact
 *  thing this constant exists to bound. */
const FLUSH_BYTES = 1 << 20; // 1 MiB of encoded text per stream write

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
 *                `-0` is special-cased: String(-0) is "0", which would silently
 *                drop the sign bit.
 * - boolean    → "true"/"false" (bool input accepts these). Note the loaders also
 *                feed integer 0/1 into boolean columns (ngo_details.public_benefit,
 *                straight from SQLite); those take the number branch and emit
 *                "0"/"1", which Postgres' boolin also accepts. Pinned by a test.
 * - object     → JSON. **jsonb columns only.** A JS array renders as a JSON array
 *                (`["a","b"]`), which is NOT valid input for a Postgres array
 *                column (`text[]` wants `{a,b}`), and a Buffer/TypedArray is not
 *                valid `bytea` input. Both would corrupt silently, so typed arrays
 *                throw here; a plain array bound for `text[]` is still the caller's
 *                responsibility (no column in these tables has one).
 * - bigint     → String (no precision loss through Number).
 */
const render = (v: unknown): string => {
  if (v === null || v === undefined) return "\\N";
  if (v instanceof Date) return escapeText(v.toISOString());
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    if (ArrayBuffer.isView(v))
      throw new TypeError(
        "copyRows: bytea / typed-array values are not supported — encode them yourself",
      );
    return escapeText(JSON.stringify(v));
  }
  return escapeText(String(v));
};

/**
 * COPY `rows` into `table`(`cols`). Caller owns the transaction — this issues no
 * BEGIN/COMMIT, so it composes with the loaders' existing TRUNCATE+load txn.
 *
 * `rows` is an `Iterable`, not an array, so a caller can hand over a lazy view
 * (`function* () { for (const r of src) yield toRow(r) }`) and never materialize a
 * second copy of the corpus. Rows are consumed strictly in order and never
 * revisited. Memory in flight is bounded by FLUSH_BYTES plus the stream's own
 * queue, not by the table size.
 *
 * Returns the row count the SERVER confirms it ingested, and throws if that
 * disagrees with what we framed — the whole point of this module is that the
 * bytes we send become exactly the rows Postgres stores, so it is worth one
 * comparison per load rather than a tautological `return rows.length`.
 */
export const copyRows = async (
  c: PoolClient,
  table: string,
  cols: string[],
  rows: Iterable<unknown[]>,
): Promise<number> => {
  const stream: CopyStreamQuery = c.query(
    copyFrom(`COPY ${table} (${cols.join(",")}) FROM STDIN`),
  );

  let sent = 0;
  const source = Readable.from(
    (function* () {
      let buf = "";
      for (const row of rows) {
        buf += row.map(render).join("\t") + "\n";
        sent++;
        if (buf.length >= FLUSH_BYTES) {
          yield buf;
          buf = "";
        }
      }
      if (buf) yield buf;
    })(),
  );

  await pipeline(source, stream);

  // A zero-row COPY is a valid no-op against Postgres (verified), so there is no
  // early-return guard to skip — an empty iterable simply streams nothing.
  const accepted = stream.rowCount;
  if (accepted !== sent)
    throw new Error(
      `COPY ${table}: framed ${sent} row(s), server accepted ${accepted}`,
    );
  return accepted;
};
