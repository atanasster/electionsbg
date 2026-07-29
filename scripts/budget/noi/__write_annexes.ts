// Generator: write data/budget/noi/mod_schedule.json + tzpb_rates.json — the
// per-industry statutory tables from the ЗБДОО annexes.
//
//   npx tsx scripts/budget/noi/__write_annexes.ts [--refresh]
//
// Unlike the other budget artifacts under noi/, these are PARSED, not
// hand-keyed: the annexes are ~1,500 cells a year, which is well past what a
// human transcription can be trusted with. The source is the promulgated ДВ
// HTML, cached under raw_data/budget/ by idMat.
//
// Two things the plan for this task got wrong, corrected here against the
// measured text (ЗБДОО-2026, idMat 244982):
//   • "744 cells" is the POPULATED count. The grid is 86 rows × 9 groups = 774
//     positions, 30 of which are legitimately blank. A checker written against
//     774 rejects correct data; one written against 744 rows/groups is nonsense.
//   • Прил. 2 has a 2А twin, exactly like Прил. 1 — the ТЗПБ rates are
//     split-year too, not a single annual table.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchLawHtml } from "../fetch_sources";
import {
  parseModAnnex,
  parseTzpbAnnex,
  QUALIFICATION_GROUPS,
  type ModAnnex,
  type TzpbAnnex,
} from "./parse_zbdoo_annexes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, "../../../data/budget/noi");

/** ЗБДОО-2026 — обн. ДВ бр. 68 от 28.07.2026. */
const LAW = {
  fiscalYear: 2026,
  idMat: "244982",
  dvIssue: "ДВ бр. 68 от 28.07.2026",
  title: "Закон за бюджета на държавното обществено осигуряване за 2026 г.",
};

/** Expected activity-row counts, asserted so a truncated table is fatal. */
const MOD_ROWS = 86;
const TZPB_ROWS = 87;

const main = async (): Promise<void> => {
  const refresh = process.argv.includes("--refresh");
  const html = await fetchLawHtml(LAW.fiscalYear, LAW.idMat, { refresh });
  console.log(`ЗБДОО ${LAW.fiscalYear} (${LAW.idMat}): ${html.length} bytes\n`);

  const mod: ModAnnex[] = [
    parseModAnnex(html, {
      annex: "1",
      fromMarker: "Приложение № 1",
      toMarker: "Приложение № 1А",
      periodFrom: "2026-01-01",
      periodTo: "2026-07-31",
      floorEur: 550.66,
      expectedRows: MOD_ROWS,
    }),
    parseModAnnex(html, {
      annex: "1А",
      fromMarker: "Приложение № 1А",
      toMarker: "Приложение № 2",
      periodFrom: "2026-08-01",
      periodTo: "2026-12-31",
      floorEur: 620.2,
      expectedRows: MOD_ROWS,
    }),
  ];

  const tzpb: TzpbAnnex[] = [
    parseTzpbAnnex(html, {
      annex: "2",
      fromMarker: "Приложение № 2",
      toMarker: "Приложение № 2А",
      periodFrom: "2026-01-01",
      periodTo: "2026-07-31",
      expectedRows: TZPB_ROWS,
    }),
    parseTzpbAnnex(html, {
      annex: "2А",
      fromMarker: "Приложение № 2А",
      toMarker: "Приложение № 3",
      periodFrom: "2026-08-01",
      periodTo: "2026-12-31",
      expectedRows: TZPB_ROWS,
    }),
  ];

  const source = {
    publisher: "Народно събрание / Държавен вестник",
    law: LAW.title,
    idMat: LAW.idMat,
    dvIssue: LAW.dvIssue,
    url: `https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=${LAW.idMat}`,
  };

  // Assert BEFORE writing. The smoke runs against the JSON this writer has
  // already overwritten, so a degraded parse that still satisfies the parser's
  // own structural checks would replace the committed artifact and exit 0 —
  // the smoke would then dutifully validate the degraded file.
  for (const a of mod) {
    if (a.stats.populatedCells !== 744 || a.stats.gridCells !== 774)
      throw new Error(
        `Прил. ${a.annex}: expected 774 grid / 744 populated cells, got ` +
          `${a.stats.gridCells}/${a.stats.populatedCells}. Refusing to overwrite ` +
          `the committed artifact with a degraded parse.`,
      );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "mod_schedule.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: {
          ...source,
          description:
            "Минимален осигурителен доход по икономически дейности (КИД-2025) и квалификационни групи професии, чл. 9, т. 1 ЗБДОО. Две таблици за 2026 г.: Прил. 1 (1 януари – 31 юли) и Прил. 1А (1 август – 31 декември). Празните клетки са реални — дейността няма работници в тази квалификационна група.",
        },
        fiscalYear: LAW.fiscalYear,
        qualificationGroups: QUALIFICATION_GROUPS,
        periods: mod,
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "tzpb_rates.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: {
          ...source,
          description:
            "Диференцирани осигурителни вноски за фонд „Трудова злополука и професионална болест“ по икономически дейности (КИД-2025), чл. 14, т. 1 ЗБДОО. Две таблици за 2026 г.: Прил. 2 (1 януари – 31 юли) и Прил. 2А (1 август – 31 декември).",
        },
        fiscalYear: LAW.fiscalYear,
        periods: tzpb,
      },
      null,
      2,
    ) + "\n",
  );

  for (const a of mod) {
    const s = a.stats;
    console.log(
      `Прил. ${a.annex.padEnd(2)} (${a.periodFrom}→${a.periodTo}, floor €${a.floorEur}): ` +
        `${a.rows.length} rows · ${s.gridCells} grid · ${s.populatedCells} populated · ` +
        `${s.blankCells} blank`,
    );
    console.log(
      `           above floor ${s.aboveFloor} (${((s.aboveFloor / s.populatedCells) * 100).toFixed(1)}%) · ` +
        `below floor ${s.belowFloor} · max €${s.maxEur}`,
    );
  }
  for (const a of tzpb) {
    const rates = [...new Set(a.rows.map((r) => r.ratePct))].sort(
      (x, y) => x - y,
    );
    console.log(
      `Прил. ${a.annex.padEnd(2)} (${a.periodFrom}→${a.periodTo}): ${a.rows.length} activities · rates ${rates.join(", ")}%`,
    );
  }
  console.log(`\nWrote ${OUT_DIR}/mod_schedule.json + tzpb_rates.json`);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
