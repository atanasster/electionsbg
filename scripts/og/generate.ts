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
import { renderCard, PALETTE, type Tile } from "./cardRenderer";

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

const ensureDir = (p: string) => fs.mkdirSync(p, { recursive: true });

const writePng = (outPath: string, canvas: ReturnType<typeof renderCard>) => {
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
};

const renderHomeCard = (summary: NationalSummary, outPath: string) => {
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
  const canvas = renderCard({
    title: `Парламентарни избори ${localizeDate(summary.election)}`,
    subtitle: summary.priorElection
      ? `Сравнение с ${localizeDate(summary.priorElection)}`
      : "",
    tiles,
  });
  writePng(outPath, canvas);
};

const renderPartyCard = (
  party: PartyInfo,
  summary: NationalSummary,
  outPath: string,
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
  const canvas = renderCard({
    title: party.name || party.nickName,
    subtitle: `Парламентарни избори в България — ${localizeDate(summary.election)}`,
    tiles,
  });
  writePng(outPath, canvas);
};

type StaticPageHighlight = { label: string; value: string; accent?: string };

const renderStaticPageCard = (
  title: string,
  subtitle: string,
  highlights: StaticPageHighlight[],
  outPath: string,
) => {
  const tiles: Tile[] = highlights.map((h) => ({
    label: h.label,
    value: h.value,
    accent: h.accent,
  }));
  const canvas = renderCard({
    title,
    subtitle,
    tiles,
  });
  writePng(outPath, canvas);
};

const renderOblastCard = (
  region: RegionInfo,
  voteData: ElectionRegion,
  electionName: string,
  parties: PartyInfo[],
  outPath: string,
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
  const canvas = renderCard({
    title: `Резултати в ${region.long_name || region.name}`,
    subtitle: `Парламентарни избори — ${localizeDate(electionName)}`,
    tiles,
  });
  writePng(outPath, canvas);
};

const main = () => {
  const publicFolder = path.join(PROJECT_ROOT, "public");
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
    renderHomeCard(summary, path.join(distFolder, "og", "home.png"));
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
    path.join(distFolder, "og", "timeline.png"),
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
    path.join(distFolder, "og", "compare.png"),
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
    path.join(distFolder, "og", "simulator.png"),
  );

  renderStaticPageCard(
    "Финансиране на партии",
    "Декларирани приходи и разходи на политическите кампании",
    [
      { label: "източник", value: "Сметна палата" },
      { label: "приходи", value: "дарители" },
      { label: "разходи", value: "медии" },
      { label: "обхват", value: yearSpan },
    ],
    path.join(distFolder, "og", "financing.png"),
  );

  renderStaticPageCard(
    "Резултати в София",
    "23, 24 и 25 МИР — столични резултати по секции",
    [
      { label: "райони", value: "3" },
      { label: "23 МИР", value: "София" },
      { label: "24 МИР", value: "София" },
      { label: "25 МИР", value: "София" },
    ],
    path.join(distFolder, "og", "sofia.png"),
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
    path.join(distFolder, "og", "about.png"),
  );

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
      renderPartyCard(
        p,
        summary,
        path.join(distFolder, "og", "party", fileName),
      );
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
      renderOblastCard(
        r,
        v,
        latest,
        parties,
        path.join(distFolder, "og", "region", `${r.oblast}.png`),
      );
    });
  }

  console.log(
    `OG images generated: home + ${parties.length} parties + ${
      regions.filter((r) => r.oblast && r.oblast !== "32").length
    } oblasts`,
  );
};

main();
