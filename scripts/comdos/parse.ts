// Parse the crawled comdos.bg decisions (raw_data/comdos/, written by
// `pnpm run comdos:crawl`) into the COMMITTED corpus the `ds` loader reads
// (docs/plans/comdos-ds-ingest-v1.md §3, §5):
//
//   data/comdos/decisions.json   one row per decision in the archive
//   data/comdos/persons.jsonl    one row per announced person-block
//
//   pnpm run comdos:parse
//
// The source is public and permanent, so the corpus is committed and a fresh
// clone loads it with no network (the clean_delivery precedent). It is a PG load
// source, never a serving artifact — `comdos/` is excluded from bucket sync.
//
// Text extraction: `pdftotext` (poppler) for .pdf and macOS `textutil` for
// .doc / .docx, cached per decision in the gitignored raw_data/comdos/txt/ — so
// the converters are needed only for documents not yet converted. A missing
// converter is a hard error rather than a silent zero-person decision.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMDOS_RAW, type IndexEntry } from "./crawl";
import { parseDecisionText, type DsPerson } from "./parse_decision";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const COMDOS_DATA = path.resolve(__dirname, "../../data/comdos");
const DOCS = path.join(COMDOS_RAW, "docs");
const TXT = path.join(COMDOS_RAW, "txt");

export interface DsDecisionRow {
  decisionId: number;
  number: string | null;
  date: string | null;
  title: string;
  /** False when the decision page links no document (or it is gone) — such a
   *  decision is counted, never read as "announced nobody". */
  hasDocument: boolean;
  total: number | null;
  checked: number | null;
  deceased: number;
  persons: number;
}

export type DsPersonRow = DsPerson & {
  decisionId: number;
  /** 0-based position of the block in its decision — the row's stable key. */
  seq: number;
};

const OFFICER_LABEL =
  /(?:Вербувал|Ръководил)\p{L}* (?:го|я) служител|Оперативн\p{L}* работни(?:к|ци)/u;

const toText = (docFile: string, id: string): string => {
  const out = path.join(TXT, `${id}.txt`);
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
    const tmp = `${out}.part`;
    if (docFile.endsWith(".pdf"))
      execFileSync("pdftotext", ["-enc", "UTF-8", docFile, tmp]);
    else
      execFileSync("textutil", [
        "-convert",
        "txt",
        "-encoding",
        "UTF-8",
        "-output",
        tmp,
        docFile,
      ]);
    fs.renameSync(tmp, out);
  }
  return fs.readFileSync(out, "utf8");
};

export const main = (): void => {
  const indexFile = path.join(COMDOS_RAW, "index.json");
  if (!fs.existsSync(indexFile))
    throw new Error(`${indexFile} missing — run pnpm run comdos:crawl first`);
  const index: Record<string, IndexEntry> = JSON.parse(
    fs.readFileSync(indexFile, "utf8"),
  );
  fs.mkdirSync(TXT, { recursive: true });
  const docs = new Map(
    fs
      .readdirSync(DOCS)
      .filter((f) => !f.endsWith(".part"))
      .map((f) => [f.slice(0, f.indexOf(".")), path.join(DOCS, f)]),
  );

  const decisions: DsDecisionRow[] = [];
  const persons: string[] = [];
  for (const id of Object.keys(index).sort((a, b) => Number(a) - Number(b))) {
    const e = index[id];
    const doc = docs.get(id);
    const parsed = doc ? parseDecisionText(toText(doc, id)) : null;
    decisions.push({
      decisionId: Number(id),
      number: e.number,
      date: e.date,
      title: e.title,
      hasDocument: !!doc,
      total: parsed?.total ?? null,
      checked: parsed?.checked ?? null,
      deceased: parsed?.deceased ?? 0,
      persons: parsed?.persons.length ?? 0,
    });
    parsed?.persons.forEach((p, seq) =>
      persons.push(
        JSON.stringify({
          decisionId: Number(id),
          seq,
          ...p,
        } satisfies DsPersonRow),
      ),
    );
  }

  // The recruiting / handling officer is a third party and is never stored
  // (plan §4 rule 4). The parser discards that segment structurally; this is the
  // backstop against a layout it has not seen — any stored field still carrying
  // the label means an officer's name is in it, so nothing is written.
  const leak = persons.filter((l) => OFFICER_LABEL.test(l));
  if (leak.length)
    throw new Error(
      `${leak.length} person rows still carry a recruiter/handler field — ` +
        `refusing to write (first: ${leak[0].slice(0, 160)})`,
    );

  // A document that converts to (almost) nothing is a converter failure, not an
  // empty decision — refuse rather than commit a corpus with silent holes.
  const withDoc = decisions.filter((d) => d.hasDocument);
  const empty = withDoc.filter((d) => d.persons === 0 && d.checked === null);
  if (empty.length > withDoc.length * 0.05)
    throw new Error(
      `${empty.length}/${withDoc.length} documents parsed to nothing — check the converters`,
    );

  fs.mkdirSync(COMDOS_DATA, { recursive: true });
  fs.writeFileSync(
    path.join(COMDOS_DATA, "decisions.json"),
    "[\n" + decisions.map((d) => JSON.stringify(d)).join(",\n") + "\n]\n",
  );
  fs.writeFileSync(
    path.join(COMDOS_DATA, "persons.jsonl"),
    persons.join("\n") + "\n",
  );
  const people = new Set(
    persons.map((l) => {
      const p = JSON.parse(l) as DsPersonRow;
      return `${p.name}|${p.birthDate}`;
    }),
  );
  console.log(
    `✓ ${decisions.length} decisions (${withDoc.length} with a document) → ` +
      `${persons.length} records · ${people.size} people · ` +
      `${decisions.reduce((n, d) => n + (d.checked ?? 0), 0)} checked · ` +
      `${decisions.reduce((n, d) => n + d.deceased, 0)} deceased (not published)`,
  );
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
