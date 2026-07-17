// ГИТ labour-inspection ingest / verifier for the social view (plan §4.10 / §9,
// Phase 3+). The Изпълнителна агенция „Главна инспекция по труда" (ГИТ) publishes its
// activity statistics only in the annual „Доклад за дейността" PDF (national/annual).
// Like the АСП benefits, the figures live in narrative prose, so this VERIFIES a
// curated data/social/git_inspections.json against the latest report rather than
// blindly parsing multi-year prose. Run:
//   npx tsx scripts/social/fetch_git_inspections.ts            (verify latest)
//   npx tsx scripts/social/fetch_git_inspections.ts --year 2025

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { writeFileSync, rmSync } from "node:fs";
import { Agent, fetch as undiciFetch } from "undici";

// gli.government.bg serves an incomplete certificate chain, so use a permissive
// TLS dispatcher (same as the watcher's insecureTls) for the report download.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

interface GitFile {
  latestYear: number;
  source: { reports: Record<string, string> };
  series: { year: number; inspections: number; violations: number }[];
}

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const DATA = join(ROOT, "data/social/git_inspections.json");

const numAfter = (text: string, anchor: RegExp): number | null => {
  const m = text.match(anchor);
  if (!m) return null;
  const n = Number((m[1] ?? "").replace(/\s/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const fetchPdfText = async (url: string): Promise<string> => {
  const res = await undiciFetch(url, { dispatcher: insecureAgent });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const pdf = join(tmpdir(), `git_${Date.now()}.pdf`);
  writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
  try {
    return execFileSync("pdftotext", ["-layout", pdf, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } finally {
    rmSync(pdf, { force: true });
  }
};

const main = async () => {
  const data = JSON.parse(readFileSync(DATA, "utf8")) as GitFile;
  const yearArg = process.argv.indexOf("--year");
  const year =
    yearArg >= 0 ? Number(process.argv[yearArg + 1]) : data.latestYear;
  const url = data.source.reports[String(year)];
  if (!url) {
    console.error(`No report URL for ${year} in git_inspections.json`);
    process.exit(1);
  }

  console.log(
    `Verifying ГИТ ${year} report against curated git_inspections.json…`,
  );
  const text = (await fetchPdfText(url))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ");

  const extracted = {
    inspections: numAfter(text, /извършени общо\s+([\d\s]+?)\s+бр/i),
    violations: numAfter(text, /констатирани общо\s+([\d\s]{4,}?)\s/i),
  };
  const cur = data.series.find((s) => s.year === year);

  const checks: [string, number | null, number | null][] = [
    ["inspections", extracted.inspections, cur?.inspections ?? null],
    ["violations", extracted.violations, cur?.violations ?? null],
  ];

  let drift = 0;
  console.log("\nAnchor validation (extracted vs curated):");
  for (const [label, got, c] of checks) {
    if (got == null) {
      console.log(`  ⚠ ${label}: not found in PDF — curated ${c ?? "—"}`);
      continue;
    }
    const ok = c != null && Math.abs(got - c) / c < 0.01;
    if (ok)
      console.log(`  ✓ ${label}: ${got.toLocaleString()} (matches curated)`);
    else {
      console.log(`  ✗ ${label}: PDF=${got.toLocaleString()} vs curated=${c?.toLocaleString() ?? "—"} — UPDATE git_inspections.json`); // prettier-ignore
      drift++;
    }
  }
  console.log(
    drift === 0
      ? "\n✓ Curated data/social/git_inspections.json matches the latest report."
      : `\n✗ ${drift} figure(s) drifted — update data/social/git_inspections.json.`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
