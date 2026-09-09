import { useMemo } from "react";
import { useAreaSearchItems } from "@/data/search/useAreaSearchItems";
import type {
  QuestionLookupAdapter,
  QuestionLookupOption,
} from "@/lib/questions/selector";

type PersonHit = {
  name: string;
  primary_role?: string | null;
  party?: string | null;
  place_label?: string | null;
};

type CompanyHit = { eik: string; name: string; primaryName?: string | null };

const readJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Lookup failed: ${response.status}`);
  return response.json() as Promise<T>;
};

export const useQuestionLookupAdapters = (): Partial<
  Record<"place" | "person" | "company", QuestionLookupAdapter>
> => {
  const { search: searchPlaces } = useAreaSearchItems(true);
  return useMemo(() => {
    const place: QuestionLookupAdapter = {
      search: async (query) =>
        (searchPlaces(query) ?? []).slice(0, 8).map(({ item }) => ({
          value: item.key,
          label: item.name,
          level:
            item.type === "s"
              ? "населено място"
              : item.type === "d"
                ? "район"
                : "община",
          detail: item.parentName,
        })),
    };
    const person: QuestionLookupAdapter = {
      search: async (query) => {
        const body = await readJson<{
          power?: PersonHit[];
          money?: PersonHit[];
          others?: PersonHit[];
        }>(`/api/db/person-search?q=${encodeURIComponent(query)}`);
        const seen = new Set<string>();
        return [
          ...(body.power ?? []),
          ...(body.money ?? []),
          ...(body.others ?? []),
        ]
          .filter((hit) => !seen.has(hit.name) && seen.add(hit.name))
          .slice(0, 8)
          .map(
            (hit): QuestionLookupOption => ({
              value: hit.name,
              label: hit.name,
              level: hit.primary_role ?? undefined,
              detail: [hit.party, hit.place_label].filter(Boolean).join(" · "),
            }),
          );
      },
    };
    const company: QuestionLookupAdapter = {
      search: async (query) => {
        const body = await readJson<{
          companies?: CompanyHit[];
          awarders?: CompanyHit[];
        }>(`/api/db/procurement-search?q=${encodeURIComponent(query)}`);
        const seen = new Set<string>();
        return [...(body.companies ?? []), ...(body.awarders ?? [])]
          .filter((hit) => !seen.has(hit.eik) && seen.add(hit.eik))
          .slice(0, 8)
          .map((hit) => ({
            value: hit.eik,
            label: hit.name,
            level: "ЕИК",
            detail: hit.eik,
          }));
      },
    };
    return { place, person, company };
  }, [searchPlaces]);
};
