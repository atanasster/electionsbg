// Geo json files
import municipalitiesData from "./municipalities.json";
export const municipalities = municipalitiesData;
export type Municipalities = typeof municipalitiesData;

import regionsData from "./regions.json";

export type Regions = typeof regionsData;

export type RegionFeature = (typeof regionsData.features)[0];
export const regions = regionsData;
