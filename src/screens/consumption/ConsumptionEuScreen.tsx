// /consumption/eu — Bulgarian food prices vs the EU, from official Eurostat Price
// Level Indices (EU27 = 100). Per-category diverging bars show where BG sits
// relative to the EU average (dairy & oils above, meat/bread/produce below), plus
// a peer row for the food total. Official PPP-programme statistics — VAT-handled
// and quality-adjusted at source, so no per-SKU caveats. See
// docs/plans/consumption-hub-v1.md §1 (cijene.dev was dropped for this).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import { useFoodPli, type PeerGeo } from "@/data/macro/useMacroPeers";
import { Flag } from "@/screens/components/euCompare/Flag";
import {
  GEO_SHORT_BG,
  GEO_SHORT_EN,
} from "@/screens/components/euCompare/usePeerSelection";

// Diverging-bar domain around the EU=100 baseline (food PLIs span ~70..140).
const DMIN = 60;
const DMAX = 145;
const pos = (v: number) => ((v - DMIN) / (DMAX - DMIN)) * 100;

const PEER_ORDER: PeerGeo[] = ["BG", "RO", "GR", "HU", "HR", "EU27_2020"];

export const ConsumptionEuScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const T = (b: string, e: string) => (bg ? b : e);
  const geoLabel = bg ? GEO_SHORT_BG : GEO_SHORT_EN;
  const foodPli = useFoodPli();

  const bgVals = foodPli?.values.BG ?? {};
  const totalPli = bgVals["A010101"];
  const subgroups = (foodPli?.categories ?? []).filter((c) => !c.agg);
  const centerPos = pos(100);

  const deltaTotal =
    totalPli != null ? Math.round(Math.abs(totalPli - 100)) : null;

  const peerRows = foodPli
    ? PEER_ORDER.filter((g) => foodPli.values[g]?.["A010101"] != null).map(
        (g) => ({ g, v: foodPli.values[g]["A010101"] }),
      )
    : [];

  return (
    <>
      <SEO
        title={T(
          "Храната спрямо ЕС · Потребление",
          "Food vs the EU · Consumption",
        )}
        description={T(
          "Цените на храните в България спрямо средното за ЕС (Евростат, ЕС=100).",
          "Bulgarian food prices vs the EU average (Eurostat, EU=100).",
        )}
      />
      <PlaceHeader active="consumption" level="country" className="my-4" />

      <section aria-label={T("Храната спрямо ЕС", "Food vs the EU")}>
        <DashboardSection
          id="macro"
          title={T("Храната спрямо ЕС", "Food vs the EU")}
          subtitle={T(
            "Индекс на ценовото равнище · ЕС = 100 · Евростат",
            "Price level index · EU = 100 · Eurostat",
          )}
          icon={Landmark}
        >
          {!foodPli ? null : (
            <Card className="flex flex-col gap-5 p-4">
              {/* Headline: food total vs EU */}
              {totalPli != null ? (
                <div className="flex items-end gap-3">
                  <div
                    className={`text-4xl font-bold tabular-nums ${
                      totalPli > 100
                        ? "text-red-600 dark:text-red-400"
                        : "text-green-600 dark:text-green-400"
                    }`}
                  >
                    {Math.round(totalPli)}
                  </div>
                  <div className="pb-1 text-sm text-muted-foreground">
                    {T(
                      `храната у нас е ${deltaTotal}% ${
                        totalPli < 100 ? "по-евтина" : "по-скъпа"
                      } от средното за ЕС (${foodPli.year})`,
                      `food here is ${deltaTotal}% ${
                        totalPli < 100 ? "cheaper" : "dearer"
                      } than the EU average (${foodPli.year})`,
                    )}
                  </div>
                </div>
              ) : null}

              {/* Per-category diverging bars */}
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  {T("По категории (ЕС = 100)", "By category (EU = 100)")}
                </div>
                <div className="flex flex-col gap-1">
                  {subgroups.map((c) => {
                    const v = bgVals[c.code];
                    if (v == null) return null;
                    const dearer = v > 100;
                    const p = pos(v);
                    return (
                      <div
                        key={c.code}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="w-28 shrink-0 truncate sm:w-36">
                          {bg ? c.bg : c.en}
                        </span>
                        <div className="relative h-4 flex-1 rounded bg-muted/40">
                          <div
                            className="absolute inset-y-0 w-px bg-foreground/30"
                            style={{ left: `${centerPos}%` }}
                            aria-hidden
                          />
                          <div
                            className="absolute inset-y-0.5 rounded"
                            style={{
                              left: `${Math.min(p, centerPos)}%`,
                              width: `${Math.abs(p - centerPos)}%`,
                              background: dearer
                                ? "rgb(220 38 38 / 0.7)"
                                : "rgb(22 163 74 / 0.7)",
                            }}
                            aria-hidden
                          />
                        </div>
                        <span
                          className={`w-9 shrink-0 text-right tabular-nums ${
                            dearer
                              ? "text-red-600 dark:text-red-400"
                              : "text-green-600 dark:text-green-400"
                          }`}
                        >
                          {Math.round(v)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Peer comparison (food total) */}
              {peerRows.length > 0 ? (
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {T("Храна общо · съседи", "Food total · neighbours")}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {peerRows.map(({ g, v }) => (
                      <span
                        key={g}
                        className="inline-flex items-center gap-1.5 text-sm"
                      >
                        <Flag geo={g} size={12} title={geoLabel[g]} />
                        <span className="text-muted-foreground">
                          {geoLabel[g]}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {Math.round(v)}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground">
                {T(
                  "Официална статистика на Евростат (програма PPP), ЕС = 100. Отчита ДДС и различията в качеството. Не отразява разликите в доходите.",
                  "Official Eurostat statistics (PPP programme), EU = 100. VAT- and quality-adjusted. Does not reflect income differences.",
                )}{" "}
                <a
                  href={foodPli.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {foodPli.source}
                </a>
              </p>
            </Card>
          )}
        </DashboardSection>
      </section>
    </>
  );
};
