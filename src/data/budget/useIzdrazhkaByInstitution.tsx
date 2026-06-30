import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Per-first-level-spending-unit "издръжка" (operating/maintenance) by fiscal
// year, in EUR thousands, reconstructed from each year's State Budget Law:
//   издръжка = Текущи разходи − Персонал − Субсидии − Лихви − трансфери за домакинствата.
// This is the same residual Asen Vasilev charts in his "Бюджет 2026: Перо по
// перо" post; the multi-year context (2018→2026) is the fair-picture extension.
// `yoy` is the year-over-year % change keyed by the later year. 2026 = draft.
export type IzdrazhkaInstitution = {
  bg: string;
  values: Record<string, number>; // year → EUR thousands
  yoy: Record<string, number>; // year → % vs previous available year
};

export type IzdrazhkaPayload = {
  note: string;
  currency: string;
  years: number[];
  draftYear: number;
  source: string;
  institutions: IzdrazhkaInstitution[];
};

export const useIzdrazhkaByInstitution = () =>
  useQuery({
    queryKey: ["izdrazhkaByInstitution"],
    queryFn: async () => {
      const res = await fetch(dataUrl("/budget/izdrazhka_by_institution.json"));
      if (!res.ok) return null;
      return (await res.json()) as IzdrazhkaPayload;
    },
  });
