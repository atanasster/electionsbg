// НЗОК clinical-pathway TARIFFS → data/budget/nzok/pathway_tariffs.json — the
// price factor that turns the volume-only activity corpus into a spend reading and
// unlocks the case-mix expected-vs-actual signal (migration 059).
//
// Source = the НРД (Национален рамков договор) appendix that lists the price per
// клинична пътека / амбулаторна процедура / клинична процедура. On the НРД medical
// page (e.g. https://nhif.bg/bg/nrd/2025/medical) this is the "цени"/price annex,
// distinct from the Приложение 17/18/19 NAME specs that write_procedure_names.ts
// parses. Each row is essentially "<TYPE> № <code> … <price>".
//
// SAME OPERATIONAL CONSTRAINTS AS write_procedure_names.ts:
//   * nhif.bg is IP-gated to Bulgarian egress — this 403s elsewhere. RUN FROM BG.
//   * The annex is a spec/table PDF with glyph-level letter-spacing; the price
//     regex WILL need iterating against the real text. Use --dump then --from-dump
//     to iterate offline against the saved raw text (no re-fetch), exactly like the
//     names script.
//   * Money: 2026+ НРД is EUR-native; pre-2026 is BGN — pass --bgn to convert at
//     1 EUR = 1.95583 BGN (the euro-adoption rate used across the repo).
//
// USAGE — value-carrying flags (--page/--annex/--nrd-year) require DIRECT
// invocation; the `npm run data:nzok --` wrapper only forwards the valueless
// passthrough flags (--dump/--from-dump/--bgn) and rejects unknown flags:
//   tsx scripts/nzok/write_pathway_tariffs.ts --page https://nhif.bg/bg/nrd/2025/medical --dump --nrd-year 2025
//   tsx scripts/nzok/write_pathway_tariffs.ts --from-dump --nrd-year 2025
//   tsx scripts/nzok/write_pathway_tariffs.ts --annex <direct-annex-url> --nrd-year 2026
//   npm run data:nzok -- --pathway-tariffs --from-dump   # wrapper OK (no value flags)
//
// Requires the `pdftotext` binary (poppler-utils) for PDF annexes.

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/pathway_tariffs.json",
);
const DUMP_DIR = path.resolve(
  __dirname,
  "../../raw_data/nzok/pathway_tariffs_raw",
);
const BASE = "https://nhif.bg";
const UA = "Mozilla/5.0 (compatible; naiasno-data/1.0)";
const BGN_PER_EUR = 1.95583;

type ProcType = "КП" | "АПр" | "КПр";
const PREFIX: Record<ProcType, "P" | "A" | "K"> = {
  КП: "P",
  АПр: "A",
  КПр: "K",
};
const PAD: Record<ProcType, number> = { КП: 3, АПр: 2, КПр: 2 };
// The token that opens a priced row, per type — same markers as the names annex.
const TOKEN: { type: ProcType; re: RegExp }[] = [
  { type: "КП", re: /КП/ },
  { type: "АПр", re: /АМБУЛАТОРНА\s+ПРОЦЕДУРА|АПр/ },
  { type: "КПр", re: /КЛИНИЧНА\s+ПРОЦЕДУРА|КПр/ },
];

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const has = (flag: string): boolean => process.argv.includes(flag);

const fetchBuf = async (url: string): Promise<Buffer> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok)
    throw new Error(`GET ${url} → ${r.status} (nhif.bg needs BG egress)`);
  return Buffer.from(await r.arrayBuffer());
};

const extractPdfRaw = (buf: Buffer): Promise<string> =>
  new Promise((resolve, reject) => {
    const p = spawn("pdftotext", ["-enc", "UTF-8", "-layout", "-", "-"]);
    let out = "";
    let err = "";
    p.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
    p.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));
    p.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        e.code === "ENOENT"
          ? new Error("pdftotext not found — brew install poppler")
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

/** Normalize a source code to the activity-feed format (P/A/K + padded + .N). */
const normalizeCode = (type: ProcType, raw: string): string | null => {
  const m = raw.trim().match(/^(\d{1,3})(\.\d+)?$/);
  if (!m) return null;
  return `${PREFIX[type]}${m[1].padStart(PAD[type], "0")}${m[2] ?? ""}`;
};

/** Parse a price token like "1 234,56" / "1234.56" → number. */
const parsePrice = (raw: string): number | null => {
  const t = raw.replace(/\s/g, "");
  // The decimal separator is whichever of "," / "." appears LAST; the other is a
  // thousands separator. Handles both "1 234,56" (comma-decimal, the real НРД
  // format) and "1234.56" (dot-decimal, listed in the docstring) — the old
  // "strip every dot" logic turned the latter into 123456, a 100x error.
  const dec = t.lastIndexOf(",") > t.lastIndexOf(".") ? "," : ".";
  const thou = dec === "," ? "." : ",";
  const cleaned = t.split(thou).join("").replace(dec, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Best-effort extraction of (code → price) from one annex's text. The annex lists
 *  a priced row per pathway; the exact column layout varies, so this matches a type
 *  marker + code near the line start and takes the LAST money-shaped token on the
 *  line as the price. ITERATE this against a --dump when the counts look wrong. */
const parseTariffs = (
  text: string,
  toEur: (v: number) => number,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    // Which type does this row open with?
    const typed = TOKEN.find((x) =>
      // Non-capturing group so a multi-alternative source (e.g. "…ПРОЦЕДУРА|АПр")
      // stays fully anchored — without it, `|` splits the whole pattern and the
      // trailing code-digit requirement binds to only the last alternative.
      new RegExp(`^\\s*(?:${x.re.source})\\s*№?\\s*\\d`, "i").test(t),
    );
    if (!typed) continue;
    const codeM = t.match(/№?\s*(\d{1,3}(?:\.\d+)?)/);
    if (!codeM) continue;
    const code = normalizeCode(typed.type, codeM[1]);
    if (!code) continue;
    // The price is the last money-shaped token on the row.
    const money = t.match(/\d[\d\s]*[.,]\d{2}/g);
    if (!money || !money.length) continue;
    const price = parsePrice(money[money.length - 1]);
    if (price == null) continue;
    // First occurrence wins (a code should be listed once).
    if (out[code] == null) out[code] = Math.round(toEur(price) * 100) / 100;
  }
  return out;
};

/** Find the price-annex link(s) on the НРД medical page. */
const findAnnexHrefs = (html: string): string[] => {
  const hrefs: string[] = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, href, label] = m;
    if (
      /цени|стойност|тарифа|остойност/i.test(label) &&
      /\.(pdf|xlsx?|docx?)/i.test(href)
    )
      hrefs.push(href.startsWith("http") ? href : BASE + href);
  }
  return [...new Set(hrefs)];
};

const main = async (): Promise<void> => {
  const nrdYear = Number(arg("--nrd-year") ?? new Date().getFullYear() - 1);
  const toEur = (v: number): number => (has("--bgn") ? v / BGN_PER_EUR : v);
  const fromDump = has("--from-dump");
  const dump = has("--dump");
  if (!fromDump) fs.mkdirSync(DUMP_DIR, { recursive: true });

  // 1) Gather annex text — from a local dump, a direct --annex URL, or by
  //    discovering the price annex on the --page.
  const texts: string[] = [];
  if (fromDump) {
    const files = fs.existsSync(DUMP_DIR) ? fs.readdirSync(DUMP_DIR) : [];
    if (!files.length)
      throw new Error(`No dumps in ${DUMP_DIR} — run --dump first.`);
    for (const f of files)
      texts.push(fs.readFileSync(path.join(DUMP_DIR, f), "utf8"));
  } else {
    const annexes: string[] = [];
    const direct = arg("--annex");
    if (direct) annexes.push(direct);
    else {
      const page = arg("--page");
      if (!page)
        throw new Error(
          "Pass --page <НРД medical page> or --annex <direct annex URL>.",
        );
      annexes.push(
        ...findAnnexHrefs(await (await fetchBuf(page)).toString("utf8")),
      );
      if (!annexes.length)
        throw new Error(
          "No price-annex link found on the page — pass --annex directly.",
        );
    }
    let i = 0;
    for (const url of annexes) {
      const buf = await fetchBuf(url);
      const text = /\.pdf/i.test(url)
        ? await extractPdfRaw(buf)
        : buf.toString("utf8");
      texts.push(text);
      if (dump) fs.writeFileSync(path.join(DUMP_DIR, `annex_${i++}.txt`), text);
    }
  }

  // 2) Parse.
  const names: Record<string, number> = {};
  for (const text of texts) Object.assign(names, parseTariffs(text, toEur));

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      nrdYear,
      currency: "EUR",
      source:
        "НЗОК НРД за медицинските дейности — приложение с цените на клиничните пътеки / амбулаторни и клинични процедури, nhif.bg",
      count: Object.keys(names).length,
    },
    tariffs: Object.fromEntries(
      Object.entries(names).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Wrote ${payload.meta.count} pathway tariffs → ${OUT_FILE}`);
  if (payload.meta.count < 300)
    console.warn(
      "! Fewer tariffs than expected (~550). Iterate parseTariffs against a --dump — the annex layout varies.",
    );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
