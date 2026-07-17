// The bridge to the money: every awarder institution in the sector, each
// deep-linking to its own /awarder/:eik page. Single-member sectors render one
// full-width row plus a note pointing at the awarder page for the full breakdown.
// The list itself is the shared AwarderListSection.

import { FC } from "react";
import { useSearchParams } from "react-router-dom";
import { AwarderListSection } from "@/screens/components/procurement/AwarderListSection";
import { useTranslation } from "react-i18next";
import type { SectorDashboardConfig } from "./sectorDashboards";

export const SectorAwardersTile: FC<{ config: SectorDashboardConfig }> = ({
  config,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { members } = config;
  const single = members.length === 1;

  // The "whole group" link goes to the sector-filtered contracts table — the
  // real consolidated view across every member EIK. (It must NOT link to
  // /awarder/leadEik: on a sector-lead awarder page the group pack is disabled —
  // it has moved to /sector/:id — so that page only shows the lead entity's own
  // single-seat procurement, which for МВР is a tiny, name-collided directorate
  // record under the ministry's shared Булстат.) Preserve the active time scope
  // (pscope / elections) so the group view opens in the same window.
  const [searchParams] = useSearchParams();
  const groupHref = (() => {
    const p = new URLSearchParams(searchParams);
    p.set("sector", config.browsePackId ?? config.id);
    return `/procurement/contracts?${p.toString()}`;
  })();

  return (
    <AwarderListSection
      id="sector-awarders"
      title={
        bg
          ? single
            ? "Възложителят на сектора"
            : `Възложителите на сектора (${members.length})`
          : single
            ? "The sector's awarder"
            : `The sector's awarders (${members.length})`
      }
      rows={members.map((m) => ({
        eik: m.eik,
        name: bg ? m.name.bg : m.name.en,
        group: m.group ? (bg ? m.group.bg : m.group.en) : undefined,
      }))}
      lead={
        single
          ? undefined
          : {
              to: groupHref,
              label: bg
                ? "Обществените поръчки на цялата група"
                : "Public procurement of the whole group",
            }
      }
      footnote={
        single
          ? bg
            ? "Пълната разбивка по договори, изпълнители и категории е на страницата на възложителя."
            : "The full breakdown by contracts, contractors and categories is on the awarder's page."
          : undefined
      }
    />
  );
};
