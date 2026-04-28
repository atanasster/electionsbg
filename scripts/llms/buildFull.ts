// Build /public/llms-full.txt — concatenated long-form content for AI / LLM
// crawlers. The /llms.txt overview is unchanged; this is the "full" variant
// that some crawlers prefer (analogous to llms-full.txt in the de-facto spec).
//
// Output stays plain Markdown so a model can read it without extra parsing.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ElectionInfo, PartyInfo, RegionInfo } from "@/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PUBLIC = path.join(PROJECT_ROOT, "public");
const SITE_URL = "https://electionsbg.com";

const BG_MONTHS = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];

const formatBgDate = (folder: string): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(folder);
  if (!m) return folder;
  return `${parseInt(m[3], 10)} ${BG_MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
};

const fmtInt = (n: number): string => Math.round(n).toLocaleString("bg-BG");
const fmtPct = (n: number, digits = 2): string =>
  `${n.toFixed(digits).replace(".", ",")}%`;
const fmtSignedPct = (n: number, digits = 2): string =>
  `${n > 0 ? "+" : ""}${n.toFixed(digits).replace(".", ",")} пп`;

type NationalSummary = {
  election: string;
  priorElection?: string;
  turnout: {
    actual: number;
    registered: number;
    pct: number;
    deltaPct?: number;
  };
  topGainer?: { nickName: string; deltaPct: number };
  topLoser?: { nickName: string; deltaPct: number };
  paperMachine?: { paperPct: number; machinePct: number };
  anomalies?: {
    total: number;
    recount: number;
    suemgRemoved: number;
    problemSections: number;
  };
  parties: Array<{
    partyNum: number;
    nickName: string;
    name?: string;
    totalVotes: number;
    pct: number;
    deltaPct?: number;
    seats?: number;
    passedThreshold?: boolean;
  }>;
};

const elections: ElectionInfo[] = JSON.parse(
  fs.readFileSync(
    path.join(PROJECT_ROOT, "src/data/json/elections.json"),
    "utf-8",
  ),
);
const latest = elections[0]?.name;

const lines: string[] = [];

lines.push(`# electionsbg.com — full long-form corpus`);
lines.push("");
lines.push(
  `> Long-form Bulgarian-language content from electionsbg.com — national summary, party retrospects, and polling-agency analysis. Refreshed each build. The shorter overview lives at ${SITE_URL}/llms.txt.`,
);
lines.push("");
lines.push(`Site: ${SITE_URL}`);
lines.push(`Sitemap index: ${SITE_URL}/sitemap_index.xml`);
lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
lines.push("");

// ------------------------------------------------------------------
// Latest national summary
// ------------------------------------------------------------------
const nsFile = path.join(PUBLIC, latest ?? "", "national_summary.json");
let summary: NationalSummary | null = null;
if (latest && fs.existsSync(nsFile)) {
  summary = JSON.parse(fs.readFileSync(nsFile, "utf-8"));
}

if (latest && summary) {
  lines.push(
    `## Парламентарни избори ${formatBgDate(latest)} — национално резюме`,
  );
  lines.push("");
  lines.push(
    `Избирателна активност: ${fmtPct(summary.turnout.pct)} (${fmtInt(summary.turnout.actual)} от ${fmtInt(summary.turnout.registered)} регистрирани).`,
  );
  if (summary.topGainer && summary.topLoser) {
    lines.push(
      `Най-голям ръст: ${summary.topGainer.nickName} (${fmtSignedPct(summary.topGainer.deltaPct)}). Най-голям спад: ${summary.topLoser.nickName} (${fmtSignedPct(summary.topLoser.deltaPct)}).`,
    );
  }
  if (summary.paperMachine) {
    lines.push(
      `Хартия / машинно гласуване: ${fmtPct(summary.paperMachine.paperPct)} / ${fmtPct(summary.paperMachine.machinePct)}.`,
    );
  }
  if (summary.anomalies) {
    lines.push(
      `Засечени отклонения по секции: ${fmtInt(summary.anomalies.total)} (повторно преброяване: ${fmtInt(summary.anomalies.recount)}; СУЕМГ свалени: ${fmtInt(summary.anomalies.suemgRemoved)}; проблемни секции: ${fmtInt(summary.anomalies.problemSections)}).`,
    );
  }
  lines.push("");
  lines.push("### Партии и резултати");
  lines.push("");
  lines.push("| Партия | Гласове | % | Δ | Мандати |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const p of summary.parties) {
    lines.push(
      `| ${p.nickName} | ${fmtInt(p.totalVotes)} | ${fmtPct(p.pct)} | ${
        p.deltaPct != null ? fmtSignedPct(p.deltaPct) : ""
      } | ${p.seats ?? ""} |`,
    );
  }
  lines.push("");
}

// ------------------------------------------------------------------
// Party retrospects (latest election)
// ------------------------------------------------------------------
if (latest) {
  const partiesFile = path.join(PUBLIC, latest, "cik_parties.json");
  const assessmentDir = path.join(PUBLIC, latest, "parties", "assessment");
  if (fs.existsSync(partiesFile) && fs.existsSync(assessmentDir)) {
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(partiesFile, "utf-8"),
    );
    const partyByNum = new Map(parties.map((p) => [p.number, p]));
    const files = fs
      .readdirSync(assessmentDir)
      .filter((f) => f.endsWith(".json"));
    if (files.length) {
      lines.push(`## Партии — ретроспективен анализ`);
      lines.push("");
      lines.push(
        `Анализ на представянето на всяка партия преминала прага на ${formatBgDate(latest)} — какво проработи, какво не и стратегически бележки за следващия вот.`,
      );
      lines.push("");
      for (const f of files) {
        const partyNum = parseInt(f.replace(".json", ""), 10);
        const party = partyByNum.get(partyNum);
        if (!party) continue;
        try {
          const a = JSON.parse(
            fs.readFileSync(path.join(assessmentDir, f), "utf-8"),
          );
          if (!a.bg) continue;
          const label =
            party.name && party.name !== party.nickName
              ? `${party.name} (${party.nickName})`
              : party.nickName;
          lines.push(`### ${label}`);
          lines.push("");
          lines.push(
            `URL: ${SITE_URL}/party/${encodeURIComponent(party.nickName)}`,
          );
          lines.push("");
          lines.push(a.bg);
          lines.push("");
        } catch {
          continue;
        }
      }
    }
  }
}

// ------------------------------------------------------------------
// Polls analysis
// ------------------------------------------------------------------
const pollsAnalysis = path.join(PUBLIC, "polls", "analysis.json");
const pollsAgencies = path.join(PUBLIC, "polls", "agencies.json");
if (fs.existsSync(pollsAnalysis) && fs.existsSync(pollsAgencies)) {
  const analysis = JSON.parse(fs.readFileSync(pollsAnalysis, "utf-8"));
  const agencies = JSON.parse(fs.readFileSync(pollsAgencies, "utf-8"));
  const agencyById = new Map<
    string,
    { name_bg: string; website?: string | null }
  >(
    agencies.map(
      (a: { id: string; name_bg: string; website?: string | null }) => [
        a.id,
        a,
      ],
    ),
  );
  if (Array.isArray(analysis.agencyTakes) && analysis.agencyTakes.length) {
    lines.push(`## Социологически проучвания — анализ по агенции`);
    lines.push("");
    for (const t of analysis.agencyTakes) {
      const agency = agencyById.get(t.agencyId);
      if (!agency) continue;
      lines.push(`### ${agency.name_bg}`);
      lines.push("");
      lines.push(`URL: ${SITE_URL}/polls/${encodeURIComponent(t.agencyId)}`);
      if (agency.website) lines.push(`Сайт: ${agency.website}`);
      lines.push("");
      if (t.summary?.bg) {
        lines.push(`**Резюме:** ${t.summary.bg}`);
        lines.push("");
      }
      if (t.lean?.bg) {
        lines.push(`**Профил на отклоненията:** ${t.lean.bg}`);
        lines.push("");
      }
      if (t.warning?.bg) {
        lines.push(`**Предупреждение:** ${t.warning.bg}`);
        lines.push("");
      }
    }
  }
}

// ------------------------------------------------------------------
// Region quick-reference (oblast → URL)
// ------------------------------------------------------------------
const regionsFile = path.join(PROJECT_ROOT, "src/data/json/regions.json");
if (fs.existsSync(regionsFile)) {
  const regions: RegionInfo[] = JSON.parse(
    fs.readFileSync(regionsFile, "utf-8"),
  );
  const valid = regions.filter((r) => r.oblast !== "32");
  if (valid.length) {
    lines.push(`## Области (МИР) — бързи връзки`);
    lines.push("");
    for (const r of valid) {
      const name = r.long_name || r.name;
      lines.push(`- ${name}: ${SITE_URL}/municipality/${r.oblast}`);
    }
    lines.push("");
  }
}

const out = lines.join("\n");
fs.writeFileSync(path.join(PUBLIC, "llms-full.txt"), out, "utf-8");
console.log(`llms-full.txt: ${out.length} bytes, ${lines.length} lines`);
