// АСП benefit-disbursement ingest / verifier for the social view (plan §2.1 /
// Phase 3). The authoritative source is the АСП годишен отчет за дейността — a
// national/annual PDF, NOT egov (registers only) and NOT NSI (no oblast recipient
// series). No per-oblast breakdown is published anywhere, so the tiles are national.
//
// The figures live in year-varying NARRATIVE PROSE (not clean tables), so a blind
// multi-year regex parser is fragile. This script therefore does the robust thing:
// it downloads the latest report, `pdftotext -layout`s it, extracts the key anchored
// figures, and VALIDATES them against the curated data/social/benefits.json (the
// committed, source-verified baseline) — flagging drift for a human to update. Run:
//   npx tsx scripts/social/fetch_asp_benefits.ts            (verify latest)
//   npx tsx scripts/social/fetch_asp_benefits.ts --year 2025
//
// This mirrors the repo's other curated-national-data flows (defense mega-programs):
// low-volume, high-stakes numbers are human-verified against the source, not blindly
// scraped from prose. `feedback_no_json_from_pg`: the series is small static JSON.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { writeFileSync, rmSync } from "node:fs";

interface Benefits {
  latestYear: number;
  source: { reports: Record<string, string> };
  families: {
    id: string;
    unit: string;
    series: {
      year: number;
      season?: string;
      recipients?: number;
      households?: number;
      amountBgn: number;
    }[];
  }[];
}

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const BENEFITS = join(ROOT, "data/social/benefits.json");

/** Collapse the messy pdftotext whitespace and pull the first integer after an
 *  anchor phrase (digits may be space-grouped: "357 271"). */
const numAfter = (text: string, anchor: RegExp): number | null => {
  const m = text.match(anchor);
  if (!m) return null;
  const digits = (m[1] ?? "").replace(/\s/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const fetchPdfText = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const pdf = join(tmpdir(), `asp_${Date.now()}.pdf`);
  writeFileSync(pdf, buf);
  try {
    // -layout keeps the reading order; the anchors are prose, not columns.
    return execFileSync("pdftotext", ["-layout", pdf, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } finally {
    rmSync(pdf, { force: true });
  }
};

const main = async () => {
  const benefits = JSON.parse(readFileSync(BENEFITS, "utf8")) as Benefits;
  const yearArg = process.argv.indexOf("--year");
  const year =
    yearArg >= 0 ? Number(process.argv[yearArg + 1]) : benefits.latestYear;
  const url = benefits.source.reports[String(year)];
  if (!url) {
    console.error(`No report URL for ${year} in benefits.json`);
    process.exit(1);
  }

  console.log(
    `Verifying АСП ${year} report against curated benefits.json…\n${url}`,
  );
  const text = (await fetchPdfText(url))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ");

  // Extracted anchors (the stable phrasings observed in the 2024/2025 reports).
  const extracted = {
    heatingHouseholds: numAfter(text, /издадени\s+([\d\s]+?)\s+заповеди/i),
    childChildren: numAfter(
      text,
      /за\s+([\d\s]+?)\s+средномесечен\s+брой\s+деца/i,
    ),
    disabilityRecipients: numAfter(
      text,
      /финансова подкрепа на\s+([\d\s]{6,}?)\s+средномесечен/i,
    ),
  };

  // Compare to the curated latest-period values.
  const curated = (id: string, key: "households" | "recipients") => {
    const fam = benefits.families.find((f) => f.id === id);
    const pt = fam?.series
      .slice()
      .sort((a, b) => a.year - b.year)
      .at(-1);
    return (pt?.[key] ?? null) as number | null;
  };

  const checks: [string, number | null, number | null][] = [
    ["heating households", extracted.heatingHouseholds, curated("heating", "households")], // prettier-ignore
    ["child children", extracted.childChildren, curated("child", "recipients")],
    ["disability recipients", extracted.disabilityRecipients, curated("disability", "recipients")], // prettier-ignore
  ];

  let drift = 0;
  console.log("\nAnchor validation (extracted vs curated):");
  for (const [label, got, cur] of checks) {
    if (got == null) {
      console.log(`  ⚠ ${label}: not found in PDF (prose may have changed) — curated ${cur ?? "—"}`); // prettier-ignore
      continue;
    }
    const ok = cur != null && Math.abs(got - cur) / cur < 0.01;
    if (ok)
      console.log(`  ✓ ${label}: ${got.toLocaleString()} (matches curated)`);
    else {
      console.log(`  ✗ ${label}: PDF=${got.toLocaleString()} vs curated=${cur?.toLocaleString() ?? "—"} — UPDATE benefits.json`); // prettier-ignore
      drift++;
    }
  }
  console.log(
    drift === 0
      ? "\n✓ Curated data/social/benefits.json matches the latest report."
      : `\n✗ ${drift} figure(s) drifted — update data/social/benefits.json from the report and re-run.`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
