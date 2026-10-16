// "Европейски средства за транспорт (ИСУН)" — on /sector/transport/money#funds.
// The bodies' EU-funds absorption per beneficiary on the GRANT basis (D6): the
// БФП awarded (fund_projects.grant_eur) against what has actually been paid. No
// total project value (audit 2026-10-17, T3): a phased project carries its total
// once per phase — Елин Пелин–Костенец 2014 €806M and 2021 €670M — so a sum
// double-counts. The RRP broadband project is excluded (T2, D1). The old tile
// divided paid by fund_beneficiaries' TOTAL project value, which read НКЖИ's
// absorption as 30.8% for a real 65.9%.
//
// Lifetime figures (programme periods), never scoped — the page says „без
// период". Mirrors VikEuFundsTile.

import { FC } from "react";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { isBg } from "@/i18n";
import type { TransportFundOp } from "@/data/transport/useTransportSector";
import {
  euFundsExcludedCaption,
  euFundsPassThroughCaption,
  transportBodyName,
} from "@/lib/transportReferenceData";

const TOP_N = 10;

export const TransportEuFundsTile: FC<{
  funds: TransportFundOp[];
  /** The server dropped TRANSPORT_EU_FUNDS_EXCLUDED; false on an older function,
   *  whose figures still include them — the caption then says so. */
  excludedApplied?: boolean;
}> = ({ funds, excludedApplied = true }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const rows = funds
    .filter((f) => f.grantEur > 0)
    .sort((a, b) => b.grantEur - a.grantEur || a.eik.localeCompare(b.eik));
  if (!rows.length)
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        {bg
          ? "Няма европейски проекти на структурите на сектора в ИСУН."
          : "No EU-funded projects of the sector's bodies in ISUN."}
      </p>
    );

  const grant = rows.reduce((s, f) => s + f.grantEur, 0);
  const paid = rows.reduce((s, f) => s + f.paidEur, 0);
  const absorption = grant > 0 ? paid / grant : 0;
  const max = Math.max(...rows.map((f) => f.grantEur), 1);
  const eur = (n: number) => formatEurCompact(n, lang);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? "Европейски средства за транспорт (ИСУН)"
            : "EU funds for transport — ИСУН (ISUN)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-xl font-bold tabular-nums">{eur(grant)}</div>
            <div className="text-[11px] text-muted-foreground">
              {bg ? "безвъзмездна помощ" : "grant awarded"}
            </div>
          </div>
          <div>
            <div className="text-xl font-bold tabular-nums">{eur(paid)}</div>
            <div className="text-[11px] text-muted-foreground">
              {bg ? "изплатени" : "paid"}
            </div>
          </div>
          <div>
            <div
              className={`text-xl font-bold tabular-nums ${absorption < 0.5 ? "text-amber-600 dark:text-amber-400" : ""}`}
            >
              {Math.round(absorption * 100)}%
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bg ? "изплатени от помощта" : "of the grant paid"}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {/* The declared exclusions and pass-throughs, through the ONE caption
              builder the hub tile, the AI tool and the prerender also use. */}
          {euFundsExcludedCaption(bg ? "bg" : "en", excludedApplied)}{" "}
          {euFundsPassThroughCaption(bg ? "bg" : "en")}
        </p>

        <div className="space-y-1.5">
          {rows.slice(0, TOP_N).map((f) => {
            const abs = f.grantEur > 0 ? f.paidEur / f.grantEur : 0;
            return (
              <div key={f.eik} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <AwarderLink
                    eik={f.eik}
                    className="min-w-0 truncate hover:text-primary hover:underline"
                  >
                    {transportBodyName(f.eik, lang, f.name)}
                  </AwarderLink>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {eur(f.grantEur)}
                    <span
                      className={`ml-1 ${abs < 0.25 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground/70"}`}
                    >
                      {Math.round(abs * 100)}%
                    </span>
                  </span>
                </div>
                {/* Grant bar with the paid portion filled darker. */}
                <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500/30"
                    style={{
                      width: `${Math.max(2, (f.grantEur / max) * 100)}%`,
                    }}
                  >
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{ width: `${Math.min(100, abs * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Безвъзмездната финансова помощ (БФП) по проектите на структурите в регистъра ИСУН — предимно ОП „Транспорт и транспортна инфраструктура“ и ПТС: жп модернизация и подвижен състав. Светлата лента е помощта, тъмната — изплатеното; процентът е изплатената част. Сумите са за целия програмен период и не се събират с обществените поръчки."
            : "The EU grant on the bodies' projects in the ISUN register — mostly the Transport and Transport Infrastructure programmes: rail modernisation and rolling stock. The light bar is the grant, the dark fill what has been paid; the percentage is the paid share. Figures cover the whole programme period and are never added to procurement."}
        </p>
      </CardContent>
    </Card>
  );
};
