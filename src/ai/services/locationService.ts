import regionsData from "@/data/json/regions.json";
import { LocationInfo, MunicipalityInfo } from "@/data/dataTypes";

export const allRegions = regionsData as LocationInfo[];
let municipalitiesCache: MunicipalityInfo[] | null = null;

/**
 * Fetches municipality data from the remote source and caches it in memory.
 * @returns A promise that resolves to an array of MunicipalityInfo objects.
 */
const fetchMunicipalities = async (): Promise<MunicipalityInfo[]> => {
  if (municipalitiesCache) {
    return municipalitiesCache;
  }
  try {
    console.log("Fetching municipalities from remote source...");
    const response = await fetch("/municipalities.json");
    if (!response.ok) {
      throw new Error(`Failed to fetch municipalities: ${response.statusText}`);
    }
    const data: MunicipalityInfo[] = await response.json();
    municipalitiesCache = data;
    console.log(
      `Successfully fetched and cached ${data.length} municipalities.`,
    );
    return data;
  } catch (error) {
    console.error("Error fetching or parsing municipalities.json:", error);
    // Return empty array on error to prevent crashes in dependent functions
    return [];
  }
};

const sofiaMIRs = ["S23", "S24", "S25"];

/**
 * Finds region information based on a name query.
 * Searches regions first, then municipalities. If a municipality is found, it returns its parent region.
 * Handles English/Bulgarian names, and the special case for "Sofia" city.
 * @param name The name of the location to find.
 * @returns A promise that resolves to an array of matching LocationInfo objects (always regions).
 */
export const findRegions = async (name: string): Promise<LocationInfo[]> => {
  if (!name) return [];
  const lowerCaseName = name.toLowerCase().trim();

  // Special case for Sofia city, which comprises three electoral regions (MIRs)
  if (["sofia", "софия", "sofia city", "град софия"].includes(lowerCaseName)) {
    return allRegions.filter((r) => sofiaMIRs.includes(r.oblast));
  }

  // Special case for Sofia region (oblast)
  if (["sofia region", "софия област"].includes(lowerCaseName)) {
    return allRegions.filter((r) => r.oblast === "SFO");
  }

  // First, search in regions
  const foundRegions = allRegions.filter((region) => {
    const names = [
      region.name.toLowerCase(),
      region.name_en.toLowerCase(),
      region.long_name?.toLowerCase(),
      region.long_name_en?.toLowerCase(),
    ].filter((s): s is string => !!s);
    return names.includes(lowerCaseName);
  });

  if (foundRegions.length > 0) {
    return foundRegions;
  }

  // If no region found, search in municipalities
  const municipalities = await fetchMunicipalities();
  const foundMunicipality = municipalities.find((mun) => {
    const names = [mun.name.toLowerCase(), mun.name_en.toLowerCase()].filter(
      (s): s is string => !!s,
    );
    return names.includes(lowerCaseName);
  });

  if (foundMunicipality) {
    // Find the parent region for this municipality
    const parentRegion = allRegions.find(
      (r) => r.oblast === foundMunicipality.oblast,
    );
    return parentRegion ? [parentRegion] : [];
  }

  return []; // Nothing found
};

/**
 * Tool function to get a list of all available administrative regions.
 */
export const get_list_of_regions = (): Partial<LocationInfo>[] => {
  // Return a subset of fields to the model to keep it concise
  return allRegions.map(
    ({ name, name_en, oblast, long_name, long_name_en }) => ({
      name,
      name_en,
      oblast,
      long_name,
      long_name_en,
    }),
  );
};

/**
 * Tool function to get a list of municipalities, optionally filtered by region.
 */
export const get_list_of_municipalities = async ({
  region_name,
}: {
  region_name?: string;
}): Promise<Partial<MunicipalityInfo>[]> => {
  const municipalities = await fetchMunicipalities();
  let filteredMunicipalities = municipalities;

  if (region_name) {
    const foundRegions = await findRegions(region_name);
    if (foundRegions.length > 0) {
      const regionOblastIds = foundRegions.map((r) => r.oblast);
      filteredMunicipalities = municipalities.filter((m) =>
        regionOblastIds.includes(m.oblast),
      );
    } else {
      return []; // No matching region found
    }
  }

  // Return a subset of fields to the model to keep it concise
  return filteredMunicipalities.map(({ name, name_en, oblast, obshtina }) => ({
    name,
    name_en,
    oblast,
    obshtina,
  }));
};
