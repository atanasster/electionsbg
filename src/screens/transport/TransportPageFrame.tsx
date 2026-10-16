// The frame every /sector/transport sub-page shares: its own <h1>/<SEO> (the
// prerender declares the same title — check both when a path moves), a
// breadcrumb UP to the hub (Управление › Сектори › Транспорт › <page>), the scope
// toggle where the page is scoped and „без период" where it is not, the hash
// scroll the hub's #fragment links need, and the load/error states.
// Mirrors WaterPageFrame.

import { FC, ReactNode } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { useHashScroll } from "@/ux/useHashScroll";
import { ChartGhost } from "@/ux/motion/ChartGhost";
import { TRANSPORT_PATHS } from "@/lib/transportPaths";

export const TransportPageFrame: FC<{
  title: { bg: string; en: string };
  description: { bg: string; en: string };
  /** False on a page whose figures carry no period (budget law, Eurostat, ИСУН
   *  lifetime) — it must not show a control that would appear to filter them. */
  scoped: boolean;
  /** What the page's late-mounting sections depend on; the hash scroll restarts
   *  when any of it changes, so a hub deep link still lands. */
  ready?: unknown[];
  /** The page's own data request. While it loads the frame shows a ghost; when
   *  it fails it says so — a tile that renders nothing on failure would
   *  otherwise leave a blank page, or one that reads as „no data". */
  status?: { isLoading: boolean; isError: boolean };
  /** A sentence the PAGE supplies after „Без период" — e.g. /money naming the
   *  year its rail subsidy anchored on. The frame states nothing page-specific. */
  periodNote?: { bg: string; en: string } | null;
  /** Controls beside the scope toggle (the ?mode picker). */
  controls?: ReactNode;
  children: ReactNode;
}> = ({
  title,
  description,
  scoped,
  ready = [],
  status,
  controls,
  periodNote,
  children,
}) => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  useHashScroll(ready);
  const heading = bg ? title.bg : title.en;
  return (
    <>
      <Title description={bg ? description.bg : description.en}>
        {heading}
      </Title>
      <SectorBreadcrumb
        parent={{
          label: bg ? "Транспорт" : "Transport",
          to: TRANSPORT_PATHS.hub,
        }}
        current={heading}
      />
      <div className="mb-3 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {scoped ? (
          <ScopeControl mode="toggle" />
        ) : (
          <p className="text-xs text-muted-foreground">
            {bg
              ? "Без период — данните тук не се филтрират по парламент или година."
              : "No period — the figures here are not filtered by parliament or year."}
            {periodNote ? ` ${bg ? periodNote.bg : periodNote.en}` : null}
          </p>
        )}
        {controls}
      </div>
      {status?.isLoading ? (
        <ChartGhost className="my-4 h-[280px]" />
      ) : status?.isError ? (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {bg
            ? "Данните за тази страница не се заредиха."
            : "The data for this page failed to load."}
        </div>
      ) : (
        <div className="space-y-4">{children}</div>
      )}
    </>
  );
};
