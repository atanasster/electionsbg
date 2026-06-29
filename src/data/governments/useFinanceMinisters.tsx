import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Ministers of Finance by tenure, aligned to cabinet boundaries. A cabinet can
// have more than one finance minister (Borisov III: Goranov → Ananiev in 2020),
// so tenures are dated, not 1:1 with cabinets. `cabinetId` references
// data/governments.json[].id.
export type FinanceMinister = {
  bg: string;
  en: string;
  startDate: string;
  endDate: string | null;
  cabinetId: string;
  // Optional personal party affiliation (canonical nickName, e.g. "ПП",
  // "ГЕРБ"). Set when it should override the cabinet's colour — e.g. a partisan
  // minister serving in a caretaker cabinet (Асен Василев = ПП under the Янев
  // caretaker). Genuine independents / technocrats leave it unset.
  party?: string;
};

type FinanceMinistersPayload = {
  financeMinisters: FinanceMinister[];
};

export const useFinanceMinisters = () =>
  useQuery({
    queryKey: ["financeMinisters"],
    queryFn: async () => {
      const res = await fetch(dataUrl("/finance_ministers.json"));
      if (!res.ok) return [] as FinanceMinister[];
      const payload = (await res.json()) as FinanceMinistersPayload;
      return payload?.financeMinisters ?? [];
    },
  });
