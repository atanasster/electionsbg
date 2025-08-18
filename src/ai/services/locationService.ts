import regionsData from "@/data/json/regions.json";
import { LocationInfo } from "@/data/dataTypes";

export const allRegions = regionsData as LocationInfo[];

const sofiaMIRs = ["S23", "S24", "S25"];

/**
 * Finds region information based on a name query.
 * Handles English/Bulgarian names, and the special case for "Sofia" city.
 * @param name The name of the location to find.
 * @returns An array of matching LocationInfo objects.
 */
export const findRegions = (name: string): LocationInfo[] => {
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

  const found = allRegions.filter((region) => {
    const names = [
      region.name.toLowerCase(),
      region.name_en.toLowerCase(),
      region.long_name?.toLowerCase(),
      region.long_name_en?.toLowerCase(),
    ].filter((s): s is string => !!s);
    return names.includes(lowerCaseName);
  });

  return found;
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
