// The frame every /water sub-page shares: its own <h1>/<SEO> (the prerender
// declares the same title — check both when a path moves), a breadcrumb UP to
// the hub, the scope toggle where the page is scoped, and the hash scroll the
// hub's #fragment links need. The tiles inside fetch their own data and carry
// their own loading and empty states.

import { FC, ReactNode } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { useHashScroll } from "@/ux/useHashScroll";
import { ChartGhost } from "@/ux/motion/ChartGhost";
import { WATER_PATHS } from "./waterRegistry";

export const WaterPageFrame: FC<{
  title: { bg: string; en: string };
  description: { bg: string; en: string };
  /** False on a page whose figures carry no period (НСИ, ИСУН lifetime) — it
   *  must not show a control that would appear to filter them (W4). */
  scoped: boolean;
  /** What the page's late-mounting sections depend on; the hash scroll restarts
   *  when any of it changes, so a hub deep link still lands. */
  ready?: unknown[];
  /** The page's own data request. While it loads the frame shows a ghost; when
   *  it fails it says so — a tile that renders nothing on failure would
   *  otherwise leave a blank page, or one that reads as „no data". */
  status?: { isLoading: boolean; isError: boolean };
  children: ReactNode;
}> = ({ title, description, scoped, ready = [], status, children }) => {
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
          label: bg ? "Води (ВиК)" : "Water (ВиК)",
          to: WATER_PATHS.hub,
        }}
        current={heading}
      />
      {scoped ? (
        <div className="mb-3 mt-3">
          <ScopeControl mode="toggle" />
        </div>
      ) : (
        <p className="mb-3 mt-3 text-xs text-muted-foreground">
          {bg
            ? "Без период — данните тук не се филтрират по парламент или година."
            : "No period — the figures here are not filtered by parliament or year."}
        </p>
      )}
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
