// Build data/budget/nzok/procedures.json — the procedure code → official НРД name
// reference the health-pack activity tiles join onto. НЗОК's monthly clinical-
// activity feed (parsed in write_activities.ts) carries ONLY the code (P###=КП,
// A##=АПр, K##=КПр); the human names live in the НРД Приложение 17 (клинични
// пътеки) + 18 (амбулаторни процедури) + 19 (клинични процедури) on nhif.bg.
//
// Each appendix is a spec document: a title line "<TYPE> № <code> <NAME…>" with the
// name often continuing across the next ALL-CAPS (or, for КПр, sentence-case) lines,
// then the pathway body (numbered sections, МКБ codes). The parser:
//   · anchors the marker to LINE START (so body cross-refs "…по КП № 5" don't match),
//   · joins continuation lines until a STOP (blank / digit / next marker / section),
//   · keeps the FIRST match per code and requires the name to start with a capital
//     (so a lowercase body cross-ref never wins over the real title),
//   · normalizes the code to the activity-feed format (P+3-digit, A/K+2-digit, .N kept).
// The A99 / B1 / B2 / E billing modifiers share the base name, so they are NOT emitted
// here — the client resolver (src/lib/nzokProcedures.ts) strips them on a miss.
//
// Extraction uses `pdftotext` WITHOUT -layout: these are prose specs, not tables, and
// -layout injects justification spaces mid-word ("ХЕМ АТОЛОГИЧНИ") that can't be
// undone (Bulgarian has single-letter words, so "БРЕМЕННОСТ С" is indistinguishable
// from a spurious split). Raw reading order keeps words intact.
//
// RUN FROM A BG EGRESS — nhif.bg is Cloudflare/IP-gated (403 elsewhere). Needs the
// `pdftotext` binary (poppler-utils).
//
//   npm run data:nzok -- --procedure-names
//   npm run data:nzok -- --procedure-names --dump   # also save raw text for debugging
//   tsx scripts/nzok/write_procedure_names.ts --page https://nhif.bg/bg/nrd/2025/medical

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import * as xlsx from "xlsx";
import unzipper from "unzipper";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/procedures.json",
);
const BASE = "https://nhif.bg";
const UA = "Mozilla/5.0 (compatible; naiasno-data/1.0)";

type ProcType = "КП" | "АПр" | "КПр";
const PREFIX: Record<ProcType, "P" | "A" | "K"> = {
  КП: "P",
  АПр: "A",
  КПр: "K",
};
const PAD: Record<ProcType, number> = { КП: 3, АПр: 2, КПр: 2 };
// The marker token that opens a title line, per appendix. КП uses the abbreviation;
// АПр/КПр spell it out. Matched case-sensitively at line start.
const TOKEN: Record<ProcType, string> = {
  КП: "КП",
  АПр: "АМБУЛАТОРНА\\s+ПРОЦЕДУРА",
  КПр: "КЛИНИЧНА\\s+ПРОЦЕДУРА",
};
// Any marker start — a name never runs past the next procedure's header. Includes
// the abbreviated sub-variant forms (АПР № 38.1, КПР № …) that a title can bump into.
const ANY_MARKER =
  /^\s*(?:КП|КПр|АПр|АМБУЛАТОРНА\s+ПРОЦЕДУРА|КЛИНИЧНА\s+ПРОЦЕДУРА)\s*№\s*\d/i;
// Section headers / body openers that end a title.
const SECTION =
  /^(КОДОВЕ|УСЛОВИЯ|ЗАДЪЛЖИТЕЛНИ|ПРИЛОЖЕНИЕ|ИЗИСКВАНЕ|КВАЛИФИКАЦИЯ|ОСНОВНИ|ДОПЪЛНИТЕЛНИ|ИНДИКАЦИИ|Изискване|Клиничната|Клинична\s+пътека|Амбулаторната|Забележка|Когато|Здравни\s+грижи)/;

// Caption → procedure type on the НРД medical page.
const APPENDIX_MATCHERS: { type: ProcType; re: RegExp }[] = [
  { type: "КП", re: /клинични\s+пътеки|приложение\s*№?\s*17/i },
  { type: "АПр", re: /амбулаторни\s+процедури|приложение\s*№?\s*18/i },
  { type: "КПр", re: /клинични\s+процедури|приложение\s*№?\s*19/i },
];

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

const fetchBuf = async (url: string): Promise<Buffer> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

// pdftotext WITHOUT -layout, via stdin→stdout (no temp files).
const extractPdfRaw = (buf: Buffer): Promise<string> =>
  new Promise((resolve, reject) => {
    const p = spawn("pdftotext", ["-enc", "UTF-8", "-", "-"]);
    let out = "";
    let err = "";
    p.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
    p.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));
    p.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        e.code === "ENOENT"
          ? new Error(
              "pdftotext not found — install poppler-utils (brew install poppler)",
            )
          : e,
      ),
    );
    p.on("close", (code: number | null) =>
      code === 0 || out
        ? resolve(out)
        : reject(new Error(`pdftotext exited ${code}: ${err.slice(0, 300)}`)),
    );
    p.stdin.write(buf);
    p.stdin.end();
  });

/** Normalize a source code ("240", "265.1", "56.1", "5") for a type into the
 *  activity-feed format: P/A/K + zero-padded base number + kept ".N" variant. */
const normalizeCode = (type: ProcType, raw: string): string | null => {
  const m = raw.trim().match(/^(\d{1,3})(\.\d+)?$/);
  if (!m) return null;
  return `${PREFIX[type]}${m[1].padStart(PAD[type], "0")}${m[2] ?? ""}`;
};

const cleanName = (s: string): string =>
  s
    .replace(/^[-–—:.\s„"”]+/, "")
    .replace(/[\s*]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

const isStop = (line: string): boolean => {
  const t = line.trim();
  return t === "" || /^\d/.test(t) || ANY_MARKER.test(line) || SECTION.test(t);
};

// The appendix PDFs carry glyph-level letter-spacing that splits words mid-string
// ("ХЕМ АТОЛОГИЧНИ", "ЛЕЧЕНИ Е") — present in raw AND -layout extraction, and
// INCONSISTENT (the same word appears clean elsewhere). So we can't strip it with a
// generic rule (Bulgarian has single-letter words: "БРЕМЕННОСТ С" is legitimate).
// Instead, build a lexicon of every word attested CLEANLY in the corpus, then only
// merge a split when the merged form is such an attested word.
const buildLexicon = (texts: string[]): Map<string, number> => {
  const freq = new Map<string, number>();
  for (const t of texts)
    for (const m of t.matchAll(/[А-Я][А-Я-]{1,}/g))
      freq.set(m[0], (freq.get(m[0]) ?? 0) + 1);
  return freq;
};

const despace = (name: string, freq: Map<string, number>): string => {
  const f = (w: string) => freq.get(w) ?? 0;
  const toks = name
    .replace(/ +-(?=[А-Я])/g, "-") // glue a spaced hyphen: "СЪДОВО -РЕКОНСТ" → "СЪДОВО-РЕКОНСТ"
    .replace(/(?<=[А-Я])- +/g, "-")
    .split(" ");
  for (let ch = true, guard = 0; ch && guard < 30; guard++) {
    ch = false;
    for (let i = 0; i < toks.length - 1; i++) {
      const merged = toks[i] + toks[i + 1];
      const fm = f(merged);
      // Merge when the joined form is an attested word: seen ≥2×, or ≥1× and at
      // least as common as its rarest fragment. A spurious "БРЕМЕННОСТ С" won't
      // merge (freq("БРЕМЕННОСТС") = 0); a split "ЛЕЧЕНИ Е" will (freq("ЛЕЧЕНИЕ") ≫).
      if (fm >= 2 || (fm >= 1 && fm >= Math.min(f(toks[i]), f(toks[i + 1])))) {
        toks.splice(i, 2, merged);
        ch = true;
        break;
      }
    }
  }
  return toks.join(" ").replace(/\s+/g, " ").trim();
};

/** Extract text from an appendix document by extension (pdf → raw pdftotext,
 *  else xlsx / docx / html). */
const documentText = async (url: string, buf: Buffer): Promise<string> => {
  const ext = url.split("?")[0].toLowerCase();
  if (ext.endsWith(".pdf")) return extractPdfRaw(buf);
  if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
    const wb = xlsx.read(buf, { type: "buffer" });
    return wb.SheetNames.map((n) =>
      xlsx.utils.sheet_to_csv(wb.Sheets[n], { FS: " " }),
    ).join("\n");
  }
  if (ext.endsWith(".docx")) {
    const dir = await unzipper.Open.buffer(buf);
    const doc = dir.files.find((f) => f.path === "word/document.xml");
    if (!doc) return "";
    return (await doc.buffer()).toString("utf8").replace(/<[^>]+>/g, " ");
  }
  return buf.toString("utf8");
};

/** { code → name } from an appendix's text for its known type. */
const parseAppendix = (type: ProcType, text: string): Map<string, string> => {
  const lines = text.split(/\r?\n/);
  const out = new Map<string, string>();
  const re = new RegExp(
    `^\\s*${TOKEN[type]}\\s*№\\s*(\\d{1,3}(?:\\.\\d+)?)\\.?\\s*(.*)$`,
  );
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const code = normalizeCode(type, m[1]);
    if (!code || out.has(code)) continue;
    const parts: string[] = [];
    const first = m[2].trim();
    if (first) parts.push(first);
    for (let j = i + 1; j < i + 6 && j < lines.length; j++) {
      if (isStop(lines[j])) break;
      parts.push(lines[j].trim());
      if (parts.join(" ").length > 240) break;
    }
    const name = cleanName(parts.join(" "));
    // Require a capital-letter start so a lowercase body cross-reference (which the
    // line-start anchor mostly excludes anyway) can never win over the real title.
    if (name.length >= 5 && /^[А-ЯA-Z]/.test(name)) out.set(code, name);
  }
  return out;
};

const resolveAppendixUrls = async (): Promise<
  { type: ProcType; url: string }[]
> => {
  const explicit = [
    { type: "КП" as const, url: arg("--kp") },
    { type: "АПр" as const, url: arg("--apr") },
    { type: "КПр" as const, url: arg("--kpr") },
  ].filter((x) => x.url) as { type: ProcType; url: string }[];
  if (explicit.length) return explicit;

  const page = arg("--page") ?? `${BASE}/bg/nrd/2023-2025/medical`;
  const html = (await fetchBuf(page)).toString("utf8");
  const links: { type: ProcType; url: string }[] = [];
  const re =
    /<a[^>]*href="([^"]+\.(?:pdf|xlsx|xls|docx))"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    const caption = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const hit = APPENDIX_MATCHERS.find(
      (a) => a.re.test(caption) || a.re.test(href),
    );
    if (hit && !links.some((l) => l.type === hit.type)) {
      links.push({
        type: hit.type,
        url: href.startsWith("http") ? href : BASE + href,
      });
    }
  }
  return links;
};

const DUMP_DIR = path.resolve(
  __dirname,
  "../../raw_data/nzok/procedure_names_raw",
);

const main = async () => {
  const dump = process.argv.includes("--dump");
  // --from-dump re-parses the raw text saved by a prior --dump run (no network) —
  // for iterating the parser/de-spacer against the real appendix text offline.
  const fromDump = process.argv.includes("--from-dump");

  // 1) Gather each appendix's text (from the local dump or by fetching nhif.bg).
  const docs: { type: ProcType; text: string }[] = [];
  if (fromDump) {
    for (const type of ["КП", "АПр", "КПр"] as ProcType[]) {
      const p = path.join(DUMP_DIR, `${PREFIX[type]}_${type}.txt`);
      if (fs.existsSync(p))
        docs.push({ type, text: fs.readFileSync(p, "utf8") });
    }
    if (!docs.length)
      throw new Error(`No dumps in ${DUMP_DIR} — run with --dump first.`);
  } else {
    const appendices = await resolveAppendixUrls();
    if (!appendices.length)
      throw new Error(
        "No НРД appendix links found. Pass --kp/--apr/--kpr with document URLs, or --page with the correct НРД page. See the header note.",
      );
    for (const { type, url } of appendices) {
      console.log(`Fetching ${type}: ${url}`);
      const text = await documentText(url, await fetchBuf(url));
      if (dump) {
        fs.mkdirSync(DUMP_DIR, { recursive: true });
        const dest = path.join(DUMP_DIR, `${PREFIX[type]}_${type}.txt`);
        fs.writeFileSync(dest, text);
        console.log(
          `  · dumped raw text → ${path.relative(process.cwd(), dest)}`,
        );
      }
      docs.push({ type, text });
    }
  }

  // 2) Build the de-spacing lexicon across ALL appendices, then parse + de-space.
  const lex = buildLexicon(docs.map((d) => d.text));
  const names: Record<string, string> = {};
  const byType: Record<string, number> = {};
  for (const { type, text } of docs) {
    const parsed = parseAppendix(type, text);
    byType[type] = parsed.size;
    for (const [code, raw] of parsed) names[code] = despace(raw, lex);
    console.log(`  → ${parsed.size} ${type} names`);
  }

  const sorted = Object.fromEntries(
    Object.entries(names).sort(([a], [b]) => a.localeCompare(b, "en")),
  );
  const payload = {
    meta: {
      source:
        "НЗОК НРД Приложение 17 (клинични пътеки) + 18 (амбулаторни процедури) + 19 (клинични процедури), nhif.bg",
      generatedAt: new Date().toISOString().slice(0, 10),
      count: Object.keys(sorted).length,
      byType,
    },
    names: sorted,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${payload.meta.count} procedure names → ${path.relative(process.cwd(), OUT_FILE)}`,
  );
  if (payload.meta.count < 250)
    console.warn(
      "! Fewer names than expected (~400). Verify the appendix links/format — see the header note.",
    );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
