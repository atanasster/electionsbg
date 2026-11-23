// Decoder for the НЗИС immunization info-app
// (his.bg/infoapps/immunization_bg/results-immunization_bg.html).
//
// The page is a self-contained "GUUT Data File": the whole dataset ships inside
// the HTML as two JS globals.
//
//   infoObject = {…}   column definitions per sheet (plain JSON)
//   infoData   = "…"   base64 → zlib → JSON of compressed sheets
//
// Each compressed sheet carries `data` and `strings`, both arrays of 10,000-char
// CHUNKS of an LZW stream. Three things are easy to get wrong, and each was
// measured on the real file (docs/plans/vaccines-flow-v1.md, T0):
//
//  1. The chunks are ONE stream. Concatenate them BEFORE decoding — an LZW
//     dictionary spans chunk boundaries, so decoding per chunk fails on the
//     first back-reference that crosses one.
//  2. Codes are 18 bits, packed as THREE base64url characters, little-endian
//     (the first character carries the low 6 bits). The dictionary resets once
//     it holds 2^18 − 2 entries (LZW_RESET_AT), and the code after a reset is a fresh
//     first code (it adds no entry). Without the reset the decode fails ~786k
//     characters in, i.e. 2.2M characters before the end of the data stream.
//  3. The decoded output is BYTES (codes 0–255), i.e. UTF-8 read as Latin-1.
//     Re-decode as UTF-8. One label ("Meningococcal vaccine (В)") is encoded
//     TWICE at the source, so a second, guarded pass repairs it.
//
// Each decoded data row is an array of indexes into the decoded `strings`
// array; `fieldIndex` maps the infoObject's `mapindex` to the position.

import { inflateSync } from "zlib";

const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_VALUE = (() => {
  const v = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64URL.length; i++) v[B64URL.charCodeAt(i)] = i;
  return v;
})();

export const LZW_CODE_BITS = 18;
/** The next-code value at which the dictionary resets. */
export const LZW_RESET_AT = (1 << LZW_CODE_BITS) - 2;

const sixBits = (s: string, p: number): number => {
  const c = s.charCodeAt(p);
  const v = c < 128 ? B64_VALUE[c] : -1;
  if (v < 0)
    throw new Error(
      `his_infoapp: invalid base64url character ${JSON.stringify(s[p])} at ${p}`,
    );
  return v;
};

/** Decode an LZW stream of 18-bit codes packed as three base64url characters
 *  (little-endian). Returns a "binary string" — one char per byte. */
export const lzwDecode = (
  stream: string,
  resetAt: number = LZW_RESET_AT,
): string => {
  if (stream.length % 3 !== 0)
    throw new Error(
      `his_infoapp: LZW stream length ${stream.length} is not a multiple of 3`,
    );
  let dict: string[] = [];
  const reset = () => {
    dict = new Array(256);
    for (let i = 0; i < 256; i++) dict[i] = String.fromCharCode(i);
  };
  reset();
  const out: string[] = [];
  let prev: string | null = null;
  for (let p = 0; p < stream.length; p += 3) {
    const code =
      sixBits(stream, p) |
      (sixBits(stream, p + 1) << 6) |
      (sixBits(stream, p + 2) << 12);
    if (prev === null) {
      if (code >= 256)
        throw new Error(
          `his_infoapp: first code after a reset must be a literal, got ${code} at ${p}`,
        );
      prev = dict[code];
      out.push(prev);
      continue;
    }
    let entry: string;
    if (code < dict.length) entry = dict[code];
    else if (code === dict.length) entry = prev + prev[0];
    else
      throw new Error(
        `his_infoapp: LZW code ${code} beyond dictionary (${dict.length}) at ${p}`,
      );
    out.push(entry);
    dict.push(prev + entry[0]);
    prev = entry;
    if (dict.length >= resetAt) {
      reset();
      prev = null;
    }
  }
  return out.join("");
};

/** Encoder mirror of `lzwDecode`. Test-only in practice: it lets the unit
 *  tests build streams that cross the dictionary reset without shipping a
 *  multi-megabyte fixture. */
export const lzwEncode = (binary: string, resetAt = LZW_RESET_AT): string => {
  const codes: number[] = [];
  let dict = new Map<string, number>();
  let next = 256;
  const reset = () => {
    dict = new Map();
    for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
    next = 256;
  };
  reset();
  let w = "";
  for (const ch of binary) {
    if (ch.charCodeAt(0) > 255)
      throw new Error("lzwEncode: input must be a binary (byte) string");
    const wc = w + ch;
    if (dict.has(wc)) {
      w = wc;
      continue;
    }
    codes.push(dict.get(w)!);
    // The decoder adds the entry for code k while reading code k+1, so the
    // code emitted once the dictionary is full is still read against the old
    // dictionary — and the one after it is a fresh literal that adds nothing.
    if (next >= resetAt) reset();
    else dict.set(wc, next++);
    w = ch;
  }
  if (w) codes.push(dict.get(w)!);
  let s = "";
  for (const c of codes)
    s += B64URL[c & 63] + B64URL[(c >> 6) & 63] + B64URL[(c >> 12) & 63];
  return s;
};

/** UTF-8 bytes held in a binary string → text. */
export const binaryToUtf8 = (binary: string): string =>
  Buffer.from(binary, "latin1").toString("utf8");

/** Repair a label that the source encoded twice („Ð\x92" → „В"). Only
 *  applied when the string looks like UTF-8 read as Latin-1 AND re-decodes
 *  without a replacement character, so real Latin-1 text is left alone. */
export const repairMojibake = (s: string): string => {
  if (!/[Â-ô][\u0080-¿]/.test(s)) return s;
  if ([...s].some((ch) => ch.charCodeAt(0) > 0xff)) return s;
  const fixed = Buffer.from(s, "latin1").toString("utf8");
  return fixed.includes("\uFFFD") ? s : fixed;
};

/** Find a JS assignment `name=` and return the balanced JSON literal (object)
 *  or the double-quoted string that follows it. */
const extractAssigned = (html: string, name: string): string => {
  const re = new RegExp(`\\b${name}\\s*=\\s*`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const start = m.index + m[0].length;
    const c = html[start];
    if (c === '"') {
      const end = html.indexOf('"', start + 1);
      if (end < 0) break;
      return html.slice(start + 1, end);
    }
    if (c === "{") {
      let depth = 0;
      for (let i = start; i < html.length; i++) {
        const ch = html[i];
        if (ch === '"') {
          for (i++; i < html.length && html[i] !== '"'; i++)
            if (html[i] === "\\") i++;
        } else if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) return html.slice(start, i + 1);
      }
    }
  }
  throw new Error(`his_infoapp: no ${name}= assignment found in the page`);
};

interface CompressedSheet {
  fieldIndex: Record<string, number>;
  data: string[] | unknown[];
  strings: string[] | unknown[];
  compressed?: boolean;
  dataencoded?: boolean;
  stringsencoded?: boolean;
}

interface ColumnDef {
  field: string;
  mapindex: string;
}

export interface DecodedSheet {
  /** Column name (`field`) → position in each row. */
  columns: Record<string, number>;
  rows: unknown[][];
}

const decodeArray = (chunks: unknown, encoded: boolean): unknown[] => {
  if (!Array.isArray(chunks))
    throw new Error("his_infoapp: sheet payload is not an array");
  if (!encoded) return chunks;
  const text = binaryToUtf8(lzwDecode((chunks as string[]).join("")));
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed))
    throw new Error("his_infoapp: decoded payload is not an array");
  return parsed;
};

/** Decode every sheet in the page into {columns, rows} with values resolved. */
export const decodeInfoApp = (html: string): Record<string, DecodedSheet> => {
  const infoObject = JSON.parse(extractAssigned(html, "infoObject")) as Record<
    string,
    { orgColumns?: { columns?: ColumnDef[] } }
  >;
  const infoData = JSON.parse(
    inflateSync(
      Buffer.from(extractAssigned(html, "infoData"), "base64"),
    ).toString("utf8"),
  ) as Record<string, CompressedSheet>;

  const out: Record<string, DecodedSheet> = {};
  for (const [name, sheet] of Object.entries(infoData)) {
    const strings = decodeArray(
      sheet.strings,
      sheet.stringsencoded !== false,
    ).map((v) => (typeof v === "string" ? repairMojibake(v) : v));
    const rawRows = decodeArray(sheet.data, sheet.dataencoded !== false);
    const columns: Record<string, number> = {};
    for (const col of infoObject[name]?.orgColumns?.columns ?? []) {
      const pos = sheet.fieldIndex[col.mapindex];
      if (pos !== undefined) columns[col.field] = pos;
    }
    const rows = rawRows.map((r, i) => {
      if (!Array.isArray(r))
        throw new Error(`his_infoapp: ${name} row ${i} is not an array`);
      return r.map((ix) => {
        if (typeof ix !== "number" || ix < 0 || ix >= strings.length)
          throw new Error(
            `his_infoapp: ${name} row ${i} has an out-of-range string index ${ix}`,
          );
        return strings[ix];
      });
    });
    out[name] = { columns, rows };
  }
  return out;
};

/** One НЗИС cell: month × oblast × age band × sex × vaccine. */
export interface HisImmunizationRow {
  /** 'YYYY-MM' */
  period: string;
  /** НЗИС's own oblast key (cl015_key, 1–28). */
  oblastKey: number;
  /** НЗИС's English oblast label ("Sofia City" ≠ "Sofia"). */
  region: string;
  /** e.g. "60 - 79", "80+" */
  ageBand: string;
  ageOrder: number;
  sex: "F" | "M";
  /** НЗИС's English vaccine label, verbatim. */
  vaccine: string;
  n: number;
  uniquePatients: number;
  /** НСИ population of the oblast × age band × sex cell. */
  population: number;
}

const REQUIRED = [
  "month",
  "cl015_key",
  "region",
  "age_group",
  "age_order",
  "gender",
  "vaccine",
  "number_of_immunizations",
  "unique_patients",
  "nsi_numbers",
] as const;

const toPeriod = (v: unknown): string => {
  const m = String(v).match(/^(\d{4})-(\d{2})/);
  if (!m) throw new Error(`his_infoapp: unreadable month ${JSON.stringify(v)}`);
  return `${m[1]}-${m[2]}`;
};

/** A count must be a number or a strictly numeric string — a blank, null or
 *  boolean cell is a shape change, not a zero. */
const toInt = (v: unknown, what: string): number => {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())
        ? Number(v)
        : NaN;
  if (!Number.isFinite(n) || n < 0)
    throw new Error(`his_infoapp: unreadable ${what} ${JSON.stringify(v)}`);
  return Math.round(n);
};

const toLabel = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !v.trim())
    throw new Error(`his_infoapp: unreadable ${what} ${JSON.stringify(v)}`);
  return v;
};

/** Decode the page and return the immunization cells. Throws on any shape
 *  change rather than returning a partial corpus. */
export const parseImmunizations = (html: string): HisImmunizationRow[] => {
  const sheets = decodeInfoApp(html);
  const sheet = Object.values(sheets).find((s) =>
    REQUIRED.every((c) => c in s.columns),
  );
  if (!sheet)
    throw new Error(
      `his_infoapp: no sheet carries the immunization columns (${REQUIRED.join(", ")})`,
    );
  const c = sheet.columns;
  return sheet.rows.map((r) => {
    const g = toLabel(r[c.gender], "gender");
    if (g !== "Female" && g !== "Male")
      throw new Error(`his_infoapp: unknown gender ${JSON.stringify(g)}`);
    return {
      period: toPeriod(r[c.month]),
      oblastKey: toInt(r[c.cl015_key], "cl015_key"),
      region: toLabel(r[c.region], "region"),
      ageBand: toLabel(r[c.age_group], "age_group"),
      ageOrder: toInt(r[c.age_order], "age_order"),
      sex: g === "Female" ? "F" : "M",
      vaccine: toLabel(r[c.vaccine], "vaccine"),
      n: toInt(r[c.number_of_immunizations], "number_of_immunizations"),
      uniquePatients: toInt(r[c.unique_patients], "unique_patients"),
      population: toInt(r[c.nsi_numbers], "nsi_numbers"),
    };
  });
};

export const HIS_INFOAPP_URL =
  "https://his.bg/infoapps/immunization_bg/results-immunization_bg.html";
