import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Service-quality metrics parsed from the annual Доклад за състоянието на
// администрацията (административно обслужване section) by
// scripts/administration/parse_service_quality.ts. Deliberately narrow — only
// the numbers the report states machine-readably (signals volume, proposals,
// satisfaction-measurement compliance). Not a citizen-satisfaction score.

export interface ServiceQualityYear {
  signals: number | null;
  proposals: number | null;
  satisfactionMeasured: { count: number; pct: number } | null;
}

export interface ServiceQualityPayload {
  source: { name: string; url: string };
  generatedAt: string;
  latestYear: number | null;
  byYear: Record<string, ServiceQualityYear>;
}

export const useAdminServiceQuality = () =>
  useQuery({
    queryKey: ["administration", "service-quality"] as const,
    queryFn: async (): Promise<ServiceQualityPayload | undefined> => {
      const res = await fetch(dataUrl("/administration/service_quality.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as ServiceQualityPayload;
    },
    staleTime: Infinity,
  });
