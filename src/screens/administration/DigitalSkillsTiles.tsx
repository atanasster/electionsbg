// Citizen digital-skills band for /sector/administration — the demand-side
// companion to the e-government tile. Same house idiom as AdministrationScreen:
// Card + CSS/flex bars + footnote, no chart lib, except the youth tile which
// uses the reusable EuChoroplethMap. Data: Eurostat isoc_sk_dskl_i21 via
// useAdminDigitalSkills.

import { FC } from "react";
import { Laptop, LayoutGrid, Users2, GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { PackSection } from "@/screens/components/procurement/PackSection";
import { EuChoroplethMap } from "@/screens/components/maps/EuChoroplethMap";
import { euGeoName, EU27_GEOS } from "@/screens/components/maps/euGeoNames";
import { Flag } from "@/screens/components/euCompare/Flag";
import type { PeerGeo } from "@/data/macro/useMacroPeers";
import {
  type DigitalSkillsPayload,
  type DigitalSkillsArea,
  type EuRank,
} from "@/data/administration/useAdminDigitalSkills";

// The shared Flag set keys Greece as GR; Eurostat payloads use EL.
const flagGeo = (g: string): PeerGeo => (g === "EL" ? "GR" : g) as PeerGeo;

const pct = (v: number | null | undefined) =>
  v != null ? `${v.toFixed(1)}%` : "н.д.";

// "26-а от 27" / "26th of 27", or "последна в ЕС" / "last in the EU" when last.
const rankPhrase = (r: EuRank | null | undefined, bg: boolean): string => {
  if (!r) return "";
  if (r.isLast) return bg ? "последна в ЕС" : "last in the EU";
  return bg
    ? `${r.rank}-а от ${r.total} в ЕС`
    : `${r.rank}th of ${r.total} in the EU`;
};

// ── Tile 1: at-least-basic digital skills, BG vs EU peers ────────────────────
const AtLeastBasicTile: FC<{ d: DigitalSkillsPayload; bg: boolean }> = ({
  d,
  bg,
}) => {
  const year = d.latestYear;
  const rows = Object.entries(d.atLeastBasic)
    .map(([geo, pts]) => ({
      geo,
      value: pts.find((p) => p.year === year)?.value ?? null,
    }))
    .filter((r): r is { geo: string; value: number } => r.value != null)
    .sort((a, b) => b.value - a.value);
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const trend = d.atLeastBasic.BG ?? [];
  const first = trend[0];
  const last = trend[trend.length - 1];
  const rankLabel = rankPhrase(d.rank, bg);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Laptop className="h-4 w-4 text-violet-600" aria-hidden />
          {bg
            ? `Поне базови дигитални умения · ${year}`
            : `At least basic digital skills · ${year}`}
        </CardTitle>
      </CardHeader>
      {/* Bars are scaled relative to the peer maximum (ranking emphasis), not a
          fixed 0–100 axis like AreasTile below. */}
      <CardContent className="space-y-1.5">
        {rows.map((r) => {
          const isBg = r.geo === "BG";
          const isEu = r.geo === "EU27_2020";
          return (
            <div key={r.geo} className="flex items-center gap-2 text-xs">
              <span
                className={
                  "w-20 shrink-0 truncate " +
                  (isBg
                    ? "font-semibold"
                    : isEu
                      ? "font-medium"
                      : "text-muted-foreground")
                }
              >
                {euGeoName(r.geo, bg)}
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-muted/40">
                <div
                  className="h-full"
                  style={{
                    width: `${(r.value / max) * 100}%`,
                    background: isBg ? "#6d28d9" : isEu ? "#94739e" : "#9aa0a6",
                  }}
                />
              </div>
              <span className="w-12 shrink-0 text-right tabular-nums">
                {r.value.toFixed(1)}%
              </span>
            </div>
          );
        })}
        <p className="pt-1 text-xs text-muted-foreground">
          {bg
            ? `Дял на хората (16-74 г.) с поне базови умения по петте области на DigComp.${rankLabel ? ` България е ${rankLabel}` : ""}${first && last ? `; ръст ${first.value.toFixed(0)}%→${last.value.toFixed(0)}% (${first.year}–${last.year})` : ""}. Цел на ЕС за 2030: 80%. Източник: Eurostat isoc_sk_dskl_i21.`
            : `Share of people (aged 16-74) with at least basic skills across the five DigComp areas.${rankLabel ? ` Bulgaria ranks ${rankLabel}` : ""}${first && last ? `; up ${first.value.toFixed(0)}%→${last.value.toFixed(0)}% (${first.year}–${last.year})` : ""}. EU 2030 target: 80%. Source: Eurostat isoc_sk_dskl_i21.`}
        </p>
      </CardContent>
    </Card>
  );
};

// ── Tile 2: the five competence areas, BG bar + EU-average marker ────────────
const AreasTile: FC<{ areas: DigitalSkillsArea[]; bg: boolean }> = ({
  areas,
  bg,
}) => {
  const rows = areas.filter((a) => a.bgValue != null);
  if (!rows.length) return null;
  // Name the two widest BG↔EU gaps rather than asserting them (same derivation
  // the AI digitalSkills tool uses), so the footnote can't desync on refresh.
  const widest = rows
    .filter((a) => a.euValue != null)
    .map((a) => ({ a, gap: (a.euValue as number) - (a.bgValue as number) }))
    .sort((x, y) => y.gap - x.gap)
    .slice(0, 2)
    .map((x) => (bg ? x.a.labelBg : x.a.labelEn).toLowerCase());
  const widestPhrase =
    widest.length === 2
      ? bg
        ? `${widest[0]} и ${widest[1]}`
        : `${widest[0]} and ${widest[1]}`
      : (widest[0] ?? "");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutGrid className="h-4 w-4 text-sky-600" aria-hidden />
          {bg ? "По области на уменията" : "By skill area"}
        </CardTitle>
      </CardHeader>
      {/* Bars use an absolute 0–100 axis (level), unlike AtLeastBasicTile which
          scales to the peer maximum. */}
      <CardContent className="space-y-2">
        {rows.map((a) => (
          <div key={a.code} className="text-xs">
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
              <span className="truncate text-muted-foreground">
                {bg ? a.labelBg : a.labelEn}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{pct(a.bgValue)}</span>
                {a.euValue != null && (
                  <span className="ml-1 text-muted-foreground">
                    {bg ? "ЕС" : "EU"} {a.euValue.toFixed(0)}%
                  </span>
                )}
              </span>
            </div>
            <div className="relative h-3 overflow-hidden rounded bg-muted/40">
              <div
                className="h-full"
                style={{ width: `${a.bgValue}%`, background: "#0284c7" }}
              />
              {a.euValue != null && (
                <span
                  className="absolute top-0 h-full w-[2px] bg-foreground/70"
                  style={{ left: `${a.euValue}%` }}
                  title={`${bg ? "ЕС средно" : "EU average"} ${a.euValue.toFixed(1)}%`}
                />
              )}
            </div>
          </div>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          {bg
            ? `Синьото е България, чертата е средното за ЕС.${widestPhrase ? ` Изоставането е най-голямо при ${widestPhrase}.` : ""}`
            : `The blue bar is Bulgaria, the tick is the EU average.${widestPhrase ? ` The gap is widest on ${widestPhrase}.` : ""}`}
        </p>
      </CardContent>
    </Card>
  );
};

// ── Tile 3: skills composition over the survey waves ─────────────────────────
const COMP_SEGMENTS = [
  {
    key: "atLeastBasic",
    bg: "Поне базови",
    en: "At least basic",
    color: "#6d28d9",
  },
  { key: "below", bg: "Под базови", en: "Below basic", color: "#a5b4fc" },
  { key: "noSkills", bg: "Без умения", en: "No skills", color: "#cbd5e1" },
  {
    key: "notAssessed",
    bg: "Не ползва интернет",
    en: "Non-internet-user",
    color: "#f59e0b",
  },
] as const;

const CompositionTile: FC<{
  comp: DigitalSkillsPayload["composition"];
  bg: boolean;
}> = ({ comp, bg }) => {
  const rows = comp
    .filter((c) => c.atLeastBasic != null)
    .sort((a, b) => a.year - b.year)
    .map((c) => {
      const ab = c.atLeastBasic ?? 0;
      const ns = c.noSkills ?? 0;
      const na = c.notAssessed ?? 0;
      // Explicit below-basic sum from the payload; fall back to the residual
      // only if an older payload lacks it.
      const below = c.below ?? Math.max(0, 100 - ab - ns - na);
      return {
        year: c.year,
        atLeastBasic: ab,
        below,
        noSkills: ns,
        notAssessed: na,
      };
    });
  if (!rows.length) return null;
  const naFirst = rows[0].notAssessed;
  const naLast = rows[rows.length - 1].notAssessed;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users2 className="h-4 w-4 text-emerald-600" aria-hidden />
          {bg ? "Състав по вълни" : "Composition by wave"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.year} className="flex items-center gap-2 text-xs">
            <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
              {r.year}
            </span>
            <div className="flex h-4 flex-1 overflow-hidden rounded bg-muted/40">
              {COMP_SEGMENTS.map((s) => {
                const w = r[s.key];
                return w > 0 ? (
                  <div
                    key={s.key}
                    style={{ width: `${w}%`, background: s.color }}
                    title={`${bg ? s.bg : s.en}: ${w.toFixed(1)}%`}
                  />
                ) : null;
              })}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
          {COMP_SEGMENTS.map((s) => (
            <span key={s.key}>
              <span
                className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
                style={{ background: s.color }}
              />
              {bg ? s.bg : s.en}
            </span>
          ))}
        </div>
        <p className="pt-1 text-xs text-muted-foreground">
          {bg
            ? `Групата, която не ползва интернет (и не може да бъде оценена), намалява бързо — от ${naFirst.toFixed(1)}% на ${naLast.toFixed(1)}% — но напредъкът тръгва от много ниска база.`
            : `The group that doesn't use the internet (and can't be assessed) is shrinking fast — ${naFirst.toFixed(1)}% to ${naLast.toFixed(1)}% — but progress starts from a very low base.`}
        </p>
      </CardContent>
    </Card>
  );
};

// ── Tile 4: young people (16-24), the EU map ─────────────────────────────────
const YouthMapTile: FC<{ d: DigitalSkillsPayload; bg: boolean }> = ({
  d,
  bg,
}) => {
  const y = d.youth;
  const bgV = y.byGeo.BG;
  const euV = y.byGeo.EU27_2020;
  const rankLabel = rankPhrase(y.rank, bg);
  // Peer countries (the standard set, EU average shown separately) with their
  // youth values, so the map's colours get exact numbers beside them.
  const peerRows = d.peers
    .filter((g) => g !== "EU27_2020")
    .map((g) => ({ geo: g, value: y.byGeo[g] as number | undefined }))
    .filter((r): r is { geo: string; value: number } => r.value != null)
    .sort((a, b) => b.value - a.value);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <GraduationCap className="h-4 w-4 text-rose-600" aria-hidden />
          {bg
            ? `Младежи (16-24 г.) с поне базови умения · ${y.latestYear}`
            : `Young people (16-24) with at least basic skills · ${y.latestYear}`}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2">
          <EuChoroplethMap
            valuesByGeo={y.byGeo}
            bg={bg}
            scaleGeos={EU27_GEOS}
            title={
              bg
                ? "Поне базови умения, 16-24 г."
                : "At least basic skills, 16-24"
            }
            unit={bg ? "% от 16-24 г." : "% of 16-24"}
            year={y.latestYear}
          />
          <div className="flex flex-col justify-center gap-3">
            <div>
              <div className="text-3xl font-bold tabular-nums text-rose-600">
                {pct(bgV)}
              </div>
              <div className="text-sm text-muted-foreground">
                {bg
                  ? `България${rankLabel ? ` — ${rankLabel}` : ""} (ЕС средно ${pct(euV)})`
                  : `Bulgaria${rankLabel ? ` — ${rankLabel}` : ""} (EU average ${pct(euV)})`}
              </div>
            </div>
            {y.bg.male != null && y.bg.female != null && (
              <div className="text-sm">
                <span className="text-muted-foreground">
                  {bg ? "Обратна разлика по пол: " : "Reverse gender gap: "}
                </span>
                <span className="font-medium">
                  {bg ? "жени" : "women"} {y.bg.female.toFixed(1)}%
                </span>
                {" · "}
                <span className="font-medium">
                  {bg ? "мъже" : "men"} {y.bg.male.toFixed(1)}%
                </span>
              </div>
            )}
            {peerRows.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  {bg ? "Съседи в ЕС · 16-24 г." : "EU peers · 16-24"}
                </div>
                <div className="space-y-0.5">
                  {peerRows.map((r) => {
                    const isBg = r.geo === "BG";
                    return (
                      <div
                        key={r.geo}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span
                          className={
                            "flex items-center gap-1.5 " +
                            (isBg ? "font-semibold" : "text-muted-foreground")
                          }
                        >
                          <Flag
                            geo={flagGeo(r.geo)}
                            size={12}
                            title={euGeoName(r.geo, bg)}
                          />
                          {euGeoName(r.geo, bg)}
                        </span>
                        <span
                          className={
                            "tabular-nums " + (isBg ? "font-semibold" : "")
                          }
                        >
                          {r.value.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export const DigitalSkillsSection: FC<{
  data: DigitalSkillsPayload | undefined;
  bg: boolean;
}> = ({ data, bg }) => {
  if (!data) return null;
  return (
    <PackSection
      icon={Laptop}
      title={bg ? "Дигитални умения на гражданите" : "Citizen digital skills"}
      sub={
        bg
          ? "Способността на населението да ползва дигитални услуги — търсенето, което електронното управление предполага. България е сред последните в ЕС."
          : "The population's ability to use digital services — the demand e-government assumes. Bulgaria is among the last in the EU."
      }
      id="admin-digital-skills"
    >
      <div className="grid items-start gap-3 md:grid-cols-2">
        <AtLeastBasicTile d={data} bg={bg} />
        <AreasTile areas={data.areas} bg={bg} />
        <CompositionTile comp={data.composition} bg={bg} />
      </div>
      <div className="mt-3">
        <YouthMapTile d={data} bg={bg} />
      </div>
    </PackSection>
  );
};
