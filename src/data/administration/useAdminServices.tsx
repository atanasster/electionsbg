import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Administrative-services register overview (ИИСДА) — scraped by
// scripts/administration/fetch_services.ts. Small totals-by-tier blob for the
// dashboard tile. The full id/name catalogue is served from Postgres
// (admin_services, migration 068) to the browse page at
// /sector/administration/services — services_catalog.json is that loader's
// input, not fetched by the client.

export interface ServicesTier {
  key: string;
  bg: string;
  en: string;
  count: number;
}

export interface ServicesOverview {
  generatedAt: string;
  source: { name: string; url: string };
  total: number;
  byTier: ServicesTier[];
}

export const useAdminServices = () =>
  useQuery({
    queryKey: ["administration", "services-overview"] as const,
    queryFn: async (): Promise<ServicesOverview | undefined> => {
      const res = await fetch(
        dataUrl("/administration/services_overview.json"),
      );
      if (!res.ok) return undefined;
      return (await res.json()) as ServicesOverview;
    },
    staleTime: Infinity,
  });
