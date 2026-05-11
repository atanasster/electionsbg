import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ReportRow } from "@/data/dataTypes";
import type { RegionWastedVoteRow } from "./region_wasted";

// Pre-computed dashboard rollup for the wasted-vote feature. Keeps the
// landing-page tile payload small (the underlying section report is ~1.5MB,
// settlement is ~500KB — far too much just to surface a top-5 preview).
// Each entry carries the human-readable name in BG and EN so the tile
// doesn't have to fetch the global locator files just to label rows.

const TOP_N = 5;

type SettlementMeta = {
  ekatte: string;
  oblast: string;
  obshtina?: string;
  name?: string;
  name_en?: string;
  t_v_m?: string;
};

type MunicipalityMeta = {
  obshtina: string;
  oblast: string;
  name?: string;
  name_en?: string;
};

type RegionMeta = {
  oblast: string;
  name?: string;
  name_en?: string;
  long_name?: string;
  long_name_en?: string;
};

export type WastedVoteTopRow = {
  key: string;
  name_bg?: string;
  name_en?: string;
  region_name_bg?: string;
  region_name_en?: string;
  share: number;
  partyNum?: number;
  partyVotes?: number;
};

export type WastedVoteDashboard = {
  election: string;
  topRegions: WastedVoteTopRow[];
  topMunicipalities: WastedVoteTopRow[];
  topSettlements: WastedVoteTopRow[];
  topSections: WastedVoteTopRow[];
};

let settlementMetaIndex: Map<string, SettlementMeta> | undefined;
let municipalityMetaIndex: Map<string, MunicipalityMeta> | undefined;
let regionMetaIndex: Map<string, RegionMeta> | undefined;

const loadJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, "utf-8"));

const loadSettlementMeta = (
  dataFolder: string,
): Map<string, SettlementMeta> => {
  if (settlementMetaIndex) return settlementMetaIndex;
  const list = loadJson<SettlementMeta[]>(`${dataFolder}/settlements.json`);
  settlementMetaIndex = new Map(list.map((s) => [s.ekatte, s]));
  return settlementMetaIndex;
};

const loadMunicipalityMeta = (
  dataFolder: string,
): Map<string, MunicipalityMeta> => {
  if (municipalityMetaIndex) return municipalityMetaIndex;
  const list = loadJson<MunicipalityMeta[]>(
    `${dataFolder}/municipalities.json`,
  );
  municipalityMetaIndex = new Map(list.map((m) => [m.obshtina, m]));
  return municipalityMetaIndex;
};

const loadRegionMeta = (): Map<string, RegionMeta> => {
  if (regionMetaIndex) return regionMetaIndex;
  const __filename = fileURLToPath(import.meta.url);
  const file = path.resolve(
    path.dirname(__filename),
    "../../src/data/json/regions.json",
  );
  const list = loadJson<RegionMeta[]>(file);
  regionMetaIndex = new Map(list.map((r) => [r.oblast, r]));
  return regionMetaIndex;
};

const safeReadRows = <T>(p: string): T[] => {
  if (!fs.existsSync(p)) return [];
  try {
    return loadJson<T[]>(p);
  } catch {
    return [];
  }
};

export const generateWastedVotesDashboard = ({
  publicFolder,
  reportsFolder,
  year,
  stringify,
}: {
  publicFolder: string;
  reportsFolder: string;
  year: string;
  stringify: (o: object) => string;
}): void => {
  const dashboardFolder = `${publicFolder}/${year}/dashboard`;
  if (!fs.existsSync(dashboardFolder)) fs.mkdirSync(dashboardFolder);

  const regionMeta = loadRegionMeta();
  const muniMeta = loadMunicipalityMeta(publicFolder);
  const settlementMeta = loadSettlementMeta(publicFolder);

  // Region: from regional rollup (sorted by share desc already).
  const regionRows = safeReadRows<RegionWastedVoteRow>(
    `${reportsFolder}/region/wasted_votes.json`,
  );
  const topRegions: WastedVoteTopRow[] = regionRows
    .filter((r) => r.key !== "32")
    .slice(0, TOP_N)
    .map((r) => {
      const info = regionMeta.get(r.key);
      return {
        key: r.key,
        name_bg: info?.long_name || info?.name,
        name_en: info?.long_name_en || info?.name_en,
        share: r.share,
        partyNum: r.topParties?.[0]?.partyNum,
        partyVotes: r.topParties?.[0]?.totalVotes,
      };
    });

  // Municipality: existing flat report sorted by value desc.
  const muniRows = safeReadRows<ReportRow>(
    `${reportsFolder}/municipality/wasted_votes.json`,
  );
  const topMunicipalities: WastedVoteTopRow[] = muniRows
    .filter((r) => r.oblast !== "32")
    .slice(0, TOP_N)
    .map((r) => {
      const info = r.obshtina ? muniMeta.get(r.obshtina) : undefined;
      const region = r.oblast ? regionMeta.get(r.oblast) : undefined;
      return {
        key: r.obshtina ?? "",
        name_bg: info?.name,
        name_en: info?.name_en,
        region_name_bg: region?.name,
        region_name_en: region?.name_en,
        share: r.value,
        partyNum: r.partyNum,
        partyVotes: r.totalVotes,
      };
    });

  // Settlement: existing flat report sorted by value desc. Filter out the
  // 5-vote noise floor — sections with very low turnout produce huge
  // percentages from a handful of below-threshold votes, which is not the
  // story we want to highlight.
  const settlementRows = safeReadRows<ReportRow>(
    `${reportsFolder}/settlement/wasted_votes.json`,
  );
  const topSettlements: WastedVoteTopRow[] = settlementRows
    .filter((r) => r.oblast !== "32" && (r.totalVotes ?? 0) >= 50)
    .slice(0, TOP_N)
    .map((r) => {
      const info = r.ekatte ? settlementMeta.get(r.ekatte) : undefined;
      const region = r.oblast ? regionMeta.get(r.oblast) : undefined;
      const prefix = info?.t_v_m ? `${info.t_v_m}` : "";
      return {
        key: r.ekatte ?? "",
        name_bg: info?.name ? `${prefix}${info.name}` : undefined,
        name_en: info?.name_en,
        region_name_bg: region?.name,
        region_name_en: region?.name_en,
        share: r.value,
        partyNum: r.partyNum,
        partyVotes: r.totalVotes,
      };
    });

  // Section: same shape. Use the settlement context for the label, since
  // section IDs alone are unhelpful in the UI.
  const sectionRows = safeReadRows<ReportRow & { section?: string }>(
    `${reportsFolder}/section/wasted_votes.json`,
  );
  const topSections: WastedVoteTopRow[] = sectionRows
    .filter((r) => r.oblast !== "32" && (r.totalVotes ?? 0) >= 30)
    .slice(0, TOP_N)
    .map((r) => {
      const info = r.ekatte ? settlementMeta.get(r.ekatte) : undefined;
      const region = r.oblast ? regionMeta.get(r.oblast) : undefined;
      const prefix = info?.t_v_m ? `${info.t_v_m}` : "";
      const settlementLabel = info?.name ? `${prefix}${info.name}` : undefined;
      return {
        key: r.section ?? "",
        name_bg: settlementLabel
          ? `${settlementLabel} #${r.section}`
          : `#${r.section}`,
        name_en: info?.name_en
          ? `${info.name_en} #${r.section}`
          : `#${r.section}`,
        region_name_bg: region?.name,
        region_name_en: region?.name_en,
        share: r.value,
        partyNum: r.partyNum,
        partyVotes: r.totalVotes,
      };
    });

  const out: WastedVoteDashboard = {
    election: year,
    topRegions,
    topMunicipalities,
    topSettlements,
    topSections,
  };
  const file = `${dashboardFolder}/wasted_votes.json`;
  fs.writeFileSync(file, stringify(out), "utf8");
  console.log("Successfully added file ", file);
};
