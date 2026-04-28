import fs from "fs";
import path from "path";
import { PartyInfo, RegionInfo } from "@/data/dataTypes";
import { SITE_URL } from "./routes";

const escapeHtml = (s: string): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const escapeAttr = escapeHtml;

const fmtInt = (n: number): string =>
  Math.round(n)
    .toLocaleString("bg-BG")
    .replace(/\u00A0/g, " ");

const fmtPct = (n: number, digits = 2): string =>
  `${n.toFixed(digits).replace(".", ",")}%`;

const fmtSignedPct = (n: number, digits = 2): string => {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits).replace(".", ",")} пп`;
};

// Render the BG date "27 октомври 2024" from a YYYY_MM_DD election folder name.
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

export const formatElectionDateBg = (folder: string): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(folder);
  if (!m) return folder;
  const year = m[1];
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  return `${day} ${BG_MONTHS[month - 1]} ${year}`;
};

// ------------------------------------------------------------------
// Tiny markdown → HTML converter for the AI-generated party/poll text.
// Supports only the subset that those payloads actually use:
//   ## headings, paragraphs, "- " bullet lists, **bold**.
// Tags are escaped so untrusted input cannot break out.
// ------------------------------------------------------------------
const inlineMd = (line: string): string => {
  // Bold first, then the surrounding text is escaped.
  // Strategy: split on **...**, escape each segment, re-wrap bold ones.
  const parts: string[] = [];
  let i = 0;
  const re = /\*\*([^*]+)\*\*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    if (match.index > i) parts.push(escapeHtml(line.slice(i, match.index)));
    parts.push(`<strong>${escapeHtml(match[1])}</strong>`);
    i = match.index + match[0].length;
  }
  if (i < line.length) parts.push(escapeHtml(line.slice(i)));
  return parts.join("");
};

export const markdownToHtml = (md: string): string => {
  if (!md) return "";
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let listOpen = false;
  let paraBuf: string[] = [];
  const flushPara = () => {
    if (paraBuf.length) {
      out.push(`<p>${paraBuf.map(inlineMd).join(" ")}</p>`);
      paraBuf = [];
    }
  };
  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      closeList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      const level = Math.min(h[1].length + 1, 6); // ## → h3 so h1 stays the page heading
      out.push(`<h${level}>${inlineMd(h[2])}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${inlineMd(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    paraBuf.push(line);
  }
  flushPara();
  closeList();
  return out.join("\n");
};

// ------------------------------------------------------------------
// Home page body — national summary table.
// ------------------------------------------------------------------

type NationalSummary = {
  election: string;
  priorElection?: string;
  turnout: {
    actual: number;
    registered: number;
    pct: number;
    priorPct?: number;
    deltaPct?: number;
  };
  topGainer?: { nickName: string; deltaPct: number };
  topLoser?: { nickName: string; deltaPct: number };
  paperMachine?: { paperPct: number; machinePct: number };
  anomalies?: { total: number };
  parties: Array<{
    partyNum: number;
    nickName: string;
    name?: string;
    totalVotes: number;
    pct: number;
    priorPct?: number;
    deltaPct?: number;
    seats?: number;
    passedThreshold?: boolean;
  }>;
};

export const buildHomeBody = (publicFolder: string, latest: string): string => {
  const file = path.join(publicFolder, latest, "national_summary.json");
  if (!fs.existsSync(file)) return "";
  const s: NationalSummary = JSON.parse(fs.readFileSync(file, "utf-8"));
  const dateLabel = formatElectionDateBg(latest);
  const parts: string[] = [];
  parts.push(
    `<h1>Парламентарни избори в България — последен вот: ${escapeHtml(dateLabel)}</h1>`,
  );
  parts.push(
    `<p>Избирателна активност: <strong>${fmtPct(s.turnout.pct)}</strong> (${fmtInt(s.turnout.actual)} от ${fmtInt(s.turnout.registered)} регистрирани).</p>`,
  );
  if (s.topGainer && s.topLoser) {
    parts.push(
      `<p>Най-голям ръст: <a href="${SITE_URL}/party/${encodeURIComponent(s.topGainer.nickName)}">${escapeHtml(s.topGainer.nickName)}</a> (${fmtSignedPct(s.topGainer.deltaPct)}). Най-голям спад: <a href="${SITE_URL}/party/${encodeURIComponent(s.topLoser.nickName)}">${escapeHtml(s.topLoser.nickName)}</a> (${fmtSignedPct(s.topLoser.deltaPct)}).</p>`,
    );
  }
  if (s.paperMachine) {
    parts.push(
      `<p>Хартия / машинно: ${fmtPct(s.paperMachine.paperPct)} / ${fmtPct(s.paperMachine.machinePct)}.</p>`,
    );
  }
  parts.push(`<h2>Партии и резултати</h2>`);
  parts.push(
    `<table><thead><tr><th>Партия</th><th>Гласове</th><th>%</th><th>Δ</th><th>Мандати</th></tr></thead><tbody>`,
  );
  for (const p of s.parties) {
    const linkable = p.passedThreshold !== false;
    const partyCell = linkable
      ? `<a href="${SITE_URL}/party/${encodeURIComponent(p.nickName)}">${escapeHtml(p.nickName)}</a>`
      : escapeHtml(p.nickName);
    parts.push(
      `<tr><td>${partyCell}</td><td>${fmtInt(p.totalVotes)}</td><td>${fmtPct(p.pct)}</td><td>${p.deltaPct != null ? fmtSignedPct(p.deltaPct) : ""}</td><td>${p.seats ?? ""}</td></tr>`,
    );
  }
  parts.push(`</tbody></table>`);
  if (s.anomalies) {
    parts.push(
      `<p>Засечени отклонения по секции: <strong>${fmtInt(s.anomalies.total)}</strong>. Виж <a href="${SITE_URL}/reports/section/problem_sections">проблемни секции</a>.</p>`,
    );
  }
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Party page body — assessment narrative + headline numbers.
// ------------------------------------------------------------------

type PartyAssessment = {
  partyNum: number;
  nickName: string;
  bg?: string;
  en?: string;
};

export const buildPartyBody = (
  publicFolder: string,
  latest: string,
  party: PartyInfo,
  summary: NationalSummary | null,
): string => {
  const assessmentFile = path.join(
    publicFolder,
    latest,
    "parties",
    "assessment",
    `${party.number}.json`,
  );
  const label =
    party.name && party.name !== party.nickName
      ? `${party.name} (${party.nickName})`
      : party.nickName;
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(label)}</h1>`);

  const summaryRow = summary?.parties.find((p) => p.partyNum === party.number);
  if (summaryRow) {
    const seats =
      summaryRow.seats != null ? `, ${summaryRow.seats} мандата` : "";
    const delta =
      summaryRow.deltaPct != null
        ? ` (${fmtSignedPct(summaryRow.deltaPct)} спрямо предишния вот)`
        : "";
    parts.push(
      `<p><strong>${fmtInt(summaryRow.totalVotes)}</strong> гласа · <strong>${fmtPct(summaryRow.pct)}</strong>${seats}${delta} на парламентарния вот ${escapeHtml(formatElectionDateBg(latest))}.</p>`,
    );
  }

  if (fs.existsSync(assessmentFile)) {
    try {
      const a: PartyAssessment = JSON.parse(
        fs.readFileSync(assessmentFile, "utf-8"),
      );
      if (a.bg) parts.push(markdownToHtml(a.bg));
    } catch {
      // ignore malformed assessment
    }
  }

  parts.push(
    `<p>Виж резултатите на ${escapeHtml(party.nickName)} <a href="${SITE_URL}/party/${encodeURIComponent(party.nickName)}/regions">по области</a>, <a href="${SITE_URL}/party/${encodeURIComponent(party.nickName)}/municipalities">общини</a>, <a href="${SITE_URL}/party/${encodeURIComponent(party.nickName)}/settlements">населени места</a>, <a href="${SITE_URL}/party/${encodeURIComponent(party.nickName)}/preferences">преференции</a>, и <a href="${SITE_URL}/party/${encodeURIComponent(party.nickName)}/donors">дарители</a>.</p>`,
  );
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Polls landing page + per-agency body.
// ------------------------------------------------------------------

type PollAgency = {
  id: string;
  name_bg: string;
  name_en: string;
  abbr_bg?: string;
  website?: string | null;
};

type PollAnalysisAgency = {
  agencyId: string;
  summary?: { bg?: string; en?: string };
  lean?: { bg?: string; en?: string };
  warning?: { bg?: string; en?: string };
};

export const buildPollsBody = (publicFolder: string): string => {
  const agenciesFile = path.join(publicFolder, "polls", "agencies.json");
  const analysisFile = path.join(publicFolder, "polls", "analysis.json");
  if (!fs.existsSync(agenciesFile)) return "";
  const agencies: PollAgency[] = JSON.parse(
    fs.readFileSync(agenciesFile, "utf-8"),
  );
  let analysis: { agencyTakes?: PollAnalysisAgency[] } = {};
  if (fs.existsSync(analysisFile)) {
    analysis = JSON.parse(fs.readFileSync(analysisFile, "utf-8"));
  }
  const takesById = new Map<string, PollAnalysisAgency>(
    (analysis.agencyTakes ?? []).map((a) => [a.agencyId, a]),
  );
  const parts: string[] = [];
  parts.push(`<h1>Социологически проучвания преди парламентарни избори</h1>`);
  parts.push(
    `<p>Точност на агенциите по предишни вотове, профил на отклоненията и предупреждения. Източник на проучванията: българска Уикипедия и сайтовете на агенциите.</p>`,
  );
  parts.push(`<h2>Агенции</h2>`);
  parts.push(
    `<table><thead><tr><th>Агенция</th><th>Кратко резюме</th></tr></thead><tbody>`,
  );
  for (const a of agencies) {
    const take = takesById.get(a.id);
    const summary = take?.summary?.bg ?? "";
    const link = `<a href="${SITE_URL}/polls/${encodeURIComponent(a.id)}">${escapeHtml(a.name_bg)}</a>`;
    parts.push(
      `<tr><td>${link}</td><td>${escapeHtml(summary.split(/[.!?]/)[0] || "")}</td></tr>`,
    );
  }
  parts.push(`</tbody></table>`);
  return parts.join("\n");
};

export const buildPollsAgencyBody = (
  publicFolder: string,
  agency: PollAgency,
): string => {
  const analysisFile = path.join(publicFolder, "polls", "analysis.json");
  if (!fs.existsSync(analysisFile)) return "";
  const analysis: { agencyTakes?: PollAnalysisAgency[] } = JSON.parse(
    fs.readFileSync(analysisFile, "utf-8"),
  );
  const take = (analysis.agencyTakes ?? []).find(
    (a) => a.agencyId === agency.id,
  );
  const parts: string[] = [];
  parts.push(
    `<h1>${escapeHtml(agency.name_bg)} — точност на проучванията</h1>`,
  );
  if (agency.website) {
    parts.push(
      `<p>Сайт: <a href="${escapeAttr(agency.website)}" rel="nofollow noopener">${escapeHtml(agency.website)}</a></p>`,
    );
  }
  if (!take) return parts.join("\n");
  if (take.summary?.bg) {
    parts.push(`<h2>Резюме</h2>`);
    parts.push(`<p>${escapeHtml(take.summary.bg)}</p>`);
  }
  if (take.lean?.bg) {
    parts.push(`<h2>Профил на отклоненията</h2>`);
    parts.push(`<p>${escapeHtml(take.lean.bg)}</p>`);
  }
  if (take.warning?.bg) {
    parts.push(`<h2>Предупреждение</h2>`);
    parts.push(`<p>${escapeHtml(take.warning.bg)}</p>`);
  }
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Per-election landing page body (/elections/{date}).
// ------------------------------------------------------------------

export const buildElectionLandingBody = (
  publicFolder: string,
  electionDate: string,
): string => {
  const file = path.join(publicFolder, electionDate, "national_summary.json");
  const dateLabel = formatElectionDateBg(electionDate);
  if (!fs.existsSync(file)) {
    // No summary on disk yet — emit a minimal heading so crawlers still see
    // a page, not an empty body.
    return `<h1>Парламентарни избори ${escapeHtml(dateLabel)}</h1>`;
  }
  const s: NationalSummary = JSON.parse(fs.readFileSync(file, "utf-8"));
  const parts: string[] = [];
  parts.push(
    `<h1>Парламентарни избори ${escapeHtml(dateLabel)} в България</h1>`,
  );
  parts.push(
    `<p>Избирателна активност: <strong>${fmtPct(s.turnout.pct)}</strong> (${fmtInt(s.turnout.actual)} от ${fmtInt(s.turnout.registered)} регистрирани).</p>`,
  );
  if (s.topGainer && s.topLoser) {
    parts.push(
      `<p>Най-голям ръст: <a href="${SITE_URL}/party/${encodeURIComponent(s.topGainer.nickName)}">${escapeHtml(s.topGainer.nickName)}</a> (${fmtSignedPct(s.topGainer.deltaPct)}). Най-голям спад: <a href="${SITE_URL}/party/${encodeURIComponent(s.topLoser.nickName)}">${escapeHtml(s.topLoser.nickName)}</a> (${fmtSignedPct(s.topLoser.deltaPct)}).</p>`,
    );
  }
  if (s.paperMachine) {
    parts.push(
      `<p>Хартия / машинно: ${fmtPct(s.paperMachine.paperPct)} / ${fmtPct(s.paperMachine.machinePct)}.</p>`,
    );
  }
  parts.push(`<h2>Партии и резултати</h2>`);
  parts.push(
    `<table><thead><tr><th>Партия</th><th>Гласове</th><th>%</th><th>Δ</th><th>Мандати</th></tr></thead><tbody>`,
  );
  for (const p of s.parties) {
    const linkable = p.passedThreshold !== false;
    const partyCell = linkable
      ? `<a href="${SITE_URL}/party/${encodeURIComponent(p.nickName)}">${escapeHtml(p.nickName)}</a>`
      : escapeHtml(p.nickName);
    parts.push(
      `<tr><td>${partyCell}</td><td>${fmtInt(p.totalVotes)}</td><td>${fmtPct(p.pct)}</td><td>${p.deltaPct != null ? fmtSignedPct(p.deltaPct) : ""}</td><td>${p.seats ?? ""}</td></tr>`,
    );
  }
  parts.push(`</tbody></table>`);
  if (s.anomalies) {
    parts.push(
      `<p>Засечени отклонения по секции: <strong>${fmtInt(s.anomalies.total)}</strong>.</p>`,
    );
  }
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Section page body — protocol numbers + party table.
// ------------------------------------------------------------------

type SectionBodyInput = {
  section: string;
  settlement: string;
  oblastName?: string;
  address?: string;
  numMachines?: number;
  ekatte?: string;
  oblastCode?: string;
  protocol?: {
    numRegisteredVoters?: number;
    totalActualVoters?: number;
    numValidVotes?: number;
    numValidMachineVotes?: number;
    numInvalidBallotsFound?: number;
  };
  topVotes?: Array<{ partyNum: number; nickName: string; totalVotes: number }>;
  totalValidVotes?: number;
};

export const buildSectionBody = (input: SectionBodyInput): string => {
  const { section, settlement, oblastName, address, ekatte, oblastCode } =
    input;
  const placeLabel = oblastName
    ? `${settlement}, обл. ${oblastName}`
    : settlement;
  const parts: string[] = [];
  parts.push(`<h1>Избирателна секция №${escapeHtml(section)}</h1>`);
  parts.push(`<p>${escapeHtml(placeLabel)}.</p>`);
  if (address) {
    parts.push(`<p>Адрес: ${escapeHtml(address.replace(/\s+/g, " "))}</p>`);
  }
  const p = input.protocol;
  if (p) {
    const registered = p.numRegisteredVoters ?? 0;
    const actual = p.totalActualVoters ?? 0;
    const turnoutPct =
      registered > 0
        ? ((actual / registered) * 100).toFixed(2).replace(".", ",")
        : "";
    // Per the protocol layout in src/data/dataTypes.ts: numValidVotes is the
    // count of valid PAPER votes (line 9 of the СИК protocol) and
    // numValidMachineVotes is the count of valid MACHINE votes (line 14).
    const paper = p.numValidVotes ?? 0;
    const machine = p.numValidMachineVotes ?? 0;
    const valid = paper + machine;
    parts.push(`<h2>Протокол</h2>`);
    parts.push(
      `<ul><li>Регистрирани избиратели: ${fmtInt(registered)}</li><li>Гласували: ${fmtInt(actual)}${turnoutPct ? ` (${turnoutPct}%)` : ""}</li><li>Действителни гласове: ${fmtInt(valid)}</li><li>Хартия: ${fmtInt(paper)} · Машинно: ${fmtInt(machine)}</li>${
        p.numInvalidBallotsFound != null
          ? `<li>Недействителни бюлетини: ${fmtInt(p.numInvalidBallotsFound)}</li>`
          : ""
      }</ul>`,
    );
  }
  if (input.topVotes && input.topVotes.length > 0) {
    parts.push(`<h2>Топ партии в секцията</h2>`);
    parts.push(
      `<table><thead><tr><th>Партия</th><th>Гласове</th><th>%</th></tr></thead><tbody>`,
    );
    const total = input.totalValidVotes ?? 0;
    for (const v of input.topVotes) {
      const pct =
        total > 0
          ? ((v.totalVotes / total) * 100).toFixed(2).replace(".", ",")
          : "";
      parts.push(
        `<tr><td><a href="${SITE_URL}/party/${encodeURIComponent(v.nickName)}">${escapeHtml(v.nickName)}</a></td><td>${fmtInt(v.totalVotes)}</td><td>${pct ? pct + "%" : ""}</td></tr>`,
      );
    }
    parts.push(`</tbody></table>`);
  }
  const navLinks: string[] = [];
  if (ekatte) {
    navLinks.push(
      `<a href="${SITE_URL}/settlement/${ekatte}">${escapeHtml(settlement)}</a>`,
    );
  }
  if (oblastCode && oblastName) {
    navLinks.push(
      `<a href="${SITE_URL}/municipality/${oblastCode}">обл. ${escapeHtml(oblastName)}</a>`,
    );
  }
  if (navLinks.length) {
    parts.push(`<p>Навигация: ${navLinks.join(" · ")}</p>`);
  }
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Settlement page body — ekatte-level summary.
// ------------------------------------------------------------------

type SettlementBodyInput = {
  ekatte: string;
  settlement: string;
  oblastName?: string;
  oblastCode?: string;
};

export const buildSettlementBody = (input: SettlementBodyInput): string => {
  const { ekatte, settlement, oblastName, oblastCode } = input;
  const placeLabel = oblastName
    ? `${settlement}, обл. ${oblastName}`
    : settlement;
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(placeLabel)}</h1>`);
  parts.push(
    `<p>Резултати на парламентарните избори в България в ${escapeHtml(placeLabel)} — гласуване по партии, преференции, машинно и хартиено гласуване, отклонения по секции.</p>`,
  );
  const navLinks: string[] = [
    `<a href="${SITE_URL}/sections/${ekatte}">Секции в ${escapeHtml(settlement)}</a>`,
    `<a href="${SITE_URL}/sections/${ekatte}/parties">Партии</a>`,
    `<a href="${SITE_URL}/sections/${ekatte}/preferences">Преференции</a>`,
    `<a href="${SITE_URL}/sections/${ekatte}/recount">Повторно преброяване</a>`,
    `<a href="${SITE_URL}/sections/${ekatte}/timeline">Времева линия</a>`,
  ];
  if (oblastCode && oblastName) {
    navLinks.unshift(
      `<a href="${SITE_URL}/municipality/${oblastCode}">обл. ${escapeHtml(oblastName)}</a>`,
    );
  }
  parts.push(`<p>${navLinks.join(" · ")}</p>`);
  return parts.join("\n");
};

// ------------------------------------------------------------------
// Oblast page body — region overview.
// ------------------------------------------------------------------

export const buildOblastBody = (region: RegionInfo): string => {
  const displayName = region.long_name || region.name;
  const parts: string[] = [];
  parts.push(`<h1>Резултати в област ${escapeHtml(displayName)}</h1>`);
  parts.push(
    `<p>Подробни резултати от парламентарните избори в България в област ${escapeHtml(displayName)} — гласуване по партии, преференции, машинно и хартиено гласуване, повторно преброяване и отклонения по секции.</p>`,
  );
  const code = region.oblast;
  parts.push(
    `<p><a href="${SITE_URL}/municipality/${code}/parties">Партии</a> · <a href="${SITE_URL}/municipality/${code}/preferences">Преференции</a> · <a href="${SITE_URL}/municipality/${code}/municipalities">Общини</a> · <a href="${SITE_URL}/municipality/${code}/recount">Повторно преброяване</a> · <a href="${SITE_URL}/municipality/${code}/timeline">Времева линия</a></p>`,
  );
  return parts.join("\n");
};
