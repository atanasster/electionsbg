// Geo json files
import regionsData from "./regions.json";
export type Regions = typeof regionsData;
export type RegionFeature = (typeof regionsData.features)[0];
export const regions = regionsData;

import municipalitiesData from "./municipalities.json";
export const municipalities = municipalitiesData;
export type Municipalities = typeof municipalitiesData;

import settlementsData from "./settlements.json";
export const settlements = settlementsData;
export type Settlements = typeof settlementsData;
export type SettlementFeature = (typeof settlementsData.features)[0];
