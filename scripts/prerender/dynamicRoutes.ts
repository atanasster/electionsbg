import fs from "fs";
import path from "path";
import { ElectionInfo, PartyInfo, RegionInfo } from "@/data/dataTypes";
import { PrerenderRoute, SITE_URL } from "./routes";
import { buildBreadcrumbLd, buildDatasetLd } from "./jsonLd";

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
  return parties.map((p) => {
    const label =
      p.name && p.name !== p.nickName
        ? `${p.name} (${p.nickName})`
        : p.nickName;
    const url = `${SITE_URL}/party/${p.nickName}`;
    const title = `${label} — Парламентарни избори в България | electionsbg.com`;
    const description = `Резултати на ${label} по години, области, общини и секции на парламентарните избори в България от 2005 г. насам, плюс декларирано финансиране.`;
    return {
      path: `party/${p.nickName}`,
      title,
      description,
      ogImage: `/og/party/${encodeURIComponent(p.nickName)}.png`,
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
        }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: label, url },
        ]),
      ],
    };
  });
};

export const buildOblastRoutes = (
  regionsJsonPath: string,
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
      return {
        path: `municipality/${r.oblast}`,
        title,
        description,
        ogImage: `/og/region/${r.oblast}.png`,
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

export const buildDynamicRoutes = (projectRoot: string): PrerenderRoute[] => {
  const publicFolder = path.join(projectRoot, "public");
  const electionsFile = path.join(projectRoot, "src/data/json/elections.json");
  const regionsFile = path.join(projectRoot, "src/data/json/regions.json");
  const latest = getLatestElection(electionsFile);
  const regions: RegionInfo[] = JSON.parse(
    fs.readFileSync(regionsFile, "utf-8"),
  );
  const oblastNames = buildOblastNameMap(regions);
  return [
    ...buildPartyRoutes(publicFolder, latest),
    ...buildOblastRoutes(regionsFile),
    ...buildSettlementRoutes(publicFolder, latest, oblastNames),
  ];
};
