// /my-area — landing page when the user clicks the sniper icon header link
// directly (rather than searching from the popover). The primary entry
// surface is still the global sniper icon in the header; this page is the
// canonical deep-link destination and shows up in the sitemap.
//
// Two affordances mirror the sniper popover:
//   - Settlement / município autocomplete (filtered to types s + m)
//   - "Use my location" sniper button
//
// When the user is already anchored (has `?area=` set) the page redirects
// them straight to /my-area/:id so they don't see the entry form twice.

import { FC, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Command as CommandPrimitive } from "cmdk";
import { Crosshair, Loader2, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CommandInput, CommandList } from "@/components/ui/command";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { useAreaAnchor, useSetAreaAnchor } from "@/data/area/areaAnchor";
import { useNearestSettlement } from "@/data/area/useNearestSettlement";
import { useSearchItems } from "@/data/search/useSearchItems";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import type { SettlementInfo } from "@/data/dataTypes";
import { AmbiguitySettlementChooser } from "@/layout/header/AmbiguitySettlementChooser";

const AREA_TYPES = new Set(["s", "m"]);
const RESULT_CAP = 12;

type GeoState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "blocked" }
  | { kind: "timeout" }
  | { kind: "no-match" };

export const MyAreaEntryScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const navigate = useNavigate();
  const anchor = useAreaAnchor();
  const setAnchor = useSetAreaAnchor();
  const { search } = useSearchItems();
  const nearest = useNearestSettlement();
  const { findSettlement } = useSettlementsInfo();

  const [query, setQuery] = useState("");
  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });
  const [ambiguous, setAmbiguous] = useState<{
    candidates: Array<{ settlement: SettlementInfo; distanceKm: number }>;
  } | null>(null);

  // Auto-redirect users who already have an anchor set. Skips when ambiguity
  // chooser is open so the post-pick navigation isn't pre-empted.
  useEffect(() => {
    if (anchor?.id && !ambiguous) {
      navigate(`/governance/${anchor.id}`, { replace: true });
    }
  }, [anchor, navigate, ambiguous]);

  const goTo = useCallback(
    (id: string) => {
      setAnchor(id);
      navigate(`/governance/${id}`);
    },
    [setAnchor, navigate],
  );

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeo({ kind: "blocked" });
      return;
    }
    setGeo({ kind: "loading" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const result = nearest(pos.coords.latitude, pos.coords.longitude);
        if (result.kind === "single") {
          setGeo({ kind: "idle" });
          goTo(result.settlement.ekatte);
        } else if (result.kind === "ambiguous") {
          setGeo({ kind: "idle" });
          setAmbiguous({ candidates: result.candidates });
        } else {
          setGeo({ kind: "no-match" });
        }
      },
      (err) => {
        // Mirror the granular handling in AreaSniperButton — see comments
        // there for why we split blocked/timeout out of the old "unavailable"
        // bucket. POSITION_UNAVAILABLE on macOS Chrome is almost always
        // the OS-level Location Services switch being off for the browser.
        if (err.code === err.PERMISSION_DENIED) {
          setGeo({ kind: "denied" });
        } else if (err.code === err.TIMEOUT) {
          setGeo({ kind: "timeout" });
        } else {
          setGeo({ kind: "blocked" });
        }
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }, [nearest, goTo]);

  const results = query.trim().length > 0 ? (search(query) ?? []) : [];
  // Same filter as the AreaSniperButton popover — exclude diaspora-bucket
  // pseudo-settlements (МИР 32 / oblast === "32"); see useNearestSettlement
  // for the matching geo-sweep filter.
  const filtered = results
    .filter((r) => {
      if (!AREA_TYPES.has(r.item.type)) return false;
      if (r.item.type === "s") {
        const s = findSettlement(r.item.key);
        if (s?.oblast === "32") return false;
      }
      return true;
    })
    .slice(0, RESULT_CAP);

  return (
    <>
      <SEO
        title={t("my_area_dashboard")}
        description={t("my_area_entry_description")}
      />
      <section className="my-6 max-w-2xl mx-auto px-2">
        <H1>{t("my_area_dashboard")}</H1>
        <p className="text-sm text-muted-foreground mt-2 mb-6">
          {t("my_area_entry_description")}
        </p>

        <Card className="p-4 md:p-6">
          <CommandPrimitive shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t("my_area_search_placeholder")}
              autoFocus
            />
            <CommandList className="max-h-[360px] mt-2">
              {filtered.length === 0 && query.length > 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  {t("no_results")}
                </div>
              ) : (
                <div className="py-1">
                  {filtered.map((r) => {
                    const name =
                      lang === "bg"
                        ? r.item.name
                        : (r.item.name_en ?? r.item.name);
                    const parent =
                      lang === "bg" ? r.item.parentName : r.item.parentName_en;
                    return (
                      <button
                        key={`${r.item.type}-${r.item.key}`}
                        type="button"
                        onClick={() => goTo(r.item.key)}
                        className="w-full text-left px-3 py-2 hover:bg-accent/40 focus:bg-accent/60 focus:outline-none rounded-md"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-block text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                            {r.item.type === "s"
                              ? t("settlement_short")
                              : t("municipality_short")}
                          </span>
                          <span className="truncate font-medium text-sm">
                            {name}
                          </span>
                        </div>
                        {parent ? (
                          <div className="text-[11px] text-muted-foreground truncate ml-9">
                            {parent}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </CommandList>
          </CommandPrimitive>

          <div className="mt-4 pt-4 border-t flex flex-col gap-2">
            <Button
              variant="outline"
              size="default"
              className="w-full justify-start"
              onClick={requestLocation}
              disabled={geo.kind === "loading"}
            >
              {geo.kind === "loading" ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Crosshair className="size-4 mr-2" />
              )}
              {t("my_area_use_location")}
            </Button>
            {geo.kind === "denied" ? (
              <div className="text-xs text-muted-foreground">
                {t("my_area_location_denied")}
              </div>
            ) : null}
            {geo.kind === "blocked" ? (
              <div className="text-xs text-muted-foreground flex flex-col gap-1">
                <span>{t("my_area_location_blocked")}</span>
                <span className="text-[11px]">
                  {t("my_area_location_blocked_hint")}
                </span>
              </div>
            ) : null}
            {geo.kind === "timeout" ? (
              <div className="text-xs text-muted-foreground">
                {t("my_area_location_timeout")}
              </div>
            ) : null}
            {geo.kind === "no-match" ? (
              <div className="text-xs text-muted-foreground">
                {t("my_area_location_no_match")}
              </div>
            ) : null}
          </div>
        </Card>

        <div className="mt-6 text-xs text-muted-foreground flex items-start gap-2">
          <MapPin className="size-3.5 mt-0.5 shrink-0" />
          <p>{t("my_area_entry_help")}</p>
        </div>
      </section>

      {ambiguous ? (
        <AmbiguitySettlementChooser
          candidates={ambiguous.candidates}
          onPick={(ekatte) => {
            setAmbiguous(null);
            goTo(ekatte);
          }}
          onClose={() => setAmbiguous(null)}
        />
      ) : null}
    </>
  );
};
