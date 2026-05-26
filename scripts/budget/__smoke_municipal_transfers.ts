// Smoke test for the Article 53 parser. Decompresses the cached 2025 budget
// law HTML, runs parseMunicipalTransfers, and prints a one-screen summary +
// any unresolved names. Run with: tsx scripts/budget/__smoke_municipal_transfers.ts

import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseMunicipalTransfers,
  buildTotalsFile,
  buildByOblastFile,
  buildByMunicipalityFile,
} from "./municipal_transfers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cachedHtml = (year: number): string => {
  const file = path.resolve(
    __dirname,
    "../../raw_data/budget",
    `law-${year}.html.gz`,
  );
  return zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
};

const fmt = (eur: number): string =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(eur);

const main = (): void => {
  const year = Number(process.argv[2] ?? 2025);
  const html = cachedHtml(year);
  const parsed = parseMunicipalTransfers(html, year);

  console.log(`\n=== Article 53 / fiscal year ${year} ===\n`);
  console.log(`Municipalities parsed:    ${parsed.municipalities.length}`);
  console.log(`Unresolved names:         ${parsed.unresolvedNames.length}`);
  if (parsed.unresolvedNames.length > 0) {
    console.log(
      `   →`,
      parsed.unresolvedNames.slice(0, 20).join(", "),
      parsed.unresolvedNames.length > 20 ? "…" : "",
    );
  }

  console.log(`\nTotals (from lead paragraph):`);
  for (const [k, v] of Object.entries(parsed.totals)) {
    console.log(`   ${k.padEnd(14)}  ${v ? fmt(v.amountEur) : "—"}`);
  }
  console.log(`\nSum-of-rows (canary):`);
  for (const [k, v] of Object.entries(parsed.rowSum)) {
    console.log(`   ${k.padEnd(14)}  ${fmt(v.amountEur)}`);
  }

  console.log(`\nReconciliation deltas (rows − paragraph), EUR:`);
  const deltas: Record<string, number> = {};
  for (const k of [
    "delegated",
    "equalization",
    "winter",
    "capital",
    "otherTargeted",
  ] as const) {
    const lead = parsed.totals[k]?.amountEur ?? 0;
    const sum = parsed.rowSum[k]?.amountEur ?? 0;
    deltas[k] = sum - lead;
    console.log(`   ${k.padEnd(14)}  ${(sum - lead).toLocaleString("en")} EUR`);
  }

  // Sample 3 rows for visual sanity-check.
  console.log(`\nSample rows:`);
  const samples = [
    parsed.municipalities.find((m) => m.nameBg === "Банско"),
    parsed.municipalities.find((m) => m.nameBg === "Столична"),
    parsed.municipalities.find(
      (m) => m.nameBg === "Бяла" && m.oblastCode === "RSE",
    ),
  ];
  for (const m of samples) {
    if (!m) continue;
    console.log(
      `   ${m.nameBg.padEnd(20)} oblast=${m.oblastCode.padEnd(4)} ekatte=${m.ekatte.padEnd(7)} total=${fmt(m.total?.amountEur ?? 0)}`,
    );
  }

  // Artifact-builder smoke: each builder should return a serializable object.
  const source = {
    documentId: `law-${year}`,
    url: `https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=test`,
  };
  const totalsFile = buildTotalsFile(parsed, `${year}-01-01`, source);
  const oblastFile = buildByOblastFile(parsed, `${year}-01-01`, source);
  const muniFile = buildByMunicipalityFile(parsed, `${year}-01-01`, source);
  console.log(
    `\nArtifact builders: totals=${JSON.stringify(totalsFile).length}B, ` +
      `oblasts=${oblastFile.oblasts.length} rows, ` +
      `municipalities=${muniFile.municipalities.length} rows`,
  );

  // Sample 5 oblasts aggregated.
  const byOblast = new Map<string, number>();
  for (const m of parsed.municipalities) {
    const cur = byOblast.get(m.oblastCode) ?? 0;
    byOblast.set(m.oblastCode, cur + (m.total?.amountEur ?? 0));
  }
  console.log(`\nTop 5 oblasts by total state→municipal transfer (EUR):`);
  [...byOblast.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([code, eur]) => {
      console.log(`   ${code.padEnd(5)} ${fmt(eur)}`);
    });
};

main();
