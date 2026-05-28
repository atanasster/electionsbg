// Services-near-you tile. Suomi.fi-style category list of GPs, pharmacies,
// schools, post offices, kметства. Auto-hides until update-public-services
// populates the data file.
//
// Categories present in the município render as a horizontal counts strip
// at the top; expanding a category shows the first 5 entries.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Stethoscope,
  Pill,
  GraduationCap as SchoolIcon,
  Mail,
  Landmark,
  Activity,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  useServices,
  type ServiceCategory,
  type ServiceEntry,
} from "@/data/services/useServices";

type Props = {
  obshtina: string;
};

const ICONS: Record<ServiceCategory, typeof Stethoscope> = {
  gp: Stethoscope,
  specialist: Activity,
  pharmacy: Pill,
  school: SchoolIcon,
  post: Mail,
  kmetstvo: Landmark,
};

const CATEGORY_ORDER: ServiceCategory[] = [
  "gp",
  "specialist",
  "pharmacy",
  "school",
  "post",
  "kmetstvo",
];

const PREVIEW_CAP = 5;

export const MyAreaServicesTile: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data, services } = useServices(obshtina);
  const [expanded, setExpanded] = useState<ServiceCategory | null>(null);

  const counts = useMemo(() => {
    if (!services) return new Map<ServiceCategory, number>();
    const m = new Map<ServiceCategory, number>();
    for (const cat of CATEGORY_ORDER) {
      const list = services[cat];
      if (list && list.length > 0) m.set(cat, list.length);
    }
    return m;
  }, [services]);

  if (!data || counts.size === 0) return null;

  const renderEntry = (e: ServiceEntry, i: number) => (
    <div key={`${e.name}-${i}`} className="text-xs">
      <div className="font-medium truncate">{e.name}</div>
      {e.address ? (
        <div className="text-muted-foreground truncate">{e.address}</div>
      ) : null}
      {e.phone ? (
        <a
          href={`tel:${e.phone}`}
          className="text-primary underline tabular-nums"
        >
          {e.phone}
        </a>
      ) : null}
    </div>
  );

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Stethoscope className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">{t("my_area_services_title")}</h2>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {Array.from(counts.entries()).map(([cat, n]) => {
          const Icon = ICONS[cat];
          const active = expanded === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setExpanded(active ? null : cat)}
              className={`flex flex-col items-center gap-1 rounded-md border px-2 py-2 transition-colors ${
                active
                  ? "bg-primary/10 border-primary/40"
                  : "hover:bg-accent/30"
              }`}
            >
              <Icon className="size-4 text-primary" />
              <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                {data.categories[cat][lang]}
              </span>
              <span className="text-xs font-bold tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>
      {expanded && services?.[expanded] ? (
        <div className="mt-3 flex flex-col gap-2 max-h-64 overflow-y-auto">
          {services[expanded]!.slice(0, PREVIEW_CAP).map(renderEntry)}
          {services[expanded]!.length > PREVIEW_CAP ? (
            <p className="text-[10px] text-muted-foreground italic">
              {t("my_area_services_more", {
                count: services[expanded]!.length - PREVIEW_CAP,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};
