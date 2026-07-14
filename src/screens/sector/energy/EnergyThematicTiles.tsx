// Signature energy tiles for the /sector/energy dashboard — the substance the
// generic KPI row + spend-by-year/top-contractors can't express. All render off
// the SAME awarder_group_model fetch the dashboard already makes (react-query
// dedupes on the shared ENERGY_MEMBER_EIKS key), so no extra network cost.
//
//  1. Invisible-€14bn call-out — Козлодуй 7/8 (AP1000), the largest energy
//     investment in the country's history, is procured OUTSIDE ЦАИС → €0 in the
//     corpus. The pack's thesis, stated in one tile.
//  2. Single-bid gauge — group weak-competition share, gated on bid coverage.
//  3. Per-unit spend — where the €9.76bn group actually spends, by subsidiary,
//     coloured by energy universe (nuclear / coal / grid / gas / hydro).
//
// CSS/flex bars only (no chart lib) — same house rule as SectorCharts, so they
// render instantly for the OG screenshot.

import { FC, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  buildAwarderModelFromAggregates,
  type AwarderModel,
  type GroupModelPayload,
  type SectorClassifier,
} from "@/lib/awarderModel";
import {
  useAwarderGroupModel,
  type GroupUnitAgg,
} from "@/data/procurement/useAwarderGroupModel";
import {
  ENERGY_MEMBER_EIKS,
  entityByEik,
  universeOf,
  type EnergyUniverse,
} from "@/lib/energyReferenceData";
import { EnergyGenerationTile } from "./EnergyGenerationTile";
import { EnergyPriceTile } from "./EnergyPriceTile";

// The generic dashboard needs headline money/competition, not a CPV taxonomy —
// same one-bucket classifier as SectorDashboardScreen (keeps the fetch shared).
const GENERIC_CLASSIFIER: SectorClassifier<"all"> = { categoryOf: () => "all" };

// Fixed colour per energy universe — mid-lightness so each reads on both the
// cream and navy grounds (mirrors tileAccents). Never repaint by rank.
const UNIVERSE_COLOR: Record<EnergyUniverse, string> = {
  holding: "#7f85a3",
  nuclear: "#b07d2f",
  coal: "#6b5544",
  hydro: "#3f6a8a",
  grid: "#2f8fb0",
  gas: "#c9702f",
  ministry: "#8a8f98",
  regulator: "#8a8f98",
};

// ── 1. Invisible €14bn ──────────────────────────────────────────────────────
const InvisibleCapexTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  return (
    <Card className="md:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4 text-amber-500" aria-hidden />
          {bg
            ? "Най-голямата инвестиция — извън търговете"
            : "The biggest investment — outside the tenders"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="text-2xl font-bold tabular-nums text-muted-foreground">
              €0
            </div>
            <div className="text-xs text-muted-foreground">
              {bg ? "в търговете (ЦАИС)" : "in the tender corpus (ЦАИС)"}
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums">~€14 млрд</div>
            <div className="text-xs text-muted-foreground">
              {bg
                ? "планирана инвестиция — АЕЦ Козлодуй 7 и 8"
                : "planned investment — Kozloduy NPP units 7 & 8"}
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {bg
            ? "Новите ядрени мощности (AP1000) — най-голямата енергийна инвестиция в историята на страната — се възлагат по междуправителствени и специални процедури извън ЦАИС. Колкото повече държавата строи така, толкова по-малко се вижда в поръчките."
            : "The new nuclear units (AP1000) — the largest energy investment in the country's history — are procured through intergovernmental and bespoke channels outside ЦАИС. The more the state builds this way, the less is visible in procurement."}
        </p>
      </CardContent>
    </Card>
  );
};

// ── 2. Single-bid gauge ─────────────────────────────────────────────────────
const SingleBidTile: FC<{ model: AwarderModel<"all"> }> = ({ model }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const share = model.singleBidShare;
  if (share == null || model.bidKnownN === 0) return null;

  const pct = Math.round(share * 100);
  const color = share < 0.35 ? "#3a7a5e" : share < 0.6 ? "#b07d2f" : "#c14b57";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Единствен участник" : "Single-bid contracts"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="flex items-baseline gap-2">
          <div className="text-3xl font-bold tabular-nums" style={{ color }}>
            {pct}%
          </div>
          <div className="text-xs text-muted-foreground">
            {bg
              ? "от договорите с данни са с един участник"
              : "of bid-known contracts had one bidder"}
          </div>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted/50">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(2, pct)}%`, backgroundColor: color }}
          />
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {bg
            ? `${model.singleBidN.toLocaleString(locale)} от ${model.bidKnownN.toLocaleString(locale)} договора с известен брой оферти`
            : `${model.singleBidN.toLocaleString(locale)} of ${model.bidKnownN.toLocaleString(locale)} contracts with a known bid count`}
        </div>
      </CardContent>
    </Card>
  );
};

// ── 3. Per-unit spend ───────────────────────────────────────────────────────
const PerUnitSpendTile: FC<{ byUnit: GroupUnitAgg[] }> = ({ byUnit }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const rows = byUnit
    .filter((u) => (u.totalEur ?? 0) > 0)
    .sort((a, b) => b.totalEur - a.totalEur);
  if (rows.length < 2) return null;
  const max = rows[0].totalEur || 1;

  return (
    <Card className="md:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Разходи по дружество" : "Spend by company"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 p-3 md:p-4">
        {rows.map((u) => {
          const ent = entityByEik(u.eik);
          const uni = universeOf(u.eik);
          const color = uni ? UNIVERSE_COLOR[uni] : "#8a8f98";
          const name = ent?.name ?? u.eik;
          return (
            <div key={u.eik} className="flex items-center gap-2 text-sm">
              <Link
                to={`/awarder/${u.eik}`}
                className="w-[42%] min-w-0 truncate text-primary hover:underline"
                title={name}
              >
                {name}
              </Link>
              <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{
                    width: `${Math.max(3, (u.totalEur / max) * 100)}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              <div className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatEurCompact(u.totalEur, locale)}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export const EnergyThematicTiles: FC = () => {
  const build = useCallback(
    (p: GroupModelPayload) =>
      buildAwarderModelFromAggregates(p, GENERIC_CLASSIFIER),
    [],
  );
  // Shares the dashboard's fetch (same eiks + default window → same query key).
  const { model, byUnit } = useAwarderGroupModel(
    ENERGY_MEMBER_EIKS,
    build,
    undefined,
    true,
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <EnergyGenerationTile />
      <PerUnitSpendTile byUnit={byUnit} />
      <InvisibleCapexTile />
      {/* the two thin tiles pair on one row */}
      <EnergyPriceTile />
      {model && <SingleBidTile model={model} />}
    </div>
  );
};
