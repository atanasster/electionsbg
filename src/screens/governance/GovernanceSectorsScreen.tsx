// /governance/sectors — the "Държавни сектори" hub.
//
// A single visual entry point to every government-entity dashboard, replacing
// the 15-row "Държавни структури" column that used to bloat the управление
// dropdown. Medium responsive tiles grouped into thematic clusters, each with a
// bespoke infographic scene (see sectorScenes.tsx) — not an icon. The tile just
// routes to the sector's existing home (an awarder pack /awarder/:eik or a
// standalone dashboard like /water, /judiciary, /defense); no per-sector data is
// fetched here, so the hub stays instant.
//
// Транспорт (МТС) and Администрация (МЕУ) point at their awarder seats for now;
// when the planned /transport and /administration dashboards ship, repoint the
// two `to` fields (the same way water/defense graduated from awarder page to
// standalone view). See docs/plans/{transport,administration}-view-v1.md.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import {
  ROADS_AWARDER_PATH,
  NOI_AWARDER_PATH,
  NZOK_AWARDER_PATH,
  MON_AWARDER_PATH,
  DFZ_AWARDER_PATH,
} from "@/screens/components/procurement/sectorPacks";
import { SECTOR_SCENES } from "./sectorScenes";

// Awarder seats given by EIK rather than a sectorPacks path export, so this hub
// stays self-contained: the two revenue collectors (НАП/Митници) plus the two
// sectors whose standalone view isn't built yet (Транспорт → /transport,
// Администрация → /administration). All four are real awarder pages today;
// repoint to the standalone dashboards when they ship (as water/defense did).
const NAP_AWARDER_PATH = "/awarder/131063188"; // НАП
const CUSTOMS_AWARDER_PATH = "/awarder/000627597"; // Агенция „Митници"
const TRANSPORT_AWARDER_PATH = "/awarder/000695388"; // МТС
const ADMIN_AWARDER_PATH = "/awarder/180680495"; // МЕУ

type ClusterId = "infra" | "social" | "state" | "security" | "land";

interface Sector {
  id: string; // scene key (sectorScenes)
  titleKey: string;
  descKey: string;
  agency: string; // Cyrillic acronym — same in both languages
  to: string;
  accent: string; // per-sector pop; tuned to hold on cream and navy grounds
}

const CLUSTERS: { id: ClusterId; labelKey: string; sectors: Sector[] }[] = [
  {
    id: "infra",
    labelKey: "sectors_cluster_infra",
    sectors: [
      {
        id: "roads",
        titleKey: "sector_roads_title",
        descKey: "sector_roads_desc",
        agency: "АПИ",
        to: ROADS_AWARDER_PATH,
        accent: "#c9702f",
      },
      {
        id: "water",
        titleKey: "sector_water_title",
        descKey: "sector_water_desc",
        agency: "ВиК",
        to: "/water",
        accent: "#2f8fb0",
      },
      {
        id: "transport",
        titleKey: "sector_transport_title",
        descKey: "sector_transport_desc",
        agency: "МТС",
        to: TRANSPORT_AWARDER_PATH,
        accent: "#4a7a8f",
      },
    ],
  },
  {
    id: "social",
    labelKey: "sectors_cluster_social",
    sectors: [
      {
        id: "pension",
        titleKey: "sector_pension_title",
        descKey: "sector_pension_desc",
        agency: "НОИ",
        to: "/pensions",
        accent: "#b07d2f",
      },
      {
        id: "social",
        titleKey: "sector_social_title",
        descKey: "sector_social_desc",
        agency: "НОИ",
        to: NOI_AWARDER_PATH,
        accent: "#9c8636",
      },
      {
        id: "health",
        titleKey: "sector_health_title",
        descKey: "sector_health_desc",
        agency: "НЗОК",
        to: NZOK_AWARDER_PATH,
        accent: "#c14b57",
      },
      {
        id: "edu",
        titleKey: "sector_edu_title",
        descKey: "sector_edu_desc",
        agency: "МОН",
        to: MON_AWARDER_PATH,
        accent: "#3a7a5e",
      },
      {
        id: "schools",
        titleKey: "sector_schools_title",
        descKey: "sector_schools_desc",
        agency: "МОН",
        to: "/education",
        accent: "#43886a",
      },
    ],
  },
  {
    id: "state",
    labelKey: "sectors_cluster_state",
    sectors: [
      {
        id: "revenue",
        titleKey: "sector_revenue_title",
        descKey: "sector_revenue_desc",
        agency: "НАП",
        to: NAP_AWARDER_PATH,
        accent: "#7a6a2f",
      },
      {
        id: "customs",
        titleKey: "sector_customs_title",
        descKey: "sector_customs_desc",
        agency: "АМ",
        to: CUSTOMS_AWARDER_PATH,
        accent: "#3f6a8a",
      },
      {
        id: "administration",
        titleKey: "sector_admin_title",
        descKey: "sector_admin_desc",
        agency: "МЕУ",
        to: ADMIN_AWARDER_PATH,
        accent: "#6a6f86",
      },
    ],
  },
  {
    id: "security",
    labelKey: "sectors_cluster_security",
    sectors: [
      {
        id: "defense",
        titleKey: "sector_defense_title",
        descKey: "sector_defense_desc",
        agency: "МО",
        to: "/defense",
        accent: "#5a6b4a",
      },
      {
        id: "justice",
        titleKey: "sector_justice_title",
        descKey: "sector_justice_desc",
        agency: "ВСС",
        to: "/judiciary",
        accent: "#7a5a8f",
      },
    ],
  },
  {
    id: "land",
    labelKey: "sectors_cluster_land",
    sectors: [
      {
        id: "agri",
        titleKey: "sector_agri_title",
        descKey: "sector_agri_desc",
        agency: "ДФЗ",
        to: DFZ_AWARDER_PATH,
        accent: "#8a7a2a",
      },
      {
        id: "culture",
        titleKey: "sector_culture_title",
        descKey: "sector_culture_desc",
        agency: "НФЦ",
        to: "/culture",
        accent: "#b5573f",
      },
    ],
  },
];

// Two layouts from one component. On phones the tile is a COMPACT ROW —
// a small infographic thumbnail on the left + title/agency/descriptor on the
// right — so all 15 sectors stay scannable instead of each eating a full-bleed
// banner (~500px tall × 15 = an endless scroll). From `sm` up it flips to the
// full banner-on-top card. The flex-direction switch (row → col) is what turns
// the left thumbnail into a top banner and the right border into a bottom one.
const SectorTile: FC<{ sector: Sector }> = ({ sector }) => {
  const { t } = useTranslation();
  const Scene = SECTOR_SCENES[sector.id];
  return (
    <Link
      to={sector.to}
      style={{ ["--sector" as string]: sector.accent }}
      className="group relative flex flex-row overflow-hidden rounded-xl border border-border bg-card transition-all duration-150 hover:border-[color-mix(in_srgb,var(--sector)_55%,hsl(var(--border)))] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:rounded-2xl sm:hover:-translate-y-0.5"
    >
      <div
        className="flex w-24 shrink-0 items-center border-r border-border sm:w-full sm:border-b sm:border-r-0"
        style={{
          background:
            "linear-gradient(160deg, color-mix(in srgb, var(--sector) 14%, hsl(var(--card))), hsl(var(--card)))",
        }}
      >
        {Scene ? <Scene /> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2.5 sm:justify-start sm:gap-1.5 sm:p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-base font-semibold tracking-tight sm:text-lg">
            {t(sector.titleKey)}
          </span>
          <span
            className="shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-wide"
            style={{
              color:
                "color-mix(in srgb, var(--sector) 72%, hsl(var(--foreground)))",
              background: "color-mix(in srgb, var(--sector) 16%, transparent)",
              borderColor: "color-mix(in srgb, var(--sector) 30%, transparent)",
            }}
          >
            {sector.agency}
          </span>
        </div>
        <span className="truncate text-xs text-muted-foreground sm:whitespace-normal sm:text-sm">
          {t(sector.descKey)}
        </span>
        <span
          className="mt-auto hidden items-center gap-1.5 pt-1.5 text-xs font-semibold sm:inline-flex"
          style={{
            color:
              "color-mix(in srgb, var(--sector) 70%, hsl(var(--foreground)))",
          }}
        >
          {t("sectors_hub_view") || "виж сектора"}
          <span className="transition-transform duration-150 group-hover:translate-x-0.5">
            →
          </span>
        </span>
      </div>
    </Link>
  );
};

export const GovernanceSectorsScreen: FC = () => {
  const { t } = useTranslation();
  const title = t("sectors_hub_title") || "Държавни сектори";
  return (
    <>
      <Title
        description={
          t("sectors_hub_seo_description") ||
          "Всичко, което държавата харчи и решава — по сектори: пътища, здравна каса, пенсии, отбрана, правосъдие и още."
        }
      >
        {title}
      </Title>
      <p className="mx-auto -mt-2 max-w-[62ch] text-center text-sm text-muted-foreground sm:text-base">
        {t("sectors_hub_lede") ||
          "Един вход към всяка държавна структура — пари, договори, отговорни институции."}
      </p>

      <section
        aria-label={title}
        className="my-6 flex flex-col gap-7 sm:my-8 sm:gap-10"
      >
        {CLUSTERS.map((cluster) => (
          <div key={cluster.id}>
            <div className="mb-3 flex items-center gap-3 sm:mb-4">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {t(cluster.labelKey)}
              </span>
              <span
                aria-hidden
                className="h-px flex-1 bg-gradient-to-r from-border to-transparent"
              />
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {cluster.sectors.map((s) => (
                <SectorTile key={s.id} sector={s} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
};
