// "Парите: 25-те структури на МО" — the bridge to the money half of the story.
// Every МО budget unit, grouped by universe, each deep-linking to its own awarder
// page; and a lead link to the consolidated МО group pack. Mirrors the judiciary's
// JudicialAwardersTile (one link per body back to /awarder/:eik).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useScopedHref } from "@/data/scope/useScope";
import { useTranslation } from "react-i18next";
import { Landmark, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  MO_ENTITIES,
  MOD_EIK,
  DEFENSE_UNIVERSES,
  universeLabel,
} from "@/lib/defenseReferenceData";

export const DefenseAwardersTile: FC = () => {
  const { i18n } = useTranslation();
  // Carry the active scope (pscope/elections) onto the awarder page — a bare
  // pathname resets it to the default window (see SectorAwardersTile).
  const scopedHref = useScopedHref();
  const lang = i18n.language;
  const bg = lang === "bg";

  return (
    <Card id="defense-awarders">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg ? "Парите: 25-те структури на МО" : "The money: the 25 МО units"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <Link
          to={scopedHref(`/awarder/${MOD_EIK}`)}
          className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5 text-sm hover:border-primary/50"
        >
          <span className="font-medium">
            {bg
              ? "Обществените поръчки на цялата МО група"
              : "Public procurement of the whole МО group"}
          </span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>

        <div className="space-y-3">
          {DEFENSE_UNIVERSES.map((u) => {
            const rows = MO_ENTITIES.filter((e) => e.universe === u);
            if (!rows.length) return null;
            return (
              <div key={u}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {universeLabel(u, lang)}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rows.map((e) => (
                    <Link
                      key={e.eik}
                      to={scopedHref(`/awarder/${e.eik}`)}
                      className="rounded-full border px-2.5 py-1 text-xs hover:border-primary/50 hover:text-primary"
                    >
                      {e.name}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Всяка структура има собствена страница с обществените си поръчки. Придобиването на F-16/Stryker е по US FMS и не е в тези договори."
            : "Each unit has its own procurement page. F-16/Stryker acquisition is via US FMS and not in these contracts."}
        </p>
      </CardContent>
    </Card>
  );
};
