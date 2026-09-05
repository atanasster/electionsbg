// Text decoding for the five presidential eras — the one place that knows a ЦИК
// bundle's bytes are not UTF-8, and the reason each reader must say which encoding it
// expects.
//
// ⚠ THE FAILURE MODE IS SILENT AND IT HAS BITTEN THIS REPO BEFORE. Decoding
// windows-1251 or MIK bytes as UTF-8 does not throw — it yields mojibake that passes
// every row count, every column count and every numeric assertion, because the
// numbers are ASCII and only the NAMES are wrong. The АОП experts ingest stored a
// whole corpus that way (`Response.text()` decodes UTF-8 always, whatever the
// Content-Type says). So each era declares its encoding in `sources.ts`, every reader
// decodes through this module, and the fixture tests assert a real Cyrillic name
// rather than a row count.
//
// The three encodings, measured against the committed trees:
//
//   utf8     2016 and 2021. Some 2016 files carry a BOM and some do not — it varies
//            per file within one bundle — so the BOM is stripped, never assumed.
//   cp1251   2006 and 2011. `TextDecoder("windows-1251")` handles it (Node ships a
//            full ICU).
//   mik      2001 only, and no standard decoder knows it: `iconv` has no name for it.

/** The encodings the presidential bundles are published in. */
export type PresidentialEncoding = "utf8" | "cp1251" | "mik";

const BOM = "\uFEFF";
/** The UTF-8 BOM as BYTES — the only form recognisable before decoding. */
const UTF8_BOM_BYTES = [0xef, 0xbb, 0xbf] as const;

// ⚠ Constructed ONCE, and eagerly, so a build without the legacy encodings fails with
// a sentence about the build rather than with `RangeError: The "windows-1251"
// encoding is not supported` thrown from somewhere inside a parser. Official Node
// builds ship a full ICU and support it; `--with-intl=small-icu` and some
// system-ICU distributions do not.
let cp1251Decoder: TextDecoder;
try {
  cp1251Decoder = new TextDecoder("windows-1251");
} catch {
  throw new Error(
    "This Node build cannot decode windows-1251, which the 2006 and 2011 " +
      "presidential bundles are published in. It was built without full ICU " +
      "(--with-intl=small-icu, or a system ICU lacking legacy encodings). Use an " +
      "official Node build, or set NODE_ICU_DATA to a full-icu dataset.",
  );
}

/** Drop a UTF-8 BOM from the BYTES.
 *
 *  ⚠ This is the only place a BOM is removable when the file is NOT UTF-8, and the
 *  reason `stripBom` alone is not enough: `windows-1251` decodes `EF BB BF` to the
 *  three characters „п»ї" rather than to U+FEFF, so a decoded-string check cannot see
 *  it; and `decodeMik` THROWS on `0xEF` before any string exists. No committed
 *  2001/2006/2011 file carries one today (all 20 checked) — this closes the gap
 *  rather than fixing a live defect. */
const stripBomBytes = (bytes: Uint8Array): Uint8Array =>
  bytes.length >= 3 && UTF8_BOM_BYTES.every((b, i) => bytes[i] === b)
    ? bytes.subarray(3)
    : bytes;

// A 256-entry table built once: index by byte, get the character or `null` for the
// pseudo-graphics range. Keeps the per-byte arithmetic out of the hot loop, which
// matters if the Tier 9 pre-2003 archives arrive.
const MIK_TABLE: (string | null)[] = Array.from({ length: 256 }, (_, b) =>
  b < 0x80
    ? String.fromCharCode(b)
    : b <= 0xbf
      ? String.fromCharCode(0x410 + (b - 0x80))
      : null,
);

/**
 * Decode MIK (МИК), the Bulgarian DOS code page the 2001 „Деметра" archive is
 * published in.
 *
 * The mapping is 64 contiguous bytes onto the 64 contiguous Cyrillic letters:
 * `0x80–0xBF` → `U+0410–U+044F` (А…Я а…я). Below `0x80` it is ASCII.
 *
 * ⚠ IT IS NOT CP866, AND CP866 IS THE TRAP RATHER THAN A FALLBACK. The two agree on
 * `0x80–0xAF` (А…п) and diverge exactly where cp866 puts box-drawing: `0xB0` is `р`
 * here and `░` there. So a cp866 read of these files produces text that looks 75%
 * right — „Избо░и за п░езиден▓" — which is precisely the shape that gets committed
 * and only noticed months later.
 *
 * @param bytes - Raw file bytes.
 * @param opts.onUnmapped - What to do with a byte above `0xBF`, which MIK uses for
 *   pseudo-graphics and which therefore cannot appear in text. Default `"throw"`,
 *   because such a byte means the file is NOT MIK — decoding it anyway is the silent
 *   mojibake this module exists to prevent. Measured: the entire committed 2001
 *   corpus (111,437 high bytes across both rounds) uses `0x80–0xBF` and nothing
 *   above, so the strict default costs nothing today.
 * @returns The decoded string.
 */
export const decodeMik = (
  bytes: Uint8Array,
  opts: { onUnmapped?: "throw" | "replace" } = {},
): string => {
  const { onUnmapped = "throw" } = opts;
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    // 0x80 → U+0410 (А); the two ranges are the same length and in the same order,
    // so the whole alphabet is one offset. MIK_TABLE precomputes it.
    const ch = MIK_TABLE[bytes[i]];
    if (ch !== null) {
      out.push(ch);
    } else if (onUnmapped === "replace") {
      out.push("\uFFFD");
    } else {
      throw new Error(
        `decodeMik: byte 0x${bytes[i].toString(16)} at offset ${i} is above 0xBF — ` +
          `MIK uses that range for pseudo-graphics, so this file is probably not MIK`,
      );
    }
  }
  return out.join("");
};

/**
 * Decode windows-1251, the encoding of the 2006 and 2011 bundles.
 *
 * @param bytes - Raw file bytes.
 * @returns The decoded string, BOM stripped if one is present.
 */
export const decodeCp1251 = (bytes: Uint8Array): string =>
  cp1251Decoder.decode(stripBomBytes(bytes));

/**
 * Remove a leading byte-order mark.
 *
 * ⚠ THE HAZARD IS STRING IDENTITY, NOT NUMERIC PARSING. `Number("\uFEFF13")` is 13,
 * not `NaN` — U+FEFF is JS whitespace, so every numeric coercion tolerates it. What
 * does not tolerate it is equality, and a ticket number is a JOIN KEY: an unstripped
 * BOM rides on the FIRST FIELD of the first row, so the candidates file's
 * `"\uFEFF13"` never matches the votes file's `"13"` and that ticket drops out of the
 * join with every row count still reconciling.
 * `cik_candidates_13.11.2016.txt` really does begin with one, while its round-1
 * sibling does not — the BOM varies per file within one bundle, so it is stripped
 * rather than assumed either way.
 *
 * `TextDecoder("utf-8")` already strips it, so `decodeBundleText` is safe on its own;
 * this exists for the readers that do not — an `ignoreBOM: true` decode, a
 * `Buffer.toString()`, a hand-concatenated string.
 *
 * ⚠ It CANNOT help the two non-UTF-8 paths, whatever it looks like: cp1251 decodes a
 * BOM to „п»ї" and MIK throws on `0xEF`, so neither ever produces a U+FEFF for this
 * to find. Those paths strip on the BYTES instead (`stripBomBytes`).
 */
export const stripBom = (text: string): string =>
  text.startsWith(BOM) ? text.slice(BOM.length) : text;

/**
 * Decode a bundle file according to its era's declared encoding.
 *
 * @param bytes - Raw file bytes.
 * @param encoding - From the cycle's entry in `sources.ts`; never guessed per file.
 * @returns The decoded text, BOM stripped.
 */
export const decodeBundleText = (
  bytes: Uint8Array,
  encoding: PresidentialEncoding,
): string => {
  switch (encoding) {
    case "utf8":
      return stripBom(new TextDecoder("utf-8").decode(bytes));
    case "cp1251":
      return decodeCp1251(bytes);
    case "mik":
      // Byte-level, because 0xEF would otherwise throw before any string exists.
      return decodeMik(stripBomBytes(bytes));
    default: {
      // Exhaustiveness: a new era's encoding must be handled here rather than
      // falling through to a UTF-8 read that produces mojibake.
      const never: never = encoding;
      throw new Error(`Unknown presidential encoding: ${String(never)}`);
    }
  }
};

/**
 * Split decoded bundle text into `;`-separated rows.
 *
 * ⚠ Line endings are BOTH: the published files are CRLF, and `core.autocrlf = input`
 * rewrites them to LF in the committed blobs — so a fresh clone reads LF and the
 * developer machine that downloaded them reads CRLF. A reader that splits on `\r\n`
 * alone yields one giant row on CI; one that splits on `\n` alone leaves a trailing
 * `\r` on the last field of every row, which then fails `Number()` for a numeric
 * column and compares unequal for a text one. See the plan's §1.1.
 *
 * ⚠ THE NAIVE `split(";")` IS CORRECT HERE, and that is a measurement rather than an
 * assumption — it is the first thing a reader doubts. Scanned across all five trees in
 * their declared encodings: ZERO quote-wrapped fields and ZERO semicolons inside
 * quotes, with a uniform field count per row in every data file (2006 protocols 24
 * fields × 11,809 rows; 2011 votes 38 × 11,784; 2016 votes 107 × 12,340). Quote
 * CHARACTERS do occur inside field text — `БДС "Радикали", БДФ` in the 2011 candidates
 * — but they never delimit a field, so a CSV parser is not needed and would in fact
 * mis-read that row.
 *
 * @param text - Decoded file contents.
 * @returns One array of fields per non-empty line. Empty leading and trailing FIELDS
 *   are preserved — the 2011 sections rows begin with one and the 2006 protocol rows
 *   end with one; only empty LINES are dropped.
 */
export const parseSemicolonRows = (text: string): string[][] =>
  text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(";"));
