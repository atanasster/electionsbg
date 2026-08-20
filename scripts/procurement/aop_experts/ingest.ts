// Crawl the АОП external-experts register (plan P4) into a COMMITTED artifact.
//
// 77 GETs, no session, no auth. The whole register is 88 people, so the output is
// committed rather than gitignored: the loader is then pure-load and a fresh clone
// can build the table with no network. `npm run aop:experts` re-crawls.
//
// ⚠️ THE REGISTER IS CLOSED IN PRACTICE (see sources.ts). Nothing here filters on
// validity — a historical register is the product, and dropping expired rows would
// leave an EMPTY dataset. What must never happen is a consumer reading these rows
// as a present-tense claim; `coverage` exists so it cannot.

import fs from "node:fs";
import path from "node:path";
import { foldExperts, parseAreaPage, type AreaPage } from "./parse";
import { AOP_EXPERT_AREAS, AOP_EXPERTS_UA, areaUrl } from "./sources";

const OUT = path.join(process.cwd(), "data/procurement/aop_experts.json");
const DELAY_MS = 400;
/** The register is closed, so a shrink means a parse regression or an outage —
 *  never a real change. It refuses rather than committing a smaller corpus. */
const MAX_SHRINK = 0.05;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const fetchArea = async (area: number): Promise<AreaPage> => {
  const res = await fetch(areaUrl(area), {
    headers: { "User-Agent": AOP_EXPERTS_UA },
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) throw new Error(`area ${area}: HTTP ${res.status}`);
  // windows-1251 — decoding as UTF-8 yields mojibake that still passes row counts.
  const html = new TextDecoder("windows-1251").decode(await res.arrayBuffer());
  return parseAreaPage(html, area);
};

const main = async (): Promise<void> => {
  const pages: AreaPage[] = [];
  const perArea: Record<number, number> = {};
  for (const area of AOP_EXPERT_AREAS) {
    const p = await fetchArea(area);
    pages.push(p);
    if (p.rows.length) perArea[area] = p.rows.length;
    await sleep(DELAY_MS);
  }

  const experts = foldExperts(pages);
  const untils = experts.map((e) => e.validUntil).filter(Boolean) as string[];
  const today = new Date().toISOString().slice(0, 10);

  const out = {
    // Everything a consumer needs in order NOT to over-claim. `stillValid` is
    // computed at crawl time and re-derived by the loader, so neither side can
    // present this register in the present tense by accident.
    coverage: {
      source: "АОП — Списък с външни експерти по чл. 232а, ал. 2 от ЗОП",
      url: "https://www.aop.bg/ets.php",
      crawledAt: new Date().toISOString(),
      areasQueried: AOP_EXPERT_AREAS.length,
      areasWithExperts: Object.keys(perArea).length,
      expertCount: experts.length,
      earliestFrom:
        experts
          .map((e) => e.validFrom)
          .filter(Boolean)
          .sort()[0] ?? null,
      latestFrom:
        experts
          .map((e) => e.validFrom)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
      latestUntil: untils.sort().at(-1) ?? null,
      stillValidOnCrawlDate: untils.filter((u) => u >= today).length,
    },
    perArea,
    experts,
  };

  if (fs.existsSync(OUT)) {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8")) as {
      experts?: unknown[];
    };
    const before = prev.experts?.length ?? 0;
    if (before && experts.length < before * (1 - MAX_SHRINK))
      throw new Error(
        `refusing to write: ${before} → ${experts.length} expert(s). The register ` +
          `is closed, so a shrink is a parse regression or an outage, not news.`,
      );
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`, "utf8");
  console.log(
    `✓ ${experts.length} expert(s) across ${out.coverage.areasWithExperts} of ` +
      `${AOP_EXPERT_AREAS.length} area(s) → ${path.relative(process.cwd(), OUT)}`,
  );
  console.log(
    `  validity ${out.coverage.earliestFrom} … ${out.coverage.latestUntil} · ` +
      `still valid today: ${out.coverage.stillValidOnCrawlDate}`,
  );
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
