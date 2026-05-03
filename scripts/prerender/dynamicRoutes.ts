import fs from "fs";
import path from "path";
import {
  CandidatesInfo,
  ElectionInfo,
  PartyInfo,
  RegionInfo,
  SectionIndex,
  SectionInfo,
  Votes,
} from "@/data/dataTypes";
import { PrerenderRoute, SITE_URL } from "./routes";
import {
  buildBreadcrumbLd,
  buildDatasetLd,
  buildFaqLd,
  buildPersonLd,
} from "./jsonLd";
import {
  buildElectionLandingBody,
  buildOblastBody,
  buildPartyBody,
  buildPollsAgencyBody,
  buildPollsBody,
  buildSectionBody,
  buildSectionsListBody,
  buildSettlementBody,
} from "./bodyBuilders";
import { buildArticleRoutes } from "./articleRoutes";

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

const formatElectionDateBg = (folder: string): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(folder);
  if (!m) return folder;
  return `${parseInt(m[3], 10)} ${BG_MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
};

type NationalSummaryFile = {
  parties: Array<{
    partyNum: number;
    nickName: string;
    name?: string;
    totalVotes: number;
    pct: number;
    deltaPct?: number;
    seats?: number;
    passedThreshold?: boolean;
    priorPct?: number;
  }>;
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
  election: string;
};

const readNationalSummary = (
  publicFolder: string,
  latest: string,
): NationalSummaryFile | null => {
  const file = path.join(publicFolder, latest, "national_summary.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
};

// Latest election as of build time (sorted descending in elections.json).
export const getLatestElection = (electionsFile: string): string => {
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );
  return elections[0].name;
};

const oblastDisplayName = (r: RegionInfo): string => r.long_name || r.name;

const buildOblastNameMap = (regions: RegionInfo[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const r of regions) {
    if (!map.has(r.oblast)) map.set(r.oblast, oblastDisplayName(r));
  }
  return map;
};

export const buildPartyRoutes = (
  publicFolder: string,
  latestElection: string,
): PrerenderRoute[] => {
  const file = path.join(publicFolder, latestElection, "cik_parties.json");
  if (!fs.existsSync(file)) return [];
  const parties: PartyInfo[] = JSON.parse(fs.readFileSync(file, "utf-8"));
  const summary = readNationalSummary(publicFolder, latestElection);
  return parties.map((p) => {
    const label =
      p.name && p.name !== p.nickName
        ? `${p.name} (${p.nickName})`
        : p.nickName;
    const url = `${SITE_URL}/party/${p.nickName}`;
    const enUrl = `${SITE_URL}/en/party/${p.nickName}`;
    const title = `${label} — Парламентарни избори в България | electionsbg.com`;
    const description = `Резултати на ${label} по години, области, общини и секции на парламентарните избори в България от 2005 г. насам, плюс декларирано финансиране.`;
    const titleEn = `${label} — Bulgarian Parliamentary Elections | electionsbg.com`;
    const descriptionEn = `Results of ${label} by year, region, municipality and section in Bulgaria's parliamentary elections since 2005, plus declared campaign financing.`;
    const bodyHtml = buildPartyBody(publicFolder, latestElection, p, summary);
    return {
      path: `party/${p.nickName}`,
      title,
      description,
      ogImage: `/og/party/${encodeURIComponent(p.nickName)}.png`,
      bodyHtml,
      jsonLd: [
        buildDatasetLd({
          name: `${label} — резултати по години и територии`,
          description,
          url,
          spatialCoverage: "България",
          keywords: [
            label,
            "парламентарни избори",
            "Bulgaria",
            "elections",
            "results",
          ],
          distribution: [
            {
              url: `${SITE_URL}/${latestElection}/parties/by_region/${p.number}.json`,
              name: "Резултати по области (JSON)",
            },
            {
              url: `${SITE_URL}/${latestElection}/parties/by_municipality/${p.number}.json`,
              name: "Резултати по общини (JSON)",
            },
          ],
        }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: label, url },
        ]),
      ],
      english: {
        title: titleEn,
        description: descriptionEn,
        bodyHtml,
        jsonLd: [
          buildDatasetLd({
            name: `${label} — results by year and territory`,
            description: descriptionEn,
            url: enUrl,
            spatialCoverage: "Bulgaria",
            keywords: [
              label,
              "Bulgarian elections",
              "parliamentary elections",
              "results",
            ],
          }),
          buildBreadcrumbLd([
            { name: "Home", url: `${SITE_URL}/en/` },
            { name: label, url: enUrl },
          ]),
        ],
      },
    };
  });
};

export const buildOblastRoutes = (
  regionsJsonPath: string,
  publicFolder?: string,
  latestElection?: string,
): PrerenderRoute[] => {
  const regions: RegionInfo[] = JSON.parse(
    fs.readFileSync(regionsJsonPath, "utf-8"),
  );
  return regions
    .filter((r) => r.oblast !== "32")
    .map((r) => {
      const displayName = oblastDisplayName(r);
      const url = `${SITE_URL}/municipality/${r.oblast}`;
      const title = `Резултати в ${displayName} — Парламентарни избори | electionsbg.com`;
      const description = `Подробни резултати, машинно гласуване, повторно преброяване и отклонения по секции в област ${displayName} на парламентарните избори в България.`;
      const distribution =
        publicFolder && latestElection
          ? [
              {
                url: `${SITE_URL}/${latestElection}/region_votes.json`,
                name: "Резултати по области (JSON)",
              },
            ]
          : undefined;
      return {
        path: `municipality/${r.oblast}`,
        title,
        description,
        ogImage: `/og/region/${r.oblast}.png`,
        bodyHtml: buildOblastBody(r),
        jsonLd: [
          buildDatasetLd({
            name: `Парламентарни избори — резултати в област ${displayName}`,
            description,
            url,
            spatialCoverage: displayName,
            keywords: [
              displayName,
              "парламентарни избори",
              "област",
              "резултати",
            ],
            distribution,
          }),
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            { name: `Област ${displayName}`, url },
          ]),
        ],
      };
    });
};

type SettlementBundleEntry = {
  ekatte?: string;
  name?: string;
  t_v_m?: string;
  oblast?: string;
};

export const buildSettlementRoutes = (
  publicFolder: string,
  latestElection: string,
  oblastNames: Map<string, string>,
): PrerenderRoute[] => {
  const byDir = path.join(publicFolder, latestElection, "settlements", "by");
  if (!fs.existsSync(byDir)) return [];
  const files = fs.readdirSync(byDir).filter((f) => f.endsWith(".json"));
  const seen = new Set<string>();
  const result: PrerenderRoute[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(byDir, f), "utf-8");
    let bundle: SettlementBundleEntry[];
    try {
      bundle = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const s of bundle) {
      if (!s.ekatte || seen.has(s.ekatte)) continue;
      seen.add(s.ekatte);
      const fullName = `${s.t_v_m ? s.t_v_m + " " : ""}${s.name ?? ""}`.trim();
      const oblastName = s.oblast ? oblastNames.get(s.oblast) : undefined;
      const labelWithOblast = oblastName
        ? `${fullName}, обл. ${oblastName}`
        : fullName;
      const url = `${SITE_URL}/settlement/${s.ekatte}`;
      const title = `Резултати в ${labelWithOblast} — Парламентарни избори | electionsbg.com`;
      const description = `Резултати по секции в ${labelWithOblast} на парламентарните избори в България — гласове, машинно гласуване и отклонения.`;
      const breadcrumb = oblastName
        ? [
            { name: "Начало", url: `${SITE_URL}/` },
            {
              name: `Област ${oblastName}`,
              url: `${SITE_URL}/municipality/${s.oblast}`,
            },
            { name: fullName, url },
          ]
        : [
            { name: "Начало", url: `${SITE_URL}/` },
            { name: fullName, url },
          ];
      result.push({
        path: `settlement/${s.ekatte}`,
        title,
        description,
        bodyHtml: buildSettlementBody({
          ekatte: s.ekatte,
          settlement: fullName,
          oblastName,
          oblastCode: s.oblast,
        }),
        jsonLd: [
          buildDatasetLd({
            name: `Парламентарни избори — резултати в ${labelWithOblast}`,
            description,
            url,
            spatialCoverage: labelWithOblast,
            keywords: [
              fullName,
              ...(oblastName ? [oblastName] : []),
              "парламентарни избори",
              "секции",
              "резултати",
            ],
          }),
          buildBreadcrumbLd(breadcrumb),
        ],
      });
    }
  }
  return result;
};

// /sections/{ekatte} — high-traffic landing page that lists every section in
// an EKATTE (Bulgarian settlement, Sofia subdivision, or 2-letter ISO country
// code for diaspora). Previously served by the SPA fallback only, so Google
// saw the homepage meta on these. Prerendering them gives each one its own
// title, description, body, and FAQ JSON-LD (diaspora only).
export const buildSectionsListRoutes = (
  publicFolder: string,
  latestElection: string,
  oblastNames: Map<string, string>,
): PrerenderRoute[] => {
  const byOblastDir = path.join(
    publicFolder,
    latestElection,
    "sections",
    "by-oblast",
  );
  if (!fs.existsSync(byOblastDir)) return [];

  const partiesFile = path.join(
    publicFolder,
    latestElection,
    "cik_parties.json",
  );
  const partyLabels = new Map<number, string>();
  if (fs.existsSync(partiesFile)) {
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(partiesFile, "utf-8"),
    );
    for (const p of parties) partyLabels.set(p.number, p.nickName || p.name);
  }

  type EkatteAgg = {
    ekatte: string;
    sections: SectionInfo[];
    isDiaspora: boolean;
    oblastCode: string;
  };
  const byEkatte = new Map<string, EkatteAgg>();
  for (const f of fs.readdirSync(byOblastDir)) {
    if (!f.endsWith(".json")) continue;
    let data: Record<string, SectionInfo>;
    try {
      data = JSON.parse(fs.readFileSync(path.join(byOblastDir, f), "utf-8"));
    } catch {
      continue;
    }
    for (const sec of Object.values(data)) {
      if (!sec.ekatte) continue;
      let agg = byEkatte.get(sec.ekatte);
      if (!agg) {
        agg = {
          ekatte: sec.ekatte,
          sections: [],
          isDiaspora: sec.oblast === "32",
          oblastCode: sec.oblast,
        };
        byEkatte.set(sec.ekatte, agg);
      }
      agg.sections.push(sec);
    }
  }

  // Display name lookup from settlement bundles (BG settlements + diaspora
  // countries). Sofia subdivisions like "68134-2302" aren't in this map and
  // are derived from section data below.
  const settlementMeta = new Map<string, { displayName: string }>();
  const settlementsBy = path.join(
    publicFolder,
    latestElection,
    "settlements",
    "by",
  );
  if (fs.existsSync(settlementsBy)) {
    for (const f of fs.readdirSync(settlementsBy)) {
      if (!f.endsWith(".json")) continue;
      let bundle: SettlementBundleEntry[];
      try {
        bundle = JSON.parse(
          fs.readFileSync(path.join(settlementsBy, f), "utf-8"),
        );
      } catch {
        continue;
      }
      for (const s of bundle) {
        if (!s.ekatte) continue;
        const name = `${s.t_v_m ? s.t_v_m + " " : ""}${s.name ?? ""}`.trim();
        if (name) settlementMeta.set(s.ekatte, { displayName: name });
      }
    }
  }

  const electionDateLabel = formatElectionDateBg(latestElection);
  const electionYear = latestElection.slice(0, 4);
  const FAQ_DIASPORA = [
    {
      question: "Кой може да гласува в чужбина?",
      answer:
        "Български граждани с навършени 18 години към изборния ден, без значение от постоянния им адрес.",
    },
    {
      question: "Какви документи са необходими за гласуване?",
      answer:
        "Валидна българска лична карта или паспорт. Не се изисква предварителна регистрация в деня на изборите за вече разкритите секции.",
    },
    {
      question: "Кога работят избирателните секции в чужбина?",
      answer:
        "Обикновено от 7:00 до 20:00 по местно време. Чакащите пред секцията в 20:00 имат право да гласуват.",
    },
  ];

  const result: PrerenderRoute[] = [];
  for (const [ekatte, agg] of byEkatte) {
    let displayName: string;
    if (agg.isDiaspora) {
      const meta = settlementMeta.get(ekatte);
      const fallback = agg.sections[0]?.settlement?.split(",")[0]?.trim();
      displayName = meta?.displayName || fallback || ekatte;
    } else {
      const meta = settlementMeta.get(ekatte);
      if (meta) {
        displayName = meta.displayName;
      } else {
        const settle =
          agg.sections[0]?.settlement?.trim() || `EKATTE ${ekatte}`;
        displayName = /^68134-/.test(ekatte)
          ? `${settle} (район ${ekatte.replace("68134-", "")})`
          : settle;
      }
    }
    const oblastName =
      !agg.isDiaspora && agg.oblastCode
        ? oblastNames.get(agg.oblastCode)
        : undefined;

    let registered = 0;
    let actual = 0;
    const partyVotes = new Map<number, number>();
    for (const s of agg.sections) {
      registered += s.results?.protocol?.numRegisteredVoters ?? 0;
      actual += s.results?.protocol?.totalActualVoters ?? 0;
      const votes = s.results?.votes ?? [];
      for (const v of votes) {
        partyVotes.set(
          v.partyNum,
          (partyVotes.get(v.partyNum) ?? 0) + (v.totalVotes ?? 0),
        );
      }
    }
    const turnoutPct = registered > 0 ? (actual / registered) * 100 : 0;
    const totalVotes = [...partyVotes.values()].reduce((a, b) => a + b, 0);
    const topParties =
      totalVotes > 0
        ? [...partyVotes.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([num, votes]) => ({
              nickName: partyLabels.get(num) ?? `№${num}`,
              totalVotes: votes,
              pct: (votes / totalVotes) * 100,
            }))
        : [];

    const sortedSections = [...agg.sections].sort((a, b) =>
      a.section.localeCompare(b.section),
    );
    const sectionItems = sortedSections.map((s) => {
      const settle = s.settlement?.trim() ?? "";
      const ci = settle.indexOf(",");
      return {
        section: s.section,
        address: s.address,
        cityLabel:
          agg.isDiaspora && ci >= 0 ? settle.slice(ci + 1).trim() : undefined,
      };
    });

    const placeLabel = oblastName
      ? `${displayName}, обл. ${oblastName}`
      : displayName;
    const url = `${SITE_URL}/sections/${ekatte}`;
    const sectionCount = sortedSections.length;
    const title = agg.isDiaspora
      ? `Избирателни секции в ${displayName} ${electionYear} — Парламентарни избори в България | electionsbg.com`
      : `Избирателни секции в ${placeLabel} — Парламентарни избори ${electionYear} | electionsbg.com`;
    const description = agg.isDiaspora
      ? `Списък на ${sectionCount} избирателни секции за гласуване в ${displayName} на парламентарния вот ${electionDateLabel} — градове, адреси и резултати.`
      : `${sectionCount} избирателни секции в ${placeLabel} с адреси и резултати по партии за парламентарния вот ${electionDateLabel}.`;

    const breadcrumb = agg.isDiaspora
      ? [
          { name: "Начало", url: `${SITE_URL}/` },
          { name: `Секции в ${displayName}`, url },
        ]
      : oblastName && agg.oblastCode
        ? [
            { name: "Начало", url: `${SITE_URL}/` },
            {
              name: `Област ${oblastName}`,
              url: `${SITE_URL}/municipality/${agg.oblastCode}`,
            },
            { name: `Секции в ${displayName}`, url },
          ]
        : [
            { name: "Начало", url: `${SITE_URL}/` },
            { name: `Секции в ${displayName}`, url },
          ];

    const jsonLd: object[] = [
      buildDatasetLd({
        name: `Избирателни секции — ${placeLabel}`,
        description,
        url,
        spatialCoverage: placeLabel,
        keywords: [
          "избирателни секции",
          "секции за гласуване",
          displayName,
          "парламентарни избори",
        ],
      }),
      buildBreadcrumbLd(breadcrumb),
    ];
    if (agg.isDiaspora) {
      jsonLd.push(buildFaqLd(FAQ_DIASPORA));
    }

    result.push({
      path: `sections/${ekatte}`,
      title,
      description,
      bodyHtml: buildSectionsListBody({
        ekatte,
        displayName,
        oblastName,
        oblastCode: agg.isDiaspora ? undefined : agg.oblastCode,
        isDiaspora: agg.isDiaspora,
        electionDateLabel,
        sections: sectionItems,
        aggregate:
          actual > 0 || topParties.length > 0
            ? { registered, actual, turnoutPct, topParties }
            : undefined,
      }),
      jsonLd,
    });
  }
  return result;
};

type CandidateAggregate = {
  parties: Set<string>;
  elections: Set<string>;
  // Per-election entries — used to render a "Кандидатствания" history table.
  // A candidate may run on multiple lists in one cycle (rare); keep all rows.
  history: Array<{ folder: string; partyLabel: string; oblast: string }>;
};

type MpIndexEntry = {
  id: number;
  name: string;
  normalizedName: string;
  photoUrl: string;
  currentRegion: { code: string; name: string } | null;
  currentPartyGroup: string | null;
  position: string | null;
  birthDate: string | null;
  isCurrent: boolean;
};

type RawMpProfile = {
  A_ns_MP_id: number;
  A_ns_MPL_Name1?: string;
  A_ns_MPL_Name2?: string;
  A_ns_MPL_Name3?: string;
  A_ns_MP_BDate?: string;
  A_ns_B_Country?: string;
  A_ns_B_City?: string;
  A_ns_MPL_Spec?: string;
  A_ns_MPL_Prof?: string;
  A_ns_MP_url?: string;
  A_ns_MP_fbook?: string;
  A_ns_MP_img?: string | null;
  oldnsList?: { A_nsL_value?: string; A_nsL_value_short?: string }[];
  lngList?: { LngL_value?: string; A_LngL_value?: string }[];
};

const normalizeName = (s: string): string =>
  s.toUpperCase().replace(/\s+/g, " ").trim();

const escapeHtmlSimple = (s: string): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const fmtBgDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = [
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
  return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
};

const buildCandidateBody = (
  name: string,
  partyLabels: string[],
  yearSpan: string,
  indexEntry: MpIndexEntry | undefined,
  profile: RawMpProfile | null,
  history: Array<{ folder: string; partyLabel: string; oblast: string }>,
  oblastNames: Map<string, string>,
): string => {
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtmlSimple(name)}</h1>`);
  const headline: string[] = [];
  if (indexEntry?.position)
    headline.push(escapeHtmlSimple(indexEntry.position));
  if (indexEntry?.currentRegion?.name) {
    headline.push(
      `народен представител от ${escapeHtmlSimple(indexEntry.currentRegion.name)}`,
    );
  } else if (partyLabels.length) {
    headline.push(
      `кандидат за народен представител${yearSpan ? ` (${yearSpan})` : ""}`,
    );
  }
  if (indexEntry?.currentPartyGroup) {
    headline.push(escapeHtmlSimple(indexEntry.currentPartyGroup));
  } else if (partyLabels.length) {
    headline.push(`от ${escapeHtmlSimple(partyLabels.join(", "))}`);
  }
  if (headline.length) parts.push(`<p>${headline.join(" · ")}.</p>`);

  const facts: string[] = [];
  const birthDate = fmtBgDate(indexEntry?.birthDate ?? profile?.A_ns_MP_BDate);
  if (birthDate) {
    const place = [profile?.A_ns_B_City, profile?.A_ns_B_Country]
      .filter(Boolean)
      .join(", ");
    facts.push(
      `Родена/роден на ${escapeHtmlSimple(birthDate)}${place ? ` в ${escapeHtmlSimple(place)}` : ""}`,
    );
  }
  if (profile?.A_ns_MPL_Prof) {
    facts.push(`Професия: ${escapeHtmlSimple(profile.A_ns_MPL_Prof.trim())}`);
  }
  if (profile?.A_ns_MPL_Spec) {
    facts.push(
      `Специалност: ${escapeHtmlSimple(profile.A_ns_MPL_Spec.trim())}`,
    );
  }
  const langs = (profile?.lngList ?? [])
    .map((l) => l.LngL_value ?? l.A_LngL_value ?? "")
    .filter(Boolean);
  if (langs.length) {
    facts.push(`Чужди езици: ${escapeHtmlSimple(langs.join(", "))}`);
  }
  if (profile?.oldnsList && profile.oldnsList.length) {
    const terms = profile.oldnsList
      .map((t) => t.A_nsL_value_short ?? t.A_nsL_value ?? "")
      .filter(Boolean)
      .join(", ");
    if (terms) facts.push(`Народни събрания: ${escapeHtmlSimple(terms)}`);
  }
  if (facts.length) {
    parts.push(`<ul>${facts.map((f) => `<li>${f}</li>`).join("")}</ul>`);
  }

  if (history.length > 0) {
    // Sort newest-first; the first row is what the candidate's name most often
    // resolves to in current search intent.
    const sorted = [...history].sort((a, b) =>
      b.folder.localeCompare(a.folder),
    );
    parts.push(`<h2>Кандидатствания</h2>`);
    parts.push(
      `<table><thead><tr><th>Избори</th><th>Листа</th><th>Област</th></tr></thead><tbody>`,
    );
    for (const h of sorted) {
      const dateLabel = formatElectionDateBg(h.folder);
      const partyCell = h.partyLabel.startsWith("№")
        ? escapeHtmlSimple(h.partyLabel)
        : `<a href="${SITE_URL}/party/${encodeURIComponent(h.partyLabel)}">${escapeHtmlSimple(h.partyLabel)}</a>`;
      const oblastLabel = h.oblast
        ? (oblastNames.get(h.oblast) ?? h.oblast)
        : "";
      const oblastCell =
        h.oblast && oblastNames.has(h.oblast)
          ? `<a href="${SITE_URL}/municipality/${h.oblast}">${escapeHtmlSimple(oblastLabel)}</a>`
          : escapeHtmlSimple(oblastLabel);
      parts.push(
        `<tr><td>${escapeHtmlSimple(dateLabel)}</td><td>${partyCell}</td><td>${oblastCell}</td></tr>`,
      );
    }
    parts.push(`</tbody></table>`);
  }

  if (indexEntry?.id) {
    parts.push(
      `<p><a href="https://www.parliament.bg/bg/MP/${indexEntry.id}" rel="nofollow noopener">parliament.bg</a></p>`,
    );
  }
  return parts.join("\n");
};

export const buildCandidateRoutes = (
  publicFolder: string,
  oblastNames: Map<string, string>,
): PrerenderRoute[] => {
  if (!fs.existsSync(publicFolder)) return [];
  const electionFolders = fs
    .readdirSync(publicFolder)
    .filter((f) => /^\d{4}_\d{2}_\d{2}$/.test(f))
    .sort()
    .reverse(); // most-recent first so we keep the latest party label per name

  // Build per-election partyNum → label map once and reuse.
  const partyLabelByElection = new Map<string, Map<number, string>>();
  for (const folder of electionFolders) {
    const partiesFile = path.join(publicFolder, folder, "cik_parties.json");
    if (!fs.existsSync(partiesFile)) continue;
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(partiesFile, "utf-8"),
    );
    const m = new Map<number, string>();
    for (const p of parties) m.set(p.number, p.nickName || p.name);
    partyLabelByElection.set(folder, m);
  }

  // Load the parliament index once.
  const mpIndexFile = path.join(publicFolder, "parliament", "index.json");
  const mpByName = new Map<string, MpIndexEntry>();
  if (fs.existsSync(mpIndexFile)) {
    try {
      const raw: { mps: MpIndexEntry[] } = JSON.parse(
        fs.readFileSync(mpIndexFile, "utf-8"),
      );
      for (const mp of raw.mps) {
        mpByName.set(normalizeName(mp.normalizedName ?? mp.name), mp);
      }
    } catch {
      // ignore — fall through with empty map
    }
  }
  const profilesDir = path.join(publicFolder, "parliament", "profiles");
  const loadProfile = (id: number): RawMpProfile | null => {
    const file = path.join(profilesDir, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return null;
    }
  };

  const byName = new Map<string, CandidateAggregate>();
  for (const folder of electionFolders) {
    const candFile = path.join(publicFolder, folder, "candidates.json");
    if (!fs.existsSync(candFile)) continue;
    let cands: CandidatesInfo[];
    try {
      cands = JSON.parse(fs.readFileSync(candFile, "utf-8"));
    } catch {
      continue;
    }
    const partyMap = partyLabelByElection.get(folder);
    for (const c of cands) {
      if (!c.name) continue;
      let agg = byName.get(c.name);
      if (!agg) {
        agg = { parties: new Set(), elections: new Set(), history: [] };
        byName.set(c.name, agg);
      }
      agg.elections.add(folder);
      const partyLabel = partyMap?.get(c.partyNum) ?? `№${c.partyNum}`;
      if (partyMap?.get(c.partyNum)) agg.parties.add(partyLabel);
      const key = `${folder}|${partyLabel}|${c.oblast ?? ""}`;
      if (
        !agg.history.some(
          (h) => `${h.folder}|${h.partyLabel}|${h.oblast}` === key,
        )
      ) {
        agg.history.push({ folder, partyLabel, oblast: c.oblast ?? "" });
      }
    }
  }

  const result: PrerenderRoute[] = [];
  for (const [name, agg] of byName) {
    const url = `${SITE_URL}/candidate/${encodeURIComponent(name)}`;
    const elections = Array.from(agg.elections).sort();
    const earliest = elections[0];
    const latest = elections[elections.length - 1];
    const earliestYear = earliest?.slice(0, 4);
    const latestYear = latest?.slice(0, 4);
    const yearSpan =
      earliestYear && latestYear && earliestYear !== latestYear
        ? `${earliestYear}–${latestYear}`
        : (latestYear ?? "");
    const partyLabels = Array.from(agg.parties);
    const partyClause = partyLabels.length
      ? ` от ${partyLabels.join(", ")}`
      : "";

    const indexEntry = mpByName.get(normalizeName(name));
    const profile = indexEntry ? loadProfile(indexEntry.id) : null;

    const isMp = !!indexEntry;
    const titleRole = isMp
      ? indexEntry.isCurrent
        ? "народен представител"
        : "бивш народен представител"
      : "кандидат за народен представител";
    const title = `${name} — ${titleRole}${yearSpan ? ` (${yearSpan})` : ""} | electionsbg.com`;
    const descRole = isMp
      ? `${titleRole}${indexEntry.currentPartyGroup ? ` от ${indexEntry.currentPartyGroup}` : partyClause}`
      : `${titleRole}${partyClause}`;
    const description = `Резултати на ${name} като ${descRole} в парламентарните избори в България — преференции по области, общини, населени места и секции${profile?.A_ns_MPL_Prof ? `. Професия: ${profile.A_ns_MPL_Prof.trim()}` : ""}.`;

    const personLd = buildPersonLd({
      name,
      url,
      affiliations: partyLabels,
      givenName: profile?.A_ns_MPL_Name1,
      additionalName: profile?.A_ns_MPL_Name2,
      familyName: profile?.A_ns_MPL_Name3,
      birthDate: profile?.A_ns_MP_BDate,
      birthPlace:
        profile?.A_ns_B_City || profile?.A_ns_B_Country
          ? {
              city: profile.A_ns_B_City,
              country: profile.A_ns_B_Country,
            }
          : undefined,
      jobTitle: profile?.A_ns_MPL_Prof?.trim(),
      knowsAbout: profile?.A_ns_MPL_Spec?.trim(),
      knowsLanguage: (profile?.lngList ?? [])
        .map((l) => l.LngL_value ?? l.A_LngL_value ?? "")
        .filter(Boolean),
      image: indexEntry?.photoUrl,
      memberOf: indexEntry?.isCurrent
        ? {
            name: "Народно събрание на Република България",
            url: `https://www.parliament.bg/bg/MP/${indexEntry.id}`,
          }
        : undefined,
      sameAs: indexEntry?.id
        ? [`https://www.parliament.bg/bg/MP/${indexEntry.id}`]
        : undefined,
    });

    const ogImage = indexEntry?.photoUrl;

    result.push({
      path: `candidate/${name}`,
      title,
      description,
      ogImage,
      bodyHtml: buildCandidateBody(
        name,
        partyLabels,
        yearSpan,
        indexEntry,
        profile,
        agg.history,
        oblastNames,
      ),
      jsonLd: [
        personLd,
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name, url },
        ]),
      ],
    });
  }
  return result;
};

export const buildSectionRoutes = (
  publicFolder: string,
  latestElection: string,
  oblastNames: Map<string, string>,
): PrerenderRoute[] => {
  const idxFile = path.join(
    publicFolder,
    latestElection,
    "sections_index.json",
  );
  if (!fs.existsSync(idxFile)) return [];
  const idx: SectionIndex[] = JSON.parse(fs.readFileSync(idxFile, "utf-8"));

  // Load all per-oblast section files once into a single map.
  const sectionMap = new Map<string, SectionInfo>();
  const byDir = path.join(
    publicFolder,
    latestElection,
    "sections",
    "by-oblast",
  );
  if (fs.existsSync(byDir)) {
    for (const f of fs.readdirSync(byDir)) {
      if (!f.endsWith(".json")) continue;
      const data: Record<string, SectionInfo> = JSON.parse(
        fs.readFileSync(path.join(byDir, f), "utf-8"),
      );
      for (const [k, v] of Object.entries(data)) sectionMap.set(k, v);
    }
  }

  // Map partyNum → nickName for vote labels.
  const partiesFile = path.join(
    publicFolder,
    latestElection,
    "cik_parties.json",
  );
  const partyLabels = new Map<number, string>();
  if (fs.existsSync(partiesFile)) {
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(partiesFile, "utf-8"),
    );
    for (const p of parties) partyLabels.set(p.number, p.nickName || p.name);
  }

  // Settlement aggregates — turnout + winning party — used to give every
  // section a settlement-relative comparison line in the prerendered body.
  type SettlementAgg = {
    settlementName: string;
    turnoutPct: number;
    winnerPartyNum: number;
    winnerNickName: string;
    winnerPct: number;
  };
  const settlementAgg = new Map<string, SettlementAgg>();
  const settlementsBy = path.join(
    publicFolder,
    latestElection,
    "settlements",
    "by",
  );
  if (fs.existsSync(settlementsBy)) {
    type SettlementBundle = {
      ekatte?: string;
      name?: string;
      t_v_m?: string;
      results?: {
        protocol?: {
          numRegisteredVoters?: number;
          totalActualVoters?: number;
        };
        votes?: Array<{ partyNum: number; totalVotes: number }>;
      };
    };
    for (const f of fs.readdirSync(settlementsBy)) {
      if (!f.endsWith(".json")) continue;
      let bundle: SettlementBundle[];
      try {
        bundle = JSON.parse(
          fs.readFileSync(path.join(settlementsBy, f), "utf-8"),
        );
      } catch {
        continue;
      }
      for (const s of bundle) {
        if (!s.ekatte || !s.results) continue;
        const reg = s.results.protocol?.numRegisteredVoters ?? 0;
        const act = s.results.protocol?.totalActualVoters ?? 0;
        if (reg <= 0) continue;
        const votes = s.results.votes ?? [];
        const total = votes.reduce((a, v) => a + (v.totalVotes ?? 0), 0);
        if (total <= 0) continue;
        let top = votes[0];
        for (const v of votes)
          if ((v.totalVotes ?? 0) > (top.totalVotes ?? 0)) top = v;
        const settlementName =
          `${s.t_v_m ? s.t_v_m + " " : ""}${s.name ?? ""}`.trim();
        settlementAgg.set(s.ekatte, {
          settlementName,
          turnoutPct: (act / reg) * 100,
          winnerPartyNum: top.partyNum,
          winnerNickName: partyLabels.get(top.partyNum) ?? `№${top.partyNum}`,
          winnerPct: (top.totalVotes / total) * 100,
        });
      }
    }
  }

  // National pct per party — for the "vs нац." delta column in the section
  // top-parties table.
  const nationalPctByParty = new Map<number, number>();
  const nsFile = path.join(
    publicFolder,
    latestElection,
    "national_summary.json",
  );
  if (fs.existsSync(nsFile)) {
    try {
      const ns: NationalSummaryFile = JSON.parse(
        fs.readFileSync(nsFile, "utf-8"),
      );
      for (const p of ns.parties) nationalPctByParty.set(p.partyNum, p.pct);
    } catch {
      // ignore
    }
  }

  // Risk-neighborhood flag per section — adds a paragraph on flagged sections.
  const flaggedSections = new Map<string, { name: string; city: string }>();
  const psFile = path.join(
    publicFolder,
    latestElection,
    "problem_sections.json",
  );
  if (fs.existsSync(psFile)) {
    try {
      const ps: {
        neighborhoods: Array<{
          name_bg: string;
          city_bg: string;
          sections: Array<{ section: string }>;
        }>;
      } = JSON.parse(fs.readFileSync(psFile, "utf-8"));
      for (const n of ps.neighborhoods) {
        for (const sec of n.sections) {
          flaggedSections.set(sec.section, {
            name: n.name_bg,
            city: n.city_bg,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  const result: PrerenderRoute[] = [];
  for (const { section, settlement } of idx) {
    const info = sectionMap.get(section);
    const oblastCode = info?.oblast;
    const oblastName = oblastCode ? oblastNames.get(oblastCode) : undefined;
    const url = `${SITE_URL}/section/${section}`;
    const ekatte = info?.ekatte;
    const address = info?.address;
    const placeLabel = oblastName
      ? `${settlement}, обл. ${oblastName}`
      : settlement;
    const title = `Избирателна секция №${section} — ${placeLabel} | electionsbg.com`;
    const description = address
      ? `Резултати по партии в избирателна секция №${section} — ${placeLabel}. Адрес: ${address}.`
      : `Резултати по партии в избирателна секция №${section} — ${placeLabel}.`;
    const breadcrumb: Array<{ name: string; url: string }> = [
      { name: "Начало", url: `${SITE_URL}/` },
    ];
    if (oblastCode && oblastName) {
      breadcrumb.push({
        name: `Област ${oblastName}`,
        url: `${SITE_URL}/municipality/${oblastCode}`,
      });
    }
    if (ekatte) {
      breadcrumb.push({
        name: settlement,
        url: `${SITE_URL}/settlement/${ekatte}`,
      });
    }
    breadcrumb.push({ name: `№${section}`, url });

    const votes: Votes[] | undefined = info?.results?.votes;
    const totalValidVotes = votes
      ? votes.reduce((sum, v) => sum + (v.totalVotes ?? 0), 0)
      : 0;
    const topVotes = votes
      ? [...votes]
          .filter((v) => (v.totalVotes ?? 0) > 0)
          .sort((a, b) => (b.totalVotes ?? 0) - (a.totalVotes ?? 0))
          .slice(0, 5)
          .map((v) => ({
            partyNum: v.partyNum,
            nickName: partyLabels.get(v.partyNum) ?? `№${v.partyNum}`,
            totalVotes: v.totalVotes ?? 0,
          }))
      : undefined;

    result.push({
      path: `section/${section}`,
      title,
      description,
      bodyHtml: buildSectionBody({
        section,
        settlement,
        oblastName,
        oblastCode,
        ekatte,
        address,
        protocol: info?.results?.protocol,
        topVotes,
        totalValidVotes,
        settlementContext: ekatte ? settlementAgg.get(ekatte) : undefined,
        nationalPctByParty,
        flaggedNeighborhood: flaggedSections.get(section),
      }),
      jsonLd: [
        buildDatasetLd({
          name: `Парламентарни избори — секция №${section}, ${placeLabel}`,
          description,
          url,
          spatialCoverage: placeLabel,
          keywords: [
            `секция ${section}`,
            settlement,
            ...(oblastName ? [oblastName] : []),
            "парламентарни избори",
            "резултати",
          ],
        }),
        buildBreadcrumbLd(breadcrumb),
      ],
    });
  }
  return result;
};

// Title-only sub-tab variants for party and municipality landing pages. Each
// derivative reuses the parent's body content but gets a tab-specific title
// and description, so non-JS crawlers see meaningful metadata at the deeper
// URLs that we already declare in the sitemap.
const PARTY_SUB_TABS: Array<{ slug: string; bg: string; en: string }> = [
  { slug: "regions", bg: "по области", en: "by region" },
  { slug: "municipalities", bg: "по общини", en: "by municipality" },
  { slug: "settlements", bg: "по населени места", en: "by settlement" },
  { slug: "preferences", bg: "преференции", en: "preference votes" },
  { slug: "donors", bg: "дарители", en: "donors" },
  { slug: "donors/list", bg: "списък дарители", en: "donor list" },
  { slug: "income", bg: "приходи", en: "campaign income" },
  { slug: "expenses", bg: "разходи", en: "campaign expenses" },
];

const OBLAST_SUB_TABS: Array<{ slug: string; bg: string }> = [
  { slug: "parties", bg: "по партии" },
  { slug: "preferences", bg: "преференции" },
  { slug: "flash-memory", bg: "машинно гласуване" },
  { slug: "municipalities", bg: "по общини" },
  { slug: "recount", bg: "повторно преброяване" },
  { slug: "timeline", bg: "времева линия" },
];

const buildPartySubTabRoutes = (
  parties: PartyInfo[],
  parents: Map<number, PrerenderRoute>,
): PrerenderRoute[] => {
  const result: PrerenderRoute[] = [];
  for (const p of parties) {
    const parent = parents.get(p.number);
    if (!parent) continue;
    const label =
      p.name && p.name !== p.nickName
        ? `${p.name} (${p.nickName})`
        : p.nickName;
    for (const tab of PARTY_SUB_TABS) {
      const url = `${SITE_URL}/party/${p.nickName}/${tab.slug}`;
      const enUrl = `${SITE_URL}/en/party/${p.nickName}/${tab.slug}`;
      result.push({
        path: `party/${p.nickName}/${tab.slug}`,
        title: `${label} — ${tab.bg} | electionsbg.com`,
        description: `Резултати на ${label} ${tab.bg} на парламентарните избори в България.`,
        ogImage: parent.ogImage,
        bodyHtml: parent.bodyHtml,
        jsonLd: [
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            { name: label, url: `${SITE_URL}/party/${p.nickName}` },
            { name: tab.bg, url },
          ]),
        ],
        english: {
          title: `${label} — ${tab.en} | electionsbg.com`,
          description: `Results of ${label} ${tab.en} in Bulgaria's parliamentary elections.`,
          bodyHtml: parent.bodyHtml,
          jsonLd: [
            buildBreadcrumbLd([
              { name: "Home", url: `${SITE_URL}/en/` },
              { name: label, url: `${SITE_URL}/en/party/${p.nickName}` },
              { name: tab.en, url: enUrl },
            ]),
          ],
        },
      });
    }
  }
  return result;
};

const buildOblastSubTabRoutes = (
  regions: RegionInfo[],
  parents: Map<string, PrerenderRoute>,
): PrerenderRoute[] => {
  const result: PrerenderRoute[] = [];
  for (const r of regions.filter((reg) => reg.oblast !== "32")) {
    const parent = parents.get(r.oblast);
    if (!parent) continue;
    const displayName = oblastDisplayName(r);
    for (const tab of OBLAST_SUB_TABS) {
      const url = `${SITE_URL}/municipality/${r.oblast}/${tab.slug}`;
      result.push({
        path: `municipality/${r.oblast}/${tab.slug}`,
        title: `${displayName} — ${tab.bg} | Парламентарни избори | electionsbg.com`,
        description: `Резултати ${tab.bg} в област ${displayName} на парламентарните избори в България.`,
        ogImage: parent.ogImage,
        bodyHtml: parent.bodyHtml,
        jsonLd: [
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            {
              name: `Област ${displayName}`,
              url: `${SITE_URL}/municipality/${r.oblast}`,
            },
            { name: tab.bg, url },
          ]),
        ],
      });
    }
  }
  return result;
};

export const buildElectionLandingRoutes = (
  publicFolder: string,
  electionsFile: string,
): PrerenderRoute[] => {
  if (!fs.existsSync(electionsFile)) return [];
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );
  return elections
    .filter((e) => /^\d{4}_\d{2}_\d{2}$/.test(e.name))
    .map((e) => {
      const date = e.name;
      const dateLabel = formatElectionDateBg(date);
      const url = `${SITE_URL}/elections/${date}`;
      const title = `Парламентарни избори ${dateLabel} в България — резултати | electionsbg.com`;
      const description = `Резултати от парламентарните избори в България на ${dateLabel} — избирателна активност, разпределение на гласове и мандати по партии, машинно и хартиено гласуване, отклонения по секции.`;
      return {
        path: `elections/${date}`,
        title,
        description,
        bodyHtml: buildElectionLandingBody(publicFolder, date),
        jsonLd: [
          buildDatasetLd({
            name: `Парламентарни избори ${dateLabel} — резултати`,
            description,
            url,
            spatialCoverage: "България",
            keywords: [
              "парламентарни избори",
              dateLabel,
              "резултати",
              "България",
            ],
            distribution: [
              {
                url: `${SITE_URL}/${date}/national_summary.json`,
                name: "Национално резюме (JSON)",
              },
              {
                url: `${SITE_URL}/${date}/region_votes.json`,
                name: "Резултати по области (JSON)",
              },
              {
                url: `${SITE_URL}/${date}/cik_parties.json`,
                name: "Списък на партиите (JSON)",
              },
            ],
          }),
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            { name: `Избори ${dateLabel}`, url },
          ]),
        ],
      };
    });
};

type PollAgency = {
  id: string;
  name_bg: string;
  name_en: string;
  abbr_bg?: string;
  website?: string | null;
};

export const buildPollsRoutes = (publicFolder: string): PrerenderRoute[] => {
  const agenciesFile = path.join(publicFolder, "polls", "agencies.json");
  if (!fs.existsSync(agenciesFile)) return [];
  const agencies: PollAgency[] = JSON.parse(
    fs.readFileSync(agenciesFile, "utf-8"),
  );
  const result: PrerenderRoute[] = [
    {
      path: "polls",
      title:
        "Социологически проучвания преди парламентарни избори | electionsbg.com",
      description:
        "Точност на социологическите агенции преди българските парламентарни избори — средна абсолютна грешка по партии, профил на отклоненията и предупреждения по агенции.",
      bodyHtml: buildPollsBody(publicFolder),
      jsonLd: [
        buildDatasetLd({
          name: "Точност на социологическите проучвания за парламентарни избори в България",
          description:
            "Сравнителен анализ на агенциите за социологически проучвания спрямо реалните резултати от вотовете.",
          url: `${SITE_URL}/polls`,
          spatialCoverage: "България",
          keywords: [
            "социологически проучвания",
            "парламентарни избори",
            "точност",
            "агенции",
          ],
          distribution: [
            {
              url: `${SITE_URL}/polls/polls.json`,
              name: "Сурови проучвания (JSON)",
            },
            {
              url: `${SITE_URL}/polls/accuracy.json`,
              name: "Грешки по проучване (JSON)",
            },
            {
              url: `${SITE_URL}/polls/analysis.json`,
              name: "Анализ на агенции (JSON)",
            },
          ],
        }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Социологически проучвания", url: `${SITE_URL}/polls` },
        ]),
      ],
    },
  ];
  for (const a of agencies) {
    const url = `${SITE_URL}/polls/${encodeURIComponent(a.id)}`;
    result.push({
      path: `polls/${a.id}`,
      title: `${a.name_bg} — точност на социологическите проучвания | electionsbg.com`,
      description: `Точност, систематични отклонения (lean) и предупреждения за социологическата агенция ${a.name_bg} спрямо реалните резултати от парламентарните избори в България.`,
      bodyHtml: buildPollsAgencyBody(publicFolder, a),
      jsonLd: [
        buildDatasetLd({
          name: `${a.name_bg} — точност на проучванията`,
          description: `Метрики за точност и отклонения на агенция ${a.name_bg}.`,
          url,
          spatialCoverage: "България",
          keywords: [a.name_bg, "точност", "проучвания"],
        }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Социологически проучвания", url: `${SITE_URL}/polls` },
          { name: a.name_bg, url },
        ]),
      ],
    });
  }
  return result;
};

// Static report pages live at /reports/{scope}/{report}. Each one is a
// distinct keyword target ("избирателна активност по области", "повторно
// преброяване по секции") so we emit unique title/description/body per page.
type ReportEntry = {
  slug: string;
  bgTitle: string;
  bgDesc: string;
  bgBody: string;
};

const SETTLEMENT_REPORTS: ReportEntry[] = [
  {
    slug: "concentrated",
    bgTitle: "Концентриран вот по населени места",
    bgDesc:
      "Населени места с прекомерно концентриран вот за една партия — индикатор за организирано гласуване.",
    bgBody:
      "Населени места, в които една партия е получила непропорционално висок дял от гласовете спрямо средното за страната. Често срещан индикатор за организирано или контролирано гласуване, особено при ниско общо население на секцията.",
  },
  {
    slug: "top_gainers",
    bgTitle: "Най-голям ръст по населени места",
    bgDesc:
      "Населени места с най-голямо увеличение на гласовете за дадена партия спрямо предходния вот.",
    bgBody:
      "Населени места, в които конкретна партия отбелязва най-голям ръст спрямо предишния парламентарен вот. Полезно за идентифициране на нови мобилизационни усилия или разширяване на електоралната база.",
  },
  {
    slug: "top_losers",
    bgTitle: "Най-голям спад по населени места",
    bgDesc:
      "Населени места с най-голяма загуба на гласове за дадена партия спрямо предходния вот.",
    bgBody:
      "Населени места, в които партия губи най-много гласове спрямо предходния вот. Често обяснимо с разпад на коалиции, смяна на лидер или загуба на местен организатор.",
  },
  {
    slug: "turnout",
    bgTitle: "Избирателна активност по населени места",
    bgDesc:
      "Класация на населените места по избирателна активност в последния парламентарен вот.",
    bgBody:
      "Избирателната активност на ниво населено място — съотношението между гласувалите и регистрираните избиратели. Показва откроени високи и ниски стойности, които често маркират организирано гласуване или обезлюдяване.",
  },
  {
    slug: "invalid_ballots",
    bgTitle: "Недействителни бюлетини по населени места",
    bgDesc:
      "Населени места с най-висок дял недействителни бюлетини на парламентарния вот.",
    bgBody:
      "Делът на недействителните бюлетини спрямо общия брой гласове в населеното място. Високите стойности често са знак за нискa избирателна култура или нарочно объркани бюлетини.",
  },
  {
    slug: "additional_voters",
    bgTitle: "Дописани избиратели по населени места",
    bgDesc:
      "Населени места с най-много избиратели, дописани в избирателния списък в изборния ден.",
    bgBody:
      "Брой избиратели, дописани в допълнителния списък на изборния ден. Прекомерните стойности будят подозрения за организиран „избирателен туризъм“.",
  },
  {
    slug: "supports_no_one",
    bgTitle: "Глас „не подкрепям никого“ по населени места",
    bgDesc:
      "Населени места с най-висок дял на гласове „не подкрепям никого“ — протестен вот.",
    bgBody:
      "Делът на гласовете „не подкрепям никого“ спрямо общия брой гласове. Класически протестен вот — отделянето му от партиите помага да се измери истинският му обхват.",
  },
  {
    slug: "recount",
    bgTitle: "Повторно преброяване по населени места",
    bgDesc:
      "Населени места с най-голяма разлика между първо и второ преброяване на бюлетините.",
    bgBody:
      "Сборът на абсолютните разлики между първото броене в СИК и повторното броене в РИК. Високите стойности маркират проблеми в първоначалното отчитане.",
  },
  {
    slug: "flash_memory",
    bgTitle: "Машинно гласуване по населени места",
    bgDesc:
      "Обхват на машинното гласуване в българските населени места — секции с/без флашка.",
    bgBody:
      "Делът на секциите в населено място, в които е работело СУЕМГ устройство. Индикатор за достъпност на електронното гласуване извън градските центрове.",
  },
  {
    slug: "flash_memory_added",
    bgTitle: "Добавени машини за гласуване по населени места",
    bgDesc:
      "Населени места, в които СУЕМГ устройства са били добавени в последния момент преди изборния ден.",
    bgBody:
      "Брой машини за гласуване, добавени към секциите след първоначалния списък. Често маркира логистични проблеми с разпределението на устройствата.",
  },
  {
    slug: "flash_memory_removed",
    bgTitle: "Премахнати машини за гласуване по населени места",
    bgDesc:
      "Населени места, в които СУЕМГ устройства са били премахнати преди или по време на изборния ден.",
    bgBody:
      "Брой машини за гласуване, премахнати от секциите преди или по време на изборния ден. Често свързано с разпоредено хартиено гласуване след технически проблем.",
  },
  {
    slug: "missing_flash_memory",
    bgTitle: "Липсваща флашка за машинно гласуване по населени места",
    bgDesc:
      "Населени места с регистрирани липсващи флаш-памети в СУЕМГ устройствата.",
    bgBody:
      "Секции, в които флаш-паметта на СУЕМГ устройството липсва или не е приета от РИК. Серьозен инцидент — гласовете трябва да се възстановят от хартиена разпечатка.",
  },
];

const MUNICIPALITY_REPORTS: ReportEntry[] = SETTLEMENT_REPORTS.map((r) => ({
  ...r,
  bgTitle: r.bgTitle.replace("по населени места", "по общини"),
  bgDesc: r.bgDesc.replace(/населен[иa] места?/g, "общини"),
  bgBody: r.bgBody
    .replace(/населен[иa] места?/g, "общини")
    .replace(/населено място/g, "община"),
}));

const SECTION_REPORTS: ReportEntry[] = [
  ...SETTLEMENT_REPORTS.map((r) => ({
    ...r,
    bgTitle: r.bgTitle.replace("по населени места", "по секции"),
    bgDesc: r.bgDesc.replace(/населен[иa] места?/g, "секции"),
    bgBody: r.bgBody
      .replace(/населен[иa] места?/g, "секции")
      .replace(/населено място/g, "секция"),
  })),
  {
    slug: "recount_zero_votes",
    bgTitle: "Повторно преброяване с нулиране на гласове по секции",
    bgDesc:
      "Секции, в които повторното преброяване свежда гласовете на партия до нула.",
    bgBody:
      "Особено крайни случаи на повторно преброяване — секции, в които второто броене изважда всички гласове на дадена партия. Маркира сериозен проблем в първоначалния протокол.",
  },
  {
    slug: "problem_sections",
    bgTitle: "Проблемни секции — обобщен преглед",
    bgDesc:
      "Списък на секциите с натрупани отклонения по различни доклади — повторно преброяване, машинно гласуване, отклонения по партии.",
    bgBody:
      "Обобщеният списък на секциите, които се появяват в няколко независими доклада за отклонения. Това са секциите, които изискват ръчна проверка — машинна срещу хартиена разлика, нулирано броене, организирано гласуване, дописани избиратели.",
  },
];

const buildReportRoutes = (
  scope: "settlement" | "municipality" | "section",
  reports: ReportEntry[],
): PrerenderRoute[] => {
  const scopeLabelBg =
    scope === "settlement"
      ? "населени места"
      : scope === "municipality"
        ? "общини"
        : "секции";
  return reports.map((r) => {
    const url = `${SITE_URL}/reports/${scope}/${r.slug}`;
    const title = `${r.bgTitle} — Парламентарни избори | electionsbg.com`;
    return {
      path: `reports/${scope}/${r.slug}`,
      title,
      description: r.bgDesc,
      bodyHtml: `
<h1>${r.bgTitle}</h1>
<p>${r.bgBody}</p>
<p>Всички доклади за отклонения по ${scopeLabelBg}: <a href="${SITE_URL}/reports/${scope}/concentrated">концентриран вот</a>, <a href="${SITE_URL}/reports/${scope}/turnout">избирателна активност</a>, <a href="${SITE_URL}/reports/${scope}/recount">повторно преброяване</a>, <a href="${SITE_URL}/reports/${scope}/flash_memory">машинно гласуване</a>.</p>`.trim(),
      jsonLd: [
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: r.bgTitle, url },
        ]),
      ],
    };
  });
};

export const buildDynamicRoutes = (projectRoot: string): PrerenderRoute[] => {
  const publicFolder = path.join(projectRoot, "public");
  const electionsFile = path.join(projectRoot, "src/data/json/elections.json");
  const regionsFile = path.join(projectRoot, "src/data/json/regions.json");
  const latest = getLatestElection(electionsFile);
  const regions: RegionInfo[] = JSON.parse(
    fs.readFileSync(regionsFile, "utf-8"),
  );
  const oblastNames = buildOblastNameMap(regions);
  const partyRoutes = buildPartyRoutes(publicFolder, latest);
  const oblastRoutes = buildOblastRoutes(regionsFile, publicFolder, latest);

  // Look up parents by their numeric/code key so sub-tab generators can clone
  // the rich body without rebuilding it.
  const partiesFile = path.join(publicFolder, latest, "cik_parties.json");
  const parties: PartyInfo[] = fs.existsSync(partiesFile)
    ? JSON.parse(fs.readFileSync(partiesFile, "utf-8"))
    : [];
  const partyParents = new Map<number, PrerenderRoute>();
  parties.forEach((p, i) => partyParents.set(p.number, partyRoutes[i]));
  const oblastParents = new Map<string, PrerenderRoute>();
  regions
    .filter((r) => r.oblast !== "32")
    .forEach((r, i) => oblastParents.set(r.oblast, oblastRoutes[i]));

  return [
    ...partyRoutes,
    ...buildPartySubTabRoutes(parties, partyParents),
    ...oblastRoutes,
    ...buildOblastSubTabRoutes(regions, oblastParents),
    ...buildSettlementRoutes(publicFolder, latest, oblastNames),
    ...buildSectionsListRoutes(publicFolder, latest, oblastNames),
    ...buildSectionRoutes(publicFolder, latest, oblastNames),
    ...buildCandidateRoutes(publicFolder, oblastNames),
    ...buildPollsRoutes(publicFolder),
    ...buildElectionLandingRoutes(publicFolder, electionsFile),
    ...buildReportRoutes("settlement", SETTLEMENT_REPORTS),
    ...buildReportRoutes("municipality", MUNICIPALITY_REPORTS),
    ...buildReportRoutes("section", SECTION_REPORTS),
    ...buildArticleRoutes(publicFolder),
  ];
};
