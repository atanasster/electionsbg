import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ElectionInfo,
  ElectionRegion,
  PartyInfo,
  RegionInfo,
} from "@/data/dataTypes";
import { NationalSummary } from "@/data/dashboard/dashboardTypes";
import { cikPartiesFileName, regionsVotesFileName } from "scripts/consts";
import { renderCard, PALETTE, type Tile, type CardSpec } from "./cardRenderer";
import { renderCandidateCard } from "./candidateCard";
import { loadCandidateCardData } from "./candidateData";
import { createOgCache, hashFile } from "./cache";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const localizeDate = (electionName: string): string => {
  const [y, m, d] = electionName.split("_");
  return `${d}.${m}.${y}`;
};

const formatPctSigned = (pct: number, digits = 2): string => {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
};

const formatThousands = (n: number): string =>
  n.toLocaleString("bg-BG").replace(/\s/g, ",");

// Card render jobs are collected first, then pushed through the incremental
// cache — a card whose CardSpec is byte-identical to last build is copied
// from cache instead of re-encoded. The CardSpec fully determines the pixels
// for renderCard()-based cards, so it doubles as the cache fingerprint.
type CardJob = { relPath: string; spec: CardSpec };
const jobs: CardJob[] = [];
const queue = (relPath: string, spec: CardSpec): void => {
  jobs.push({ relPath, spec });
};

const renderHomeCard = (summary: NationalSummary, relPath: string) => {
  const tiles: Tile[] = [
    {
      label: "избирателна активност",
      value: `${summary.turnout.pct.toFixed(1)}%`,
      delta:
        summary.turnout.deltaPct !== undefined
          ? `${formatPctSigned(summary.turnout.deltaPct)} пр.п.`
          : undefined,
      deltaColor:
        summary.turnout.deltaPct === undefined
          ? PALETTE.muted
          : summary.turnout.deltaPct >= 0
            ? PALETTE.green
            : PALETTE.red,
    },
    {
      label: "най-голям ръст",
      value: summary.topGainer ? summary.topGainer.nickName : "—",
      delta: summary.topGainer
        ? `${formatPctSigned(summary.topGainer.deltaPct)} пр.п.`
        : undefined,
      deltaColor:
        summary.topGainer && summary.topGainer.deltaPct >= 0
          ? PALETTE.green
          : PALETTE.red,
      accent: summary.topGainer?.color,
    },
    {
      label: "най-голям спад",
      value: summary.topLoser ? summary.topLoser.nickName : "—",
      delta: summary.topLoser
        ? `${formatPctSigned(summary.topLoser.deltaPct)} пр.п.`
        : undefined,
      deltaColor:
        summary.topLoser && summary.topLoser.deltaPct >= 0
          ? PALETTE.green
          : PALETTE.red,
      accent: summary.topLoser?.color,
    },
    {
      label: "отклонения",
      value: formatThousands(summary.anomalies.total),
      delta: "секции",
      deltaColor: PALETTE.amber,
    },
  ];
  queue(relPath, {
    title: `Парламентарни избори ${localizeDate(summary.election)}`,
    subtitle: summary.priorElection
      ? `Сравнение с ${localizeDate(summary.priorElection)}`
      : "",
    tiles,
  });
};

const renderPartyCard = (
  party: PartyInfo,
  summary: NationalSummary,
  relPath: string,
) => {
  const inSummary = summary.parties.find((p) => p.partyNum === party.number);
  const pctText = inSummary ? `${inSummary.pct.toFixed(2)}%` : "—";
  const seats = inSummary?.seats ?? 0;
  const tiles: Tile[] = [
    {
      label: "дял от вота",
      value: pctText,
      delta: `${localizeDate(summary.election)}`,
      deltaColor: PALETTE.muted,
      accent: party.color,
    },
    {
      label: "мандати",
      value: seats > 0 ? `${seats}` : "—",
      delta: seats > 0 ? "от 240" : "под прага",
      deltaColor: PALETTE.muted,
    },
    {
      label: "общо гласове",
      value: inSummary ? formatThousands(inSummary.totalVotes) : "—",
      delta: inSummary?.passedThreshold ? "над прага" : "под 4%",
      deltaColor: inSummary?.passedThreshold ? PALETTE.green : PALETTE.muted,
    },
    {
      label: "номер в бюлетината",
      value: `№ ${party.number}`,
      delta: party.nickName,
      deltaColor: PALETTE.muted,
    },
  ];
  queue(relPath, {
    title: party.name || party.nickName,
    subtitle: `Парламентарни избори в България — ${localizeDate(summary.election)}`,
    tiles,
  });
};

type StaticPageHighlight = { label: string; value: string; accent?: string };

const renderStaticPageCard = (
  title: string,
  subtitle: string,
  highlights: StaticPageHighlight[],
  relPath: string,
) => {
  const tiles: Tile[] = highlights.map((h) => ({
    label: h.label,
    value: h.value,
    accent: h.accent,
  }));
  queue(relPath, { title, subtitle, tiles });
};

const renderOblastCard = (
  region: RegionInfo,
  voteData: ElectionRegion,
  electionName: string,
  parties: PartyInfo[],
  relPath: string,
) => {
  const total = voteData.results.votes.reduce((s, v) => s + v.totalVotes, 0);
  const protocol = voteData.results.protocol;
  const turnoutPct =
    protocol?.numRegisteredVoters && protocol.totalActualVoters
      ? (100 * protocol.totalActualVoters) / protocol.numRegisteredVoters
      : 0;
  const partyByNum = new Map(parties.map((p) => [p.number, p]));
  const ranked = [...voteData.results.votes]
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 2);
  const top1 = ranked[0];
  const top2 = ranked[1];
  const top1Info = top1 ? partyByNum.get(top1.partyNum) : undefined;
  const top2Info = top2 ? partyByNum.get(top2.partyNum) : undefined;

  const tiles: Tile[] = [
    {
      label: "избирателна активност",
      value: `${turnoutPct.toFixed(1)}%`,
      delta: localizeDate(electionName),
      deltaColor: PALETTE.muted,
    },
    {
      label: "първо място",
      value: top1Info?.nickName ?? "—",
      delta:
        top1 && total ? `${((100 * top1.totalVotes) / total).toFixed(2)}%` : "",
      deltaColor: PALETTE.green,
      accent: top1Info?.color,
    },
    {
      label: "второ място",
      value: top2Info?.nickName ?? "—",
      delta:
        top2 && total ? `${((100 * top2.totalVotes) / total).toFixed(2)}%` : "",
      deltaColor: PALETTE.muted,
      accent: top2Info?.color,
    },
    {
      label: "общо гласове",
      value: formatThousands(total),
      delta: protocol?.totalActualVoters
        ? `${formatThousands(protocol.totalActualVoters)} избиратели`
        : "",
      deltaColor: PALETTE.muted,
    },
  ];
  queue(relPath, {
    title: `Резултати в ${region.long_name || region.name}`,
    subtitle: `Парламентарни избори — ${localizeDate(electionName)}`,
    tiles,
  });
};

const main = async () => {
  // Source data lives in /data/ post-GCS migration; the variable name is
  // kept (`publicFolder`) for minimal blast radius — only reads happen.
  const publicFolder = path.join(PROJECT_ROOT, "data");
  const distFolder = path.join(PROJECT_ROOT, "dist");
  if (!fs.existsSync(distFolder)) {
    throw new Error(
      `dist/ not found at ${distFolder}. Run \`vite build\` before generating OG images.`,
    );
  }

  const electionsFile = path.join(PROJECT_ROOT, "src/data/json/elections.json");
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );
  const latest = elections[0].name; // newest first

  // Home / national card.
  const summaryPath = path.join(publicFolder, latest, "national_summary.json");
  if (fs.existsSync(summaryPath)) {
    const summary: NationalSummary = JSON.parse(
      fs.readFileSync(summaryPath, "utf-8"),
    );
    renderHomeCard(summary, "home.png");
  }

  // Static-page cards: branded covers for /timeline, /compare, /simulator,
  // /about, /financing, /sofia. Each gets 4 quick highlight tiles.
  const electionCount = elections.length;
  const oldestYear = elections[elections.length - 1].name.split("_")[0];
  const newestYear = elections[0].name.split("_")[0];
  const yearSpan = `${oldestYear}–${newestYear}`;

  renderStaticPageCard(
    "Времева линия на партиите",
    "Възход и падение на политическите партии в България",
    [
      { label: "избори", value: `${electionCount}` },
      { label: "период", value: yearSpan },
      { label: "размер", value: "гласове" },
      { label: "цвят", value: "партия" },
    ],
    "timeline.png",
  );

  renderStaticPageCard(
    "Сравнение на парламентарни избори",
    "Рамо до рамо: два вота или две области",
    [
      { label: "режим 1", value: "избори" },
      { label: "режим 2", value: "области" },
      { label: "показатели", value: "активност" },
      { label: "и", value: "партии" },
    ],
    "compare.png",
  );

  renderStaticPageCard(
    "Симулатор на коалиции",
    "Разпределение на 240-те мандата при различен праг",
    [
      { label: "общо мандати", value: "240" },
      { label: "за мнозинство", value: "121" },
      { label: "праг", value: "0–10%" },
      { label: "коалиции до", value: "4 партии" },
    ],
    "simulator.png",
  );

  // NB: /financing uses a live Playwright dashboard screenshot (public/og/
  // financing.png via scripts/og/capture-screens.ts), not a rendered text
  // card — so no financing.png job is queued here (it would overwrite the
  // screenshot in dist/og/ during postbuild).

  renderStaticPageCard(
    "Резултати в София",
    "23, 24 и 25 МИР — столични резултати по секции",
    [
      { label: "райони", value: "3" },
      { label: "23 МИР", value: "София" },
      { label: "24 МИР", value: "София" },
      { label: "25 МИР", value: "София" },
    ],
    "sofia.png",
  );

  renderStaticPageCard(
    "За проекта",
    "Независима платформа за анализ на парламентарните избори в България",
    [
      { label: "тип", value: "open source" },
      { label: "източник", value: "ЦИК" },
      { label: "обхват", value: yearSpan },
      { label: "език", value: "BG / EN" },
    ],
    "about.png",
  );

  renderStaticPageCard(
    "Потребление",
    "Издръжка на живота — цени, инфлация и достъпност по места",
    [
      { label: "кошница", value: "101 продукта" },
      { label: "населени места", value: "244" },
      { label: "инфлация", value: "ХИПЦ" },
      { label: "достъпност", value: "по области" },
    ],
    "consumption.png",
  );

  // /risk-analysis, /risk-score, /benford, /persistence, /wasted-vote and
  // /connections use Playwright screenshots of the live dashboards instead
  // of rendered cards — see scripts/og/capture-screens.ts. Their .png files
  // live under public/og/ (not dist/og/) and ship through the static-asset
  // copy. Cards below cover the text-heavy methodology pages and ranked
  // tables, which don't have a strong visual element worth screenshotting.

  renderStaticPageCard(
    "Индекс на изборния риск — методология",
    "Как се изчислява композитната оценка 0–100",
    [
      { label: "компоненти", value: "6 сигнала" },
      { label: "категории", value: "4 нива" },
      { label: "тегло", value: "по сигнал" },
      { label: "тип", value: "методология" },
    ],
    "risk-analysis-methodology.png",
  );

  renderStaticPageCard(
    "Скрининг на секциите — методология",
    "Дефиниции, прагове и формули зад шестте сигнала",
    [
      { label: "сигнали", value: "6" },
      { label: "прагове", value: "по сигнал" },
      { label: "обединяване", value: "0–100" },
      { label: "тип", value: "методология" },
    ],
    "risk-score-methodology.png",
  );

  renderStaticPageCard(
    "Бенфорд — методология",
    "Защо 2BL и кога отклонението не означава фалшификация",
    [
      { label: "тест", value: "2BL (втора)" },
      { label: "мин. гласове", value: "≥ 10 / секция" },
      { label: "мин. секции", value: "≥ 30 / партия" },
      { label: "тип", value: "методология" },
    ],
    "benford-methodology.png",
  );

  renderStaticPageCard(
    "Къде отидоха гласовете — методология",
    "Поток на гласовете между два парламентарни вота",
    [
      { label: "метод", value: "NNLS Goodman" },
      { label: "мащабиране", value: "RAS" },
      { label: "ниво", value: "секция → МИР" },
      { label: "тип", value: "методология" },
    ],
    "vote-flow-methodology.png",
  );

  renderStaticPageCard(
    "Фирми с участие на депутати",
    "Списък на компании със собственик или ръководител-депутат",
    [
      { label: "източник", value: "Търг. регистър" },
      { label: "обогатяване", value: "Декларации" },
      { label: "филтри", value: "по партия" },
      { label: "обхват", value: "действащ парламент" },
    ],
    "mp-companies.png",
  );

  renderStaticPageCard(
    "Народни представители по активи",
    "Класиране по декларирано нетно имущество",
    [
      { label: "източник", value: "Сметна палата" },
      { label: "обхват", value: "декларант + съпруг" },
      { label: "метрика", value: "нетно имущество" },
      { label: "валута", value: "BGN" },
    ],
    "mp-assets.png",
  );

  renderStaticPageCard(
    "Длъжностни лица по активи",
    "Министри, агенции, областни управители",
    [
      { label: "източник", value: "Сметна палата" },
      { label: "категории", value: "3 групи" },
      { label: "метрика", value: "нетно имущество" },
      { label: "обхват", value: "декларант + съпруг" },
    ],
    "officials-assets.png",
  );

  // /observations — OSCE/ODIHR election observation reports landing page.
  renderStaticPageCard(
    "Доклади ОССЕ/ОДИХР",
    "Международни наблюдения на парламентарните избори в България",
    [
      { label: "източник", value: "OSCE/ODIHR" },
      { label: "обхват", value: yearSpan },
      { label: "доклади", value: "EOM / LEOM / EAM" },
      { label: "резюмета", value: "Claude AI" },
    ],
    "observations.png",
  );

  // /data-changes — public log of dataset refreshes.
  renderStaticPageCard(
    "Промени в данните",
    "Дневник на обновяванията на electionsbg.com",
    [
      { label: "обхват", value: "всички набори" },
      { label: "проследява", value: "обновявания" },
      { label: "източник", value: "pipeline" },
      { label: "тип", value: "log" },
    ],
    "data-changes.png",
  );

  renderStaticPageCard(
    "Коли, декларирани от депутатите",
    "Леки автомобили и джипове от подадените декларации",
    [
      { label: "източник", value: "Сметна палата" },
      { label: "видове", value: "лек + джип" },
      { label: "стойност", value: "BGN" },
      { label: "обхват", value: "декларант + съпруг" },
    ],
    "mp-cars.png",
  );

  // Per-cabinet OG cards — one card per entry in data/governments.json,
  // emitted as public/og/cabinet/{id}.png. Used by the prerender step
  // (scripts/prerender/routes.ts) as the per-cabinet ogImage so social
  // shares of /governments/<id> show a cabinet-specific card instead of
  // falling back to the generic site OG image.
  //
  // Roman-numeral disambiguation mirrors the runtime cabinetLabel.ts and
  // the prerender script — the same Бойко Методиев Борисов has three
  // cabinets, and the OG card title needs to identify which one.
  type CabinetEntry = {
    id: string;
    pmBg: string;
    pmEn: string;
    startDate: string;
    endDate: string | null;
    type: "regular" | "caretaker";
    parties: string[];
    pmPartyBg?: string;
    endReasonBg?: string;
  };
  const OG_ROMAN: Record<number, string> = {
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
    5: "V",
  };
  const governmentsFile = path.join(PROJECT_ROOT, "data/governments.json");
  if (fs.existsSync(governmentsFile)) {
    try {
      const payload = JSON.parse(fs.readFileSync(governmentsFile, "utf-8")) as {
        governments: CabinetEntry[];
      };
      const lastBgToken = (s: string): string => s.split(" ").pop() ?? "";
      const sortedAll = [...payload.governments].sort((a, b) =>
        a.startDate.localeCompare(b.startDate),
      );
      const siblingsByPm = new Map<string, CabinetEntry[]>();
      for (const c of sortedAll) {
        const key = lastBgToken(c.pmBg);
        const arr = siblingsByPm.get(key) ?? [];
        arr.push(c);
        siblingsByPm.set(key, arr);
      }
      const yearOf = (iso: string | null): string =>
        iso ? iso.slice(0, 4) : "—";
      for (const c of payload.governments) {
        const siblings = siblingsByPm.get(lastBgToken(c.pmBg)) ?? [];
        const idx =
          siblings.length > 1
            ? siblings.findIndex((s) => s.id === c.id) + 1
            : 0;
        const numeral = idx > 0 ? (OG_ROMAN[idx] ?? String(idx)) : "";
        const titleName = numeral ? `${c.pmBg} ${numeral}` : c.pmBg;
        const typeBg = c.type === "caretaker" ? "служебен" : "редовен";
        const tenure = `${yearOf(c.startDate)} – ${yearOf(c.endDate)}`;
        const partyLabel =
          c.type === "caretaker" ? (c.pmPartyBg ?? "—") : (c.parties[0] ?? "—");
        // 4-tile composition kept identity-focused (no live macro
        // numbers): cabinet type, term years, coalition lead/PM party,
        // and how the term ended. Stable across data refreshes.
        renderStaticPageCard(
          `Кабинет ${titleName}`,
          tenure,
          [
            { label: "тип", value: typeBg },
            { label: "период", value: tenure },
            { label: "коалиция", value: partyLabel },
            { label: "край", value: c.endReasonBg ?? "—" },
          ],
          `cabinet/${c.id}.png`,
        );
      }
    } catch (err) {
      console.warn("OG cabinet cards: enumeration failed", err);
    }
  }

  // Party cards.
  const partiesFile = path.join(publicFolder, latest, cikPartiesFileName);
  const parties: PartyInfo[] = fs.existsSync(partiesFile)
    ? JSON.parse(fs.readFileSync(partiesFile, "utf-8"))
    : [];
  if (fs.existsSync(summaryPath)) {
    const summary: NationalSummary = JSON.parse(
      fs.readFileSync(summaryPath, "utf-8"),
    );
    parties.forEach((p) => {
      if (!p.nickName) return;
      const fileName = encodeURIComponent(p.nickName) + ".png";
      renderPartyCard(p, summary, `party/${fileName}`);
    });
  }

  // Oblast cards.
  const regionsFile = path.join(PROJECT_ROOT, "src/data/json/regions.json");
  const regions: RegionInfo[] = JSON.parse(
    fs.readFileSync(regionsFile, "utf-8"),
  );
  const votesFile = path.join(publicFolder, latest, regionsVotesFileName);
  if (fs.existsSync(votesFile)) {
    const allVotes: ElectionRegion[] = JSON.parse(
      fs.readFileSync(votesFile, "utf-8"),
    );
    const byKey = new Map(allVotes.map((v) => [v.key, v]));
    regions.forEach((r) => {
      if (!r.oblast || r.oblast === "32") return;
      const v = byKey.get(r.oblast);
      if (!v) return;
      renderOblastCard(r, v, latest, parties, `region/${r.oblast}.png`);
    });
  }

  // Local-elections cards: one per regular cycle + one per oblast (except SOF,
  // which redirects to the município page). Referenced as og:image by the
  // prerendered local cycle / region pages.
  type LocalParty = { displayName: string; color: string };
  type LocalIdx = {
    municipalities?: { obshtinaCode: string; hadRound2: boolean }[];
    mayorsByCanonical?: LocalParty[];
    councilVoteShare?: LocalParty[];
  };
  type LocalRegionRow = {
    oblast: string;
    municipalityCount: number;
    runoffCount: number;
    topMayor: LocalParty | null;
    topCouncil: LocalParty | null;
  };
  const localCyclesFile = path.join(
    PROJECT_ROOT,
    "src/data/json/local_elections.json",
  );
  const regularLocalCycles: string[] = fs.existsSync(localCyclesFile)
    ? (
        JSON.parse(fs.readFileSync(localCyclesFile, "utf-8")) as {
          name: string;
          kind: string;
        }[]
      )
        .filter((c) => c.kind === "regular")
        .map((c) => c.name)
    : [];
  const regionNameOf = new Map(
    regions.map((r) => [r.oblast, r.long_name || r.name]),
  );
  for (const cycle of regularLocalCycles) {
    const idxFile = path.join(publicFolder, cycle, "index.json");
    if (!fs.existsSync(idxFile)) continue;
    let index: LocalIdx;
    try {
      index = JSON.parse(fs.readFileSync(idxFile, "utf-8"));
    } catch {
      continue;
    }
    const munis = (index.municipalities ?? []).filter(
      (m) => !/^S2\d{3}$/.test(m.obshtinaCode),
    );
    const runoffs = munis.filter((m) => m.hadRound2).length;
    const tm = (index.mayorsByCanonical ?? [])[0];
    const tc = (index.councilVoteShare ?? [])[0];
    renderStaticPageCard(
      `Местни избори ${localizeDate(cycle)}`,
      "Резултати по области и общини",
      [
        { label: "общини", value: `${munis.length}` },
        {
          label: "водеща по кметове",
          value: tm?.displayName ?? "—",
          accent: tm?.color,
        },
        {
          label: "водеща в съветите",
          value: tc?.displayName ?? "—",
          accent: tc?.color,
        },
        { label: "балотажи", value: `${runoffs}` },
      ],
      `local/${cycle}.png`,
    );
    const rsFile = path.join(publicFolder, cycle, "regions_summary.json");
    if (!fs.existsSync(rsFile)) continue;
    let rs: { regions?: LocalRegionRow[] };
    try {
      rs = JSON.parse(fs.readFileSync(rsFile, "utf-8"));
    } catch {
      continue;
    }
    for (const r of rs.regions ?? []) {
      if (r.oblast === "SOF") continue;
      renderStaticPageCard(
        `Местни избори — ${regionNameOf.get(r.oblast) ?? r.oblast}`,
        localizeDate(cycle),
        [
          { label: "общини", value: `${r.municipalityCount}` },
          {
            label: "контрол (кметове)",
            value: r.topMayor?.displayName ?? "—",
            accent: r.topMayor?.color,
          },
          {
            label: "места в съветите",
            value: r.topCouncil?.displayName ?? "—",
            accent: r.topCouncil?.color,
          },
          { label: "балотажи", value: `${r.runoffCount}` },
        ],
        `local/region/${cycle}/${r.oblast}.png`,
      );
    }
  }

  // Push every renderCard()-based job through the incremental cache. The
  // CardSpec is the complete visual input, so it is the cache fingerprint.
  const cache = createOgCache(PROJECT_ROOT);
  for (const job of jobs) {
    await cache.render(job.relPath, job.spec, () =>
      renderCard(job.spec).toBuffer("image/png"),
    );
  }

  // Composed per-candidate cards: every candidate in the latest election plus
  // every MP. Output is webp directly (the set is large — keeping it out of
  // the optimize.ts png→webp pass keeps that pass's rewrite map small).
  const candidateSet = loadCandidateCardData(PROJECT_ROOT);
  for (const card of candidateSet.cards) {
    const relPath = `candidate/${encodeURIComponent(card.name)}.webp`;
    // The photo is an external asset, not part of `card` — fold its content
    // hash into the fingerprint so a re-scraped photo re-renders the card.
    const fingerprint = {
      card,
      photo: card.mp?.photoPath ? hashFile(card.mp.photoPath) : null,
    };
    await cache.render(relPath, fingerprint, () => renderCandidateCard(card));
  }

  const { hits, misses } = cache.save();
  console.log(
    `OG images: ${jobs.length} static/party/oblast + ${candidateSet.cards.length} candidate cards ` +
      `(${misses} rendered, ${hits} cached)`,
  );
};

main().catch((err) => {
  console.error("OG generation failed:", err);
  process.exit(1);
});
