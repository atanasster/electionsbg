// Public services per município (GP, specialist, pharmacy, school, post,
// kметство). Empty until update-public-services runs (see
// scripts/services/README.md).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type ServiceCategory =
  | "gp"
  | "specialist"
  | "pharmacy"
  | "school"
  | "post"
  | "kmetstvo";

export type ServiceEntry = {
  name: string;
  address?: string;
  phone?: string;
  /** "lon,lat" same convention as settlements.json */
  loc?: string;
  url?: string;
};

export type ServicesFile = {
  source: string;
  indexName: string;
  categories: Record<ServiceCategory, { bg: string; en: string }>;
  servicesByObshtina: Record<
    string,
    Partial<Record<ServiceCategory, ServiceEntry[]>>
  >;
  note?: string;
};

const fetchServices = async (): Promise<ServicesFile> => {
  const r = await fetch(dataUrl("/services/index.json"));
  if (!r.ok) throw new Error("services fetch failed");
  return r.json();
};

export const useServices = (obshtina?: string | null) => {
  const { data } = useQuery({
    queryKey: ["services"],
    queryFn: fetchServices,
    staleTime: Infinity,
  });
  const services = obshtina ? data?.servicesByObshtina[obshtina] : undefined;
  return { data, services };
};
