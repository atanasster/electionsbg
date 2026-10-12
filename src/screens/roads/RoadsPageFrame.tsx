// The frame every /sector/roads sub-page shares: its own <h1>/<SEO> (the
// prerender declares the same title — check both when a path moves), a
// breadcrumb UP to the hub, the scope toggle, and the load/error states. The
// body renders only once the roll-up model is built.

import { FC, ReactNode } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { ChartGhost } from "@/ux/motion/ChartGhost";
import { useRoadsModel } from "@/data/roads/useRoadsModel";
import type { RoadsModel } from "@/lib/roadAttributes";
import { ROADS_PATHS } from "./roadsRegistry";

export const RoadsPageFrame: FC<{
  title: { bg: string; en: string };
  description: { bg: string; en: string };
  children: (model: RoadsModel) => ReactNode;
}> = ({ title, description, children }) => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const { model, isLoading, isError } = useRoadsModel();
  const heading = bg ? title.bg : title.en;
  return (
    <>
      <Title description={bg ? description.bg : description.en}>
        {heading}
      </Title>
      <SectorBreadcrumb
        parent={{ label: bg ? "Пътища" : "Roads", to: ROADS_PATHS.hub }}
        current={heading}
      />
      <div className="mb-3 mt-3">
        <ScopeControl mode="toggle" />
      </div>
      {isLoading ? <ChartGhost className="my-4 h-[280px]" /> : null}
      {!isLoading && isError ? (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {bg
            ? "Данните за пътните поръчки не се заредиха."
            : "The road contract data failed to load."}
        </div>
      ) : null}
      {model && model.totalEur === 0 ? (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {bg
            ? "Няма пътни договори в избрания период."
            : "No road contracts in the selected window."}
        </div>
      ) : null}
      {model && model.totalEur > 0 ? (
        <div className="space-y-4">{children(model)}</div>
      ) : null}
    </>
  );
};
