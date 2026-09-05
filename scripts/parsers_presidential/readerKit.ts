// The three helpers every era reader needs, in one copy.
//
// Each ЦИК bundle has its own field map, its own file-naming rule and its own protocol
// logic — that part is genuinely per-era and lives in `eraNNNN.ts`. What is NOT per-era
// is finding a file, decoding it, coercing a cell to a number, and refusing a section
// code the sections file does not carry. Those were three near-identical copies across
// `era2011`/`era2016`/`era2021` (`num()` byte-identical in all three) with `era2006` and
// `era2001` still to be written, which is the shape where one copy quietly diverges from
// the other four and nothing reports it.
//
// ⚠ THE ENCODING IS A PARAMETER, NOT A LITERAL, AND THAT IS THE POINT. Each cycle
// DECLARES its encoding in `sources.ts` and `encoding.ts`'s banner states the contract:
// "each era declares its encoding in `sources.ts`, every reader decodes through this
// module". Only the second half used to be true — all three readers passed a hardcoded
// literal, so the declaration and the behaviour were two independent spellings of one
// fact with nothing keeping them in step. On a corpus where the wrong encoding produces
// mojibake that passes every row count, every column count and every numeric assertion,
// that gap is worth closing. Pass `source.encoding`; never re-type the literal.
//
// Plan: docs/plans/presidential-elections-v1.md T2.

import fs from "node:fs";
import path from "node:path";
import {
  decodeBundleText,
  parseSemicolonRows,
  type PresidentialEncoding,
} from "./encoding";
import type { PresidentialSection } from "./types";

/**
 * A cell's numeric value, or 0.
 *
 * ⚠ A NON-NUMERIC CELL BECOMES 0 RATHER THAN THROWING, deliberately: every era's files
 * carry blank cells in optional columns, and refusing them would refuse the corpus. The
 * cost is that a GARBLED cell also reads as 0 — which is why each era pins its field map
 * to a verbatim row in its own test rather than trusting this to notice.
 */
export const num = (raw: string | undefined): number => {
  if (raw === undefined) return 0;
  const t = raw.trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Find one file in a round folder, decode it, and split it into semicolon-separated rows.
 *
 * @param era - For the error message, so a failure names the reader that raised it.
 * @param dir - The round folder.
 * @param describe - How to describe the wanted file when it is missing (e.g.
 *   `"cik_candidates*.txt"`). Used only in the error.
 * @param match - The naming rule. Per-era on purpose: 2016/2021 tell their files apart by
 *   PREFIX, 2011 by an exact name — see each reader.
 * @param encoding - The cycle's DECLARED encoding, from `sources.ts`. Never a literal.
 * @returns One string array per row.
 * @throws If no file matches — naming the folder's actual contents, because the usual
 *   cause is an extraction that put the files one level deeper or flattened a race
 *   folder, and the listing is what makes that obvious.
 */
export const readBundleFile = (
  era: string,
  dir: string,
  describe: string,
  match: (file: string) => boolean,
  encoding: PresidentialEncoding,
): string[][] => {
  const entries = fs.readdirSync(dir);
  const hit = entries.find(match);
  if (!hit) {
    throw new Error(
      `${era}: no "${describe}" in ${dir} — found ${entries.join(", ")}`,
    );
  }
  return parseSemicolonRows(
    decodeBundleText(fs.readFileSync(path.join(dir, hit)), encoding),
  );
};

/**
 * Look a section up by code, refusing one the sections file does not carry.
 *
 * ⚠ Refusing is the point. A protocol or votes row whose code is not in the sections
 * file is a row we cannot place — it has no settlement, no oblast and no ЕКАТТЕ — and
 * silently dropping it loses real votes from the national total while every row count
 * still reconciles.
 *
 * @param era - For the error message.
 * @param sections - The sections built from the sections file.
 * @returns A lookup taking the code and the file it came from (for the error).
 */
export const sectionLookup =
  (era: string, sections: Map<string, PresidentialSection>) =>
  (code: string, where: string): PresidentialSection => {
    const s = sections.get(code);
    if (!s) {
      throw new Error(
        `${era}: section ${code} appears in ${where} but not in sections`,
      );
    }
    return s;
  };
