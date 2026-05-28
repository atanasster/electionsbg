// Global "My Area" sniper-icon entry — a crosshair button that lives in the
// header on every page. Clicking it opens a popover with:
//   - Settlement / município autocomplete (filtered Fuse index)
//   - "Use my location" button (browser geolocation → useNearestSettlement
//     → either auto-pick a settlement within 1.5 km, or render an
//     ambiguity chooser)
//
// When an area is already chosen (?area=<id> set) the popover instead shows
// "Моят район: {name}" + a "change" link + a "clear" link. The persistent
// chip rendered by AreaPill sits right next to the icon so the area context
// is always visible — both belong to the same global header group.

import { FC, useCallback, useState } from "react";
import { Crosshair, Loader2, MapPin, X } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CommandInput, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSearchItems } from "@/data/search/useSearchItems";
import { useNearestSettlement } from "@/data/area/useNearestSettlement";
import { useAreaAnchor, useSetAreaAnchor } from "@/data/area/areaAnchor";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import type { SettlementInfo } from "@/data/dataTypes";
import { AmbiguitySettlementChooser } from "./AmbiguitySettlementChooser";

/** Subset of search-index types that map to My-Area destinations. */
const AREA_TYPES = new Set(["s", "m"]);

/** Cap for the autocomplete list — settlement names are short and the user
 *  is looking for a specific place, so a small list is right. */
const RESULT_CAP = 8;

type GeoState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "no-match" };

export const AreaSniperButton: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const navigate = useNavigate();
  const anchor = useAreaAnchor();
  const setAnchor = useSetAreaAnchor();
  const { search } = useSearchItems();
  const nearest = useNearestSettlement();
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });
  const [ambiguous, setAmbiguous] = useState<{
    candidates: Array<{ settlement: SettlementInfo; distanceKm: number }>;
  } | null>(null);

  const goTo = useCallback(
    (id: string) => {
      setAnchor(id);
      // Stay on the user's current page; the persistent pill now shows their
      // chosen area. A separate "open dashboard" link in the popover offers
      // the explicit navigation. (Behaviour decision: choosing an area is a
      // context act, not a navigation act.)
      navigate(`/my-area/${id}`);
      setOpen(false);
      setQuery("");
    },
    [setAnchor, navigate],
  );

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeo({ kind: "unavailable" });
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
        setGeo(
          err.code === err.PERMISSION_DENIED
            ? { kind: "denied" }
            : { kind: "unavailable" },
        );
      },
      // 10 s is enough for a cold GPS fix and matches the default browser
      // hint timeout. We don't need high-accuracy — settlement-grain works
      // fine with a wifi-positioning fix.
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }, [nearest, goTo]);

  const results = query.trim().length > 0 ? (search(query) ?? []) : [];
  const filtered = results
    .filter((r) => AREA_TYPES.has(r.item.type))
    .slice(0, RESULT_CAP);

  // Resolve the active anchor name for the "Моят район" display.
  let currentName: string | null = null;
  if (anchor) {
    if (/^\d+$/.test(anchor.id)) {
      const s = findSettlement(anchor.id);
      if (s) currentName = lang === "bg" ? s.name : s.name_en;
    } else {
      const m = findMunicipality(anchor.id);
      if (m) currentName = lang === "bg" ? m.name : m.name_en;
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            role="button"
            aria-label={t("area_sniper_aria")}
            className={cn(
              "text-secondary-foreground w-[28px] relative",
              anchor && "text-primary",
            )}
          >
            <Crosshair className="size-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          // 320 px so the popover content remains readable on iPhone SE.
          className="w-[320px] p-0"
        >
          {anchor ? (
            <div className="p-3 flex flex-col gap-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                {t("my_area_label")}
              </div>
              <div className="font-semibold text-sm flex items-center gap-2 min-w-0">
                <MapPin className="size-4 shrink-0 text-primary" />
                <span className="truncate">{currentName ?? anchor.id}</span>
              </div>
              <div className="flex gap-2 mt-1">
                <Button
                  variant="default"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    navigate(`/my-area/${anchor.id}`);
                    setOpen(false);
                  }}
                >
                  {t("my_area_open_dashboard")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAnchor(null);
                    setOpen(false);
                  }}
                  aria-label={t("my_area_clear")}
                >
                  <X className="size-3" />
                </Button>
              </div>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline self-start mt-1"
                onClick={() => setAnchor(null)}
              >
                {t("my_area_change")}
              </button>
            </div>
          ) : (
            <CommandPrimitive shouldFilter={false}>
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder={t("my_area_search_placeholder")}
                autoFocus
              />
              <CommandList className="max-h-[280px]">
                {filtered.length === 0 && query.length > 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
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
                        lang === "bg"
                          ? r.item.parentName
                          : r.item.parentName_en;
                      return (
                        <button
                          key={`${r.item.type}-${r.item.key}`}
                          type="button"
                          onClick={() => goTo(r.item.key)}
                          className="w-full text-left px-3 py-2 hover:bg-accent/40 focus:bg-accent/60 focus:outline-none"
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
              <div className="border-t p-2 flex flex-col gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
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
                  <div className="text-[11px] text-muted-foreground px-1">
                    {t("my_area_location_denied")}
                  </div>
                ) : null}
                {geo.kind === "unavailable" ? (
                  <div className="text-[11px] text-muted-foreground px-1">
                    {t("my_area_location_unavailable")}
                  </div>
                ) : null}
                {geo.kind === "no-match" ? (
                  <div className="text-[11px] text-muted-foreground px-1">
                    {t("my_area_location_no_match")}
                  </div>
                ) : null}
              </div>
            </CommandPrimitive>
          )}
        </PopoverContent>
      </Popover>
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
