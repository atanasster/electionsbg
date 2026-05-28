// "Coming soon" roadmap tile — single compact card listing the scaffolded
// My-Area features whose underlying data isn't ingested yet. Each feature
// lights up its own dedicated tile once data lands; until then this
// roadmap surfaces them so users can see what's coming instead of
// wondering why there's no school / contacts / air-quality tile.
//
// Each row reads the corresponding data file and dynamically excludes
// itself from the list once that data is populated for any município (the
// individual tile will take over). For a per-município check that's still
// a fan-out, we just check whether the keyed map is empty in the index
// file — good enough as a global "is anything ingested yet?" signal.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock,
  GraduationCap,
  Stethoscope,
  Wind,
  Shield,
  Scale,
  Phone,
  Vote,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { useMunicipalTransparency } from "@/data/transparency/useMunicipalTransparency";
import { useSchools } from "@/data/schools/useSchools";
import { useServices } from "@/data/services/useServices";
import { useAirQuality } from "@/data/air/useAirQuality";
import { useCrime } from "@/data/crime/useCrime";
import { useMunicipalContacts } from "@/data/officials/useMunicipalContacts";
import { useCouncilMinutes } from "@/data/council/useCouncilMinutes";

type Props = {
  obshtina: string;
  oblast: string;
};

type RoadmapRow = {
  key: string;
  icon: typeof Clock;
  label_bg: string;
  label_en: string;
  source: string;
  pending: boolean;
};

export const MyAreaRoadmapTile: FC<Props> = ({ obshtina, oblast }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";

  // Pull each tile's data; the row is "pending" when the município/oblast
  // entry isn't present yet. The roadmap row vanishes as soon as the
  // dedicated tile would render real content.
  const { score: transparencyScore } = useMunicipalTransparency(obshtina);
  const { schools } = useSchools(obshtina);
  const { services } = useServices(obshtina);
  const { stations: airStations } = useAirQuality(obshtina);
  const { yearly: crimeYearly } = useCrime(oblast);
  const { contact } = useMunicipalContacts(obshtina);
  const { resolutions } = useCouncilMinutes(obshtina);

  const rows: RoadmapRow[] = [
    {
      key: "transparency",
      icon: Scale,
      label_bg: "Прозрачност на местното управление (TI-BG LISI)",
      label_en: "Local government transparency (TI-BG LISI)",
      source: "transparency-bg.org",
      pending: !transparencyScore,
    },
    {
      key: "schools",
      icon: GraduationCap,
      label_bg: "Училища · НВО и ДЗИ резултати",
      label_en: "Schools · НВО and ДЗИ scores",
      source: "МОН · data.egov.bg",
      pending: schools.length === 0,
    },
    {
      key: "services",
      icon: Stethoscope,
      label_bg: "Услуги в района (лични лекари, аптеки, пощи)",
      label_en: "Local services (GPs, pharmacies, post offices)",
      source: "НЗОК · IAL · Български пощи",
      pending: !services,
    },
    {
      key: "air",
      icon: Wind,
      label_bg: "Качество на въздуха",
      label_en: "Air quality",
      source: "EEA · ИАОС",
      pending: airStations.length === 0,
    },
    {
      key: "crime",
      icon: Shield,
      label_bg: "Регистрирани престъпления",
      label_en: "Registered crimes",
      source: "МВР (на ниво ОДМВР)",
      pending: !crimeYearly,
    },
    {
      key: "contacts",
      icon: Phone,
      label_bg: "Контакти на общината",
      label_en: "Municipality contacts",
      source: "namrb.org",
      pending: !contact,
    },
    {
      key: "council",
      icon: Vote,
      label_bg: "Решения на общинския съвет (AI резюмета)",
      label_en: "Municipal council resolutions (AI summaries)",
      source: "265+ общински съвет сайтове",
      pending: resolutions.length === 0,
    },
  ];

  const pendingRows = rows.filter((r) => r.pending);
  if (pendingRows.length === 0) return null;

  return (
    <Card className="p-4 border-dashed">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-muted-foreground">
          {lang === "bg" ? "Очаквайте скоро" : "Coming soon"}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
          {pendingRows.length}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
        {lang === "bg"
          ? "Тези раздели са вградени, но техните данни още не са заредени. Когато съответният ингест приключи, всеки от тях ще се появи като отделен раздел в таблото."
          : "These sections are wired but their data isn't ingested yet. Each will appear as its own tile in the dashboard once the corresponding scrape lands."}
      </p>
      <ul className="flex flex-col gap-1.5">
        {pendingRows.map((r) => {
          const Icon = r.icon;
          return (
            <li key={r.key} className="flex items-start gap-2 text-xs py-1">
              <Icon className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">
                  {lang === "bg" ? r.label_bg : r.label_en}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {lang === "bg" ? "Източник: " : "Source: "}
                  {r.source}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {/* The `t` function is referenced so future translatable copy lands
          here without re-adding the import. */}
      <span hidden aria-hidden>
        {t("my_area_dashboard")}
      </span>
    </Card>
  );
};
