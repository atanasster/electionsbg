import { useMemo } from "react";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMps } from "./useMps";

// Raw shape returned by parliament.bg's /api/v1/mp-profile/bg/{id} (we cache to disk)
type RawProfile = {
  A_ns_MP_id: number;
  A_ns_MPL_Name1: string;
  A_ns_MPL_Name2: string;
  A_ns_MPL_Name3: string;
  A_ns_MP_BDate?: string;
  A_ns_B_Country?: string;
  A_ns_B_City?: string;
  A_ns_MP_Email?: string;
  A_ns_MP_fbook?: string;
  A_ns_MP_url?: string;
  A_ns_MPL_CV?: string;
  A_ns_MPL_Spec?: string;
  A_ns_MPL_Prof?: string;
  A_ns_MPL_City?: string;
  A_ns_CoalL_value?: string;
  A_ns_Va_name?: string;
  A_ns_MP_img?: string | null;
  oldnsList?: {
    A_nsL_value: string;
    A_nsL_value_short: string;
    A_ns_folder: string;
  }[];
  munList?: { A_ns_Va_M_id: number; A_ns_Va_M_name: string }[];
  lngList?: { LngL_value?: string; A_LngL_value?: string }[];
};

export type MpProfile = {
  id: number;
  name: string;
  givenName: string;
  middleName: string;
  familyName: string;
  region: { code: string; name: string } | null;
  partyGroup: string | null;
  partyGroupShort: string | null;
  position: string | null;
  photoUrl: string;
  profileUrl: string;
  birthDate: string | null;
  birthCountry: string | null;
  birthCity: string | null;
  residenceCity: string | null;
  email: string | null;
  facebook: string | null;
  website: string | null;
  cv: string | null;
  specialization: string | null;
  profession: string | null;
  coalition: string | null;
  languages: string[];
  pastTerms: { ns: string; nsShort: string; folder: string }[];
  municipalities: string[];
};

const PHOTO_BASE = "https://www.parliament.bg/images/Assembly/";
const PROFILE_BASE = "https://www.parliament.bg/bg/MP/";

const parseRegion = (
  vaName?: string,
): { code: string; name: string } | null => {
  if (!vaName) return null;
  const m = vaName.match(/^(\d{1,2})-(.+)$/);
  if (!m) return { code: "", name: vaName };
  return { code: m[1].padStart(2, "0"), name: m[2].trim() };
};

const toProfile = (
  raw: RawProfile,
  fallback: {
    partyGroup: string | null;
    partyGroupShort: string | null;
    position: string | null;
    region: { code: string; name: string } | null;
  },
): MpProfile => ({
  id: raw.A_ns_MP_id,
  name: [raw.A_ns_MPL_Name1, raw.A_ns_MPL_Name2, raw.A_ns_MPL_Name3]
    .filter(Boolean)
    .join(" "),
  givenName: raw.A_ns_MPL_Name1 ?? "",
  middleName: raw.A_ns_MPL_Name2 ?? "",
  familyName: raw.A_ns_MPL_Name3 ?? "",
  region: parseRegion(raw.A_ns_Va_name) ?? fallback.region,
  partyGroup: fallback.partyGroup,
  partyGroupShort: fallback.partyGroupShort,
  position: fallback.position,
  photoUrl: raw.A_ns_MP_img
    ? `${PHOTO_BASE}${raw.A_ns_MP_img}`
    : `${PHOTO_BASE}${raw.A_ns_MP_id}.png`,
  profileUrl: `${PROFILE_BASE}${raw.A_ns_MP_id}`,
  birthDate: raw.A_ns_MP_BDate || null,
  birthCountry: raw.A_ns_B_Country || null,
  birthCity: raw.A_ns_B_City || null,
  residenceCity: raw.A_ns_MPL_City || null,
  email: raw.A_ns_MP_Email || null,
  facebook: raw.A_ns_MP_fbook || null,
  website: raw.A_ns_MP_url || null,
  cv: raw.A_ns_MPL_CV ? raw.A_ns_MPL_CV.trim() : null,
  specialization: raw.A_ns_MPL_Spec ? raw.A_ns_MPL_Spec.trim() : null,
  profession: raw.A_ns_MPL_Prof ? raw.A_ns_MPL_Prof.trim() : null,
  coalition: raw.A_ns_CoalL_value ? raw.A_ns_CoalL_value.trim() : null,
  languages: (raw.lngList ?? [])
    .map((l) => l.LngL_value ?? l.A_LngL_value ?? "")
    .filter(Boolean),
  pastTerms: (raw.oldnsList ?? []).map((t) => ({
    ns: t.A_nsL_value ?? "",
    nsShort: t.A_nsL_value_short ?? "",
    folder: t.A_ns_folder ?? "",
  })),
  municipalities: (raw.munList ?? [])
    .map((m) => m.A_ns_Va_M_name)
    .filter(Boolean),
});

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, number | undefined]>): Promise<
  RawProfile | undefined
> => {
  const id = queryKey[1];
  if (!id) return undefined;
  const response = await fetch(`/parliament/profiles/${id}.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const useMpProfile = (name?: string | null) => {
  const { findMpByName, currentNs } = useMps();
  const indexEntry = findMpByName(name);
  const id = indexEntry?.id;

  const { data: raw } = useQuery({
    queryKey: ["parliament_profile", id] as [string, number | undefined],
    queryFn,
    enabled: !!id,
    staleTime: Infinity,
  });

  const profile = useMemo<MpProfile | undefined>(() => {
    if (!raw || !indexEntry) return undefined;
    return toProfile(raw, {
      partyGroup: indexEntry.currentPartyGroup,
      partyGroupShort: indexEntry.currentPartyGroupShort,
      position: indexEntry.position,
      region: indexEntry.currentRegion,
    });
  }, [raw, indexEntry]);

  return { profile, indexEntry, ns: currentNs };
};
