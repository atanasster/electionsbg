// Generate the CONTRASTIVE training set for fine-tuning a small embedder
// (multilingual-e5-small) to rival generic e5-base on our 125-tool registry.
// See ai/m0/finetune_functiongemma.md (P1 follow-on / embedder fine-tune).
//
// CRITICAL — this set is HELD OUT from the eval set: recall is measured on
// recall_queries.json, so any overlap would leak the test. Every generated query
// is deduped against (a) recall_queries.json and (b) the tool's own examples.
//
//   npx tsx ai/m0/finetune/gen_train_data.ts          # → train_queries.json (cache)
//   npx tsx ai/m0/finetune/gen_train_data.ts --n 12   # queries per lang per tool
//
// Then build pairs + fine-tune with ai/m0/finetune/finetune_embedder.py.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadGeminiEnv } from "../../../scripts/council/lib/gemini_ocr";
import { TOOLS } from "../../tools/registry";

const HERE = join(process.cwd(), "ai/m0/finetune");
const CACHE = join(HERE, "train_queries.json");
const EVAL = join(HERE, "recall_queries.json");
const argv = process.argv;
const N = Number(argv[argv.indexOf("--n") + 1] || 10);
const MODEL = argv.includes("--model")
  ? argv[argv.indexOf("--model") + 1]
  : "gemini-3.5-flash";

type ToolQueries = { en: string[]; bg: string[] };
type Cache = Record<string, ToolQueries>;

// queries already in the eval set (per tool) — never reuse them for training
const evalSet: Cache = existsSync(EVAL)
  ? JSON.parse(readFileSync(EVAL, "utf8"))
  : {};
const evalLower = (name: string): Set<string> => {
  const q = evalSet[name];
  return new Set(
    q ? [...q.en, ...q.bg].map((s) => s.trim().toLowerCase()) : [],
  );
};

const genForTool = async (
  apiKey: string,
  tool: (typeof TOOLS)[number],
): Promise<ToolQueries> => {
  const examples = (tool.examples ?? [])
    .flatMap((e) => [e.en, e.bg])
    .map((s) => `  - ${s}`)
    .join("\n");
  const prompt = `You generate realistic, DIVERSE search/chat queries for ONE tool of a Bulgarian elections & public-data site. These are TRAINING examples — maximize variety.

TOOL: ${tool.name}  (domain: ${tool.domain})
WHAT IT ANSWERS (EN): ${tool.description.en}
WHAT IT ANSWERS (BG): ${tool.description.bg}
EXISTING phrasings (do NOT reuse — go further):
${examples || "  (none)"}

Write ${N} English and ${N} Bulgarian queries a real user would type to get THIS tool's answer.
Maximize diversity: vary length (terse keywords AND full questions), formality (colloquial AND formal), and SUBSTITUTE real entities (party names, oblasti, municipalities, settlements, years) where the tool takes them. Use synonyms, NOT the description's vocabulary. Bulgarian must read natural, not translated.
Each query must be answerable specifically by THIS tool.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 1.0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            en: { type: "ARRAY", items: { type: "STRING" } },
            bg: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["en", "bg"],
        },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok)
    throw new Error(
      `gemini ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parsed = JSON.parse(
    json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}",
  ) as ToolQueries;
  // dedupe vs eval set + examples (leakage guard) + within-tool
  const banned = evalLower(tool.name);
  for (const e of tool.examples ?? [])
    for (const s of [e.en, e.bg]) banned.add(s.trim().toLowerCase());
  const clean = (xs: string[] = []) => {
    const seen = new Set<string>();
    return xs
      .map((s) => s.trim())
      .filter((s) => {
        const k = s.toLowerCase();
        if (!s || banned.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  };
  return { en: clean(parsed.en), bg: clean(parsed.bg) };
};

const pool = async <T>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i]);
      }
    }),
  );
};

const main = async () => {
  const cache: Cache = existsSync(CACHE)
    ? JSON.parse(readFileSync(CACHE, "utf8"))
    : {};
  const missing = TOOLS.filter(
    (t) =>
      !cache[t.name] || cache[t.name].en.length + cache[t.name].bg.length === 0,
  );
  if (missing.length) {
    loadGeminiEnv();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not set (.env.local)");
    console.error(
      `generating training queries for ${missing.length}/${TOOLS.length} tools via ${MODEL}…`,
    );
    let done = 0;
    await pool(missing, 6, async (t) => {
      try {
        cache[t.name] = await genForTool(apiKey, t);
      } catch (e) {
        console.error(
          `  ! ${t.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
        cache[t.name] = { en: [], bg: [] };
      }
      if (++done % 10 === 0) {
        writeFileSync(CACHE, JSON.stringify(cache, null, 2));
        console.error(`  …${done}/${missing.length}`);
      }
    });
  }
  writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  const total = Object.values(cache).reduce(
    (s, q) => s + q.en.length + q.bg.length,
    0,
  );
  console.error(
    `done: ${total} training queries across ${Object.keys(cache).length} tools → ${CACHE}`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
