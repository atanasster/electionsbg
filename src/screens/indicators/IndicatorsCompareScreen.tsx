// /indicators/compare — standalone peer explorer. Renders the eight
// peer-eligible indicators side-by-side against BG, with a country chip row
// the user can use to drop/add the four CEE peers. EU27 is always shown as
// the headline reference. State persists via the `?peers=` URL param so the
// view is shareable.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Title } from "@/ux/Title";
import { useMacroPeers, type PeerGeo } from "@/data/macro/useMacroPeers";
import { PeerSnapshotTable } from "@/screens/components/macro/PeerSnapshotTable";
import { cn } from "@/lib/utils";
import { IndicatorsNav } from "./indicatorsNav";

const TOGGLEABLE_PEERS: Exclude<PeerGeo, "BG" | "EU27_2020">[] = [
  "RO",
  "GR",
  "HU",
  "HR",
];

const PEER_LABELS_EN: Record<Exclude<PeerGeo, "BG" | "EU27_2020">, string> = {
  RO: "Romania",
  GR: "Greece",
  HU: "Hungary",
  HR: "Croatia",
};

const PEER_LABELS_BG: Record<Exclude<PeerGeo, "BG" | "EU27_2020">, string> = {
  RO: "Румъния",
  GR: "Гърция",
  HU: "Унгария",
  HR: "Хърватия",
};

const PARAM_NAME = "peers";

const parsePeerParam = (
  raw: string | null,
): Exclude<PeerGeo, "BG" | "EU27_2020">[] => {
  if (raw === null) return [...TOGGLEABLE_PEERS]; // default: all on
  if (raw === "") return [];
  const requested = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is Exclude<PeerGeo, "BG" | "EU27_2020"> =>
      (TOGGLEABLE_PEERS as readonly string[]).includes(s),
    );
  // Preserve canonical ordering regardless of URL order.
  return TOGGLEABLE_PEERS.filter((p) => requested.includes(p));
};

export const IndicatorsCompareScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: peers } = useMacroPeers();
  const [params, setParams] = useSearchParams();

  const selected = useMemo(
    () => parsePeerParam(params.get(PARAM_NAME)),
    [params],
  );

  const togglePeer = (p: Exclude<PeerGeo, "BG" | "EU27_2020">) => {
    const next = new URLSearchParams(params);
    const updated = selected.includes(p)
      ? selected.filter((x) => x !== p)
      : [...selected, p];
    // Default state (all four on) → drop the param so the URL stays clean.
    if (
      updated.length === TOGGLEABLE_PEERS.length &&
      TOGGLEABLE_PEERS.every((x) => updated.includes(x))
    ) {
      next.delete(PARAM_NAME);
    } else {
      next.set(
        PARAM_NAME,
        TOGGLEABLE_PEERS.filter((x) => updated.includes(x)).join(","),
      );
    }
    setParams(next, { replace: true });
  };

  // Render every indicator the peers payload knows about — these are the
  // ones with a precomputed EU27 distribution, so the rank column is always
  // populated.
  const indicatorKeys = useMemo(
    () => (peers?.indicators ? Object.keys(peers.indicators) : []),
    [peers],
  );

  const labels = lang === "bg" ? PEER_LABELS_BG : PEER_LABELS_EN;

  const geos: PeerGeo[] = ["BG", "EU27_2020", ...selected];

  return (
    <div className="pb-12">
      <Title description={t("indicators_compare_description")}>
        {t("indicators_compare_title")}
      </Title>

      <IndicatorsNav />

      <section className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("indicators_compare_peers_label")}
          </span>
          <span className="inline-flex items-center px-2 py-1 rounded-full bg-muted/40 text-[11px] text-foreground">
            {lang === "bg" ? "ЕС-27 (винаги)" : "EU27 (always on)"}
          </span>
          {TOGGLEABLE_PEERS.map((p) => {
            const active = selected.includes(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => togglePeer(p)}
                className={cn(
                  "inline-flex items-center px-2.5 py-1 rounded-full border text-[11px] transition-colors",
                  active
                    ? "bg-foreground text-background border-transparent"
                    : "bg-background text-muted-foreground border-border hover:bg-accent/10",
                )}
              >
                {labels[p]}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mb-8" data-og="indicators-compare-table">
        <h2 className="text-lg font-semibold mb-3">
          {t("indicators_compare_table_heading")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("indicators_compare_table_explainer")}
        </p>
        {indicatorKeys.length > 0 ? (
          <PeerSnapshotTable
            rows={indicatorKeys.map((k) => ({ indicatorKey: k }))}
            geos={geos}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("gov_macro_unavailable")}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          {t("indicators_compare_table_footnote")}
        </p>
      </section>
    </div>
  );
};
