// Фискален съвет triage — does a new opinion touch the budget simulator?
//
//   pnpm run fiscal-council:triage                  # triage publications not in the ledger
//   pnpm run fiscal-council:triage --seed --keep a,b   # one-off: mark the rest as pre-ledger
//   pnpm run fiscal-council:triage --resolve <slug> --note "updated scoreX"   # close a lever/unverified call
//
// For each new publication on fiscal-council.bg/bg/publikacii it reads the
// attached opinion (pdftotext; the page body when there is no PDF), asks
// Gemini to list the costed measures and map each to a simulator lever, and
// keeps only the measures whose verbatim quote is in the text (triage_lib.ts).
// The verdicts go into state/fiscal_council/triage.json, which the pipeline's
// fiscal_council_bg operator item reads: it closes on its own only when every
// publication is "none". A "lever" or "unverified" verdict waits for a human —
// this step never edits the simulator.

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { GEMINI_FLASH } from "../../lib/gemini_models";
import { loadGeminiEnv } from "../../council/lib/gemini_ocr";
import {
  LEVERS,
  gateMeasures,
  listingSlugs,
  verdictOf,
  type Ledger,
  type Measure,
} from "./triage_lib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, "../../..");
export const LEDGER = path.join(REPO, "state/fiscal_council/triage.json");
const CACHE = path.join(REPO, "raw_data/budget/fiscal_council");
const SITE = "https://www.fiscal-council.bg";
const MODEL = GEMINI_FLASH;
/** Bounds one run's cost; the rest wait for the next run. */
const MAX_PER_RUN = 6;
/** Only the listing's newest slugs are ever new — the watcher's window. */
const WINDOW = 20;

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const readLedger = (): Ledger =>
  fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : {};
const writeLedger = (l: Ledger): void => {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  // Sorted keys keep the committed diff to the entries that moved.
  const sorted = Object.fromEntries(
    Object.keys(l)
      .sort()
      .map((k) => [k, l[k]]),
  );
  fs.writeFileSync(LEDGER, JSON.stringify(sorted, null, 2) + "\n");
};

const getText = async (url: string): Promise<string> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
};

/** The publication's text: its PDF when the page attaches one, else the page. */
const publicationText = async (
  slug: string,
): Promise<{ text: string; source: string }> => {
  const pageUrl = `${SITE}/bg/publikacii/${slug}`;
  const html = await getText(pageUrl);
  const href = /href="(\/uploads\/[^"]+\.pdf)"/i.exec(html)?.[1];
  if (!href) {
    const body = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
    return { text: body, source: pageUrl };
  }
  const pdfUrl = SITE + encodeURI(decodeURI(href));
  fs.mkdirSync(CACHE, { recursive: true });
  const pdf = path.join(CACHE, `${slug}.pdf`);
  const res = await fetch(pdfUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${pdfUrl}`);
  fs.writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
  const text = execFileSync("pdftotext", ["-layout", pdf, "-"], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf8");
  return { text, source: pdfUrl };
};

const PROMPT = (
  text: string,
): string => `You are triaging a publication of the Bulgarian Fiscal Council (Фискален съвет) for a budget simulator.

The simulator scores these levers (id: what it models):
${Object.entries(LEVERS)
  .map(([id, d]) => `- ${id}: ${d}`)
  .join("\n")}

A lever is AFFECTED only when the publication either (a) quantifies the revenue or expenditure effect of changing what that lever models, or (b) states a change to the current-law parameter the lever starts from (a rate, cap, threshold or indexation rule) taking effect in the law under review. General commentary, forecasts of aggregates, and measures no lever models are NOT affecting.

List every concrete fiscal measure or costing the publication discusses (up to 15). For each give:
- "summary": one English sentence;
- "quote": a VERBATIM sentence or clause from the text below (Bulgarian, copied exactly, at least 30 characters) that states it;
- "lever": the lever id it relates to, or null;
- "affects": true only under the rule above;
- "reason": one English sentence explaining the affects decision.

Return ONLY JSON: {"measures":[...]}

PUBLICATION TEXT:
${text.slice(0, 180_000)}`;

const askModel = async (text: string): Promise<Measure[]> => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set (.env.local)");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT(text) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          maxOutputTokens: 16_384,
        },
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    if (!res.ok)
      throw new Error(
        `gemini ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as {
      measures?: Measure[];
    };
    return (parsed.measures ?? []).filter(
      (m) => m && typeof m.quote === "string",
    );
  }
  throw new Error("gemini: no answer after 3 attempts");
};

const main = async (): Promise<void> => {
  const ledger = readLedger();
  const now = new Date().toISOString();

  const resolve = arg("--resolve");
  if (resolve) {
    if (!ledger[resolve]) throw new Error(`${resolve} is not in the ledger`);
    const note = arg("--note");
    if (!note) throw new Error('--resolve needs --note "what was done"');
    ledger[resolve] = { ...ledger[resolve], resolvedAt: now, resolution: note };
    writeLedger(ledger);
    console.log(`✓ resolved ${resolve}`);
    return;
  }

  const slugs = listingSlugs(await getText(`${SITE}/bg/publikacii`)).slice(
    0,
    WINDOW,
  );
  if (slugs.length === 0)
    throw new Error(
      "no publication slugs on the listing page — layout changed",
    );

  if (process.argv.includes("--seed")) {
    const keep = new Set((arg("--keep") ?? "").split(",").filter(Boolean));
    for (const s of slugs)
      if (!ledger[s] && !keep.has(s))
        ledger[s] = { verdict: "pre-ledger", triagedAt: now };
    writeLedger(ledger);
    console.log(`✓ seeded; left for triage: ${[...keep].join(", ") || "none"}`);
    return;
  }

  const todo = slugs.filter((s) => !ledger[s]).slice(0, MAX_PER_RUN);
  if (todo.length === 0) {
    console.log("✓ nothing new to triage");
    return;
  }
  loadGeminiEnv();
  let open = 0;
  for (const slug of todo) {
    const { text, source } = await publicationText(slug);
    if (text.trim().length < 200)
      throw new Error(`${slug}: publication text is empty — extraction failed`);
    const { kept, dropped } = gateMeasures(await askModel(text), text);
    const verdict = verdictOf(kept, dropped);
    ledger[slug] = {
      verdict,
      triagedAt: now,
      source,
      model: MODEL,
      measures: kept,
      ...(dropped.length > 0 && { dropped }),
    };
    writeLedger(ledger); // per publication, so a later failure keeps earlier work
    if (verdict !== "none") open++;
    console.log(
      `  ${verdict.padEnd(10)} ${slug} — ${kept.length} measure(s) kept, ${dropped.length} dropped by the quote gate`,
    );
    for (const m of kept.filter((x) => x.affects))
      console.log(`      → ${m.lever}: ${m.summary}`);
  }
  console.log(
    open > 0
      ? `\n⚠ ${open} publication(s) need a human: review state/fiscal_council/triage.json, update the simulator if warranted, then --resolve <slug> --note "…"`
      : `\n✓ ${todo.length} publication(s) triaged; none affects a simulator lever`,
  );
};

main().catch((e) => {
  console.error("Фискален съвет triage failed:", e);
  process.exit(1);
});
