// "Концентрация на изпълнителите (HHI)" — how concentrated the water sector's ЗОП
// spend is among contractors, using the Herfindahl-Hirschman Index with the DOJ
// bands (competitive <1500, moderate ≤2500, high >2500). Computed client-side
// from the aggregated model's suppliers (no new query), reusing the shared HHI
// banding helpers. Mirrors mon/TextbookConcentrationTile (docs/plans/
// water-view-v1.md §4.6b).
//
// Serves BOTH universes — the holding group on /awarder/206086428 and the whole
// sector on /water — and unlike VikSubsidiaryTile it is handed suppliers rather
// than operators, so it cannot tell which. Its copy is therefore universe-NEUTRAL
// by design: it names "the contracted value", never "the group's". Both languages
// — the EN string kept saying "the group's" for one commit after the BG one was
// fixed, which is how a caption asserts holding membership over a Veolia
// concession in one language only.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PieChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  hhiBandLabel,
  HHI_BAND_COLOR,
  hhiBand,
} from "@/lib/textbookPublishers";
import { isConsortiumSupplier } from "@/lib/companyKey";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";

interface Supplier {
  eik: string;
  name: string;
  totalEur: number;
  /** € won as a consortium carrier (061 → AwarderSupplier). Optional so a caller
   *  folding an older payload still type-checks; `null`/absent means „unknown",
   *  which `isConsortiumSupplier` degrades to the key-prefix check. */
  consortiumEur?: number | null;
}

const TOP_N = 8;

export const VikContractorHhiTile: FC<{
  suppliers: Supplier[];
  totalEur: number;
  /** The sector's own member EIKs. A contractor that is also a member is an
   *  IN-GROUP transfer — the state paying its own company — not a supplier won
   *  on a market. Such rows are still counted (see the note below), but they are
   *  labelled, because unlabelled they read as a private vendor topping the
   *  sector. Omit to disable the check. */
  memberEiks?: readonly string[];
  /** Contractors that are PUBLIC BODIES but NOT members of this sector — a state or
   *  municipal company, an agency, a fund manager. Same treatment as `memberEiks`
   *  and for the same reason: the money is an intra-government transfer rather than
   *  a market award, and unlabelled the row reads as a private vendor topping the
   *  sector. Still counted (see the note below); never filtered out.
   *
   *  ⚠ MUST BE A CURATED LIST, never "is this EIK an awarder somewhere". ЗОП's
   *  utilities regime makes private regulated companies contracting authorities
   *  too, so that probe returns ЕВН, Овергаз, Софийска вода and the privately-held
   *  Топлофикации alongside the genuinely public ones — measured on water, 44% of
   *  its answer was private. Omit to disable the check. */
  stateBodyEiks?: readonly string[];
}> = ({ suppliers, totalEur, memberEiks, stateBodyEiks }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = suppliers.filter((s) => s.totalEur > 0);
  const members = new Set(memberEiks ?? []);
  // A member is already labelled „в групата", which is the more specific statement —
  // so the two sets never both fire on one row.
  const stateBodies = new Set(
    (stateBodyEiks ?? []).filter((e) => !members.has(e)),
  );
  if (rows.length < 3 || totalEur <= 0) return null;

  // Denominator is the ATTRIBUTED total (Σ over ranked suppliers), not the
  // awarder headline total — contracts with no contractor EIK are in `totalEur`
  // but in no supplier bucket, so using it would deflate HHI/CR-4 and could
  // misclassify a concentrated market as competitive on a low-coverage sector.
  const attributed = rows.reduce((a, s) => a + s.totalEur, 0);
  const denom = attributed > 0 ? attributed : totalEur;

  // HHI = Σ (percentage market share)², 0–10 000.
  const hhi = Math.round(
    rows.reduce((acc, s) => {
      const pct = (s.totalEur / denom) * 100;
      return acc + pct * pct;
    }, 0),
  );
  const band = hhiBand(hhi);
  const top = [...rows].sort((a, b) => b.totalEur - a.totalEur).slice(0, TOP_N);
  const cr4 = top.slice(0, 4).reduce((acc, s) => acc + s.totalEur / denom, 0);
  const max = top[0]?.totalEur ?? 1;

  // The chips label the ROW; this labels the NUMBER. A single intra-government
  // transfer can carry the headline across a DOJ band boundary on its own —
  // measured on social at y:2026, ФМФИБ's one €33M ОПРЧР financing agreement takes
  // the index from 1538 („умерен") to 5009 („силно концентриран"), i.e. 70% of the
  // index is that one row. Both numbers are true and the concentration is real, so
  // nothing is filtered: the transfers stay in the index and the market-only figure
  // is stated beside it, so „силно концентриран" cannot be read as a finding about
  // private vendors. Only shown when it actually changes the reading.
  const internal = rows.filter(
    (s) => members.has(s.eik) || stateBodies.has(s.eik),
  );
  const internalEur = internal.reduce((a, s) => a + s.totalEur, 0);
  const internalShare = denom > 0 ? internalEur / denom : 0;
  const marketRows = rows.filter(
    (s) => !members.has(s.eik) && !stateBodies.has(s.eik),
  );
  const marketDenom = marketRows.reduce((a, s) => a + s.totalEur, 0);
  const marketHhi =
    marketDenom > 0
      ? Math.round(
          marketRows.reduce((acc, s) => {
            const pct = (s.totalEur / marketDenom) * 100;
            return acc + pct * pct;
          }, 0),
        )
      : null;
  // A cosmetic difference is noise; a different BAND is a different sentence.
  const showMarketHhi =
    marketHhi != null && internalShare >= 0.05 && hhiBand(marketHhi) !== band;

  return (
    <Card id="hhi">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PieChart className="h-4 w-4" />
          {bg
            ? "Концентрация на изпълнителите (HHI)"
            : "Contractor concentration (HHI)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-4">
          <div>
            <span
              className={`text-2xl font-bold tabular-nums ${HHI_BAND_COLOR[band]}`}
            >
              {hhi.toLocaleString(lang)}
            </span>
            <span className={`ml-2 text-sm ${HHI_BAND_COLOR[band]}`}>
              {hhiBandLabel(hhi, lang)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {bg ? "Топ-4 дял" : "Top-4 share"}:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {Math.round(cr4 * 100)}%
            </span>{" "}
            · {rows.length} {bg ? "изпълнители" : "contractors"}
          </div>
        </div>

        {showMarketHhi && (
          <p className="text-[11px] text-muted-foreground">
            {bg
              ? `${Math.round(internalShare * 100)}% от стойността отива към държавни или общински структури. Само пазарните договори дават HHI ${marketHhi!.toLocaleString(lang)} — „${hhiBandLabel(marketHhi!, lang)}“.`
              : `${Math.round(internalShare * 100)}% of the value goes to state or municipal bodies. Over the market contracts alone the HHI is ${marketHhi!.toLocaleString(lang)} — “${hhiBandLabel(marketHhi!, lang)}”.`}
          </p>
        )}

        <div className="space-y-1.5">
          {top.map((s) => {
            const share = s.totalEur / denom;
            const inGroup = members.has(s.eik);
            const isStateBody = stateBodies.has(s.eik);
            return (
              <div key={s.eik} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <CompanyLink
                      eik={s.eik}
                      className="min-w-0 truncate hover:text-primary hover:underline"
                    >
                      {s.name}
                    </CompanyLink>
                    {inGroup && (
                      <span
                        className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground"
                        title={
                          bg
                            ? "Изпълнителят е от същата група — парите остават в сектора"
                            : "The contractor belongs to the same group — the money stays inside the sector"
                        }
                      >
                        {bg ? "в групата" : "in-group"}
                      </span>
                    )}
                    {isConsortiumSupplier(s) && (
                      <span
                        className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground"
                        title={
                          bg
                            ? "Няколко фирми, спечелили заедно. Сумата е на целия договор и се брои веднъж."
                            : "Several firms that won together. The figure is the whole contract and is counted once."
                        }
                      >
                        {bg ? "консорциум" : "consortium"}
                      </span>
                    )}
                    {isStateBody && (
                      <span
                        className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground"
                        title={
                          bg
                            ? "Изпълнителят е държавна или общинска структура — трансфер вътре в държавата, не спечелен на пазара договор"
                            : "The contractor is a state or municipal body — a transfer inside government, not a contract won on a market"
                        }
                      >
                        {bg ? "държавно" : "state body"}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatEurCompact(s.totalEur, lang)}
                    <span className="ml-1 text-muted-foreground/70">
                      {Math.round(share * 100)}%
                    </span>
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${
                      inGroup || isStateBody
                        ? "bg-violet-600/40"
                        : "bg-violet-600"
                    }`}
                    style={{
                      width: `${Math.max(2, (s.totalEur / max) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {top.some((s) => members.has(s.eik)) && (
          <p className="text-[11px] text-muted-foreground">
            {bg
              ? "„В групата“ = изпълнителят е една от организациите в самия сектор — държавата плаща на собственото си дружество, а не на външен пазар. Тези договори са включени в индекса, защото са реални обществени поръчки."
              : "“In-group” = the contractor is one of the sector's own organisations — the state paying its own company rather than an external market. These contracts are included in the index, because they are real public procurements."}
          </p>
        )}

        {top.some((s) => stateBodies.has(s.eik)) && (
          <p className="text-[11px] text-muted-foreground">
            {bg
              ? "„Държавно“ = изпълнителят е държавна или общинска структура извън сектора — парите не напускат държавата. И тези договори са в индекса: те са реални обществени поръчки, но не са спечелени на конкурентен пазар."
              : "“State body” = the contractor is a state or municipal organisation outside this sector — the money never leaves government. These are in the index too: they are real public procurements, but they were not won on a competitive market."}
          </p>
        )}
        {top.some(isConsortiumSupplier) && (
          <p className="text-[11px] text-muted-foreground">
            {bg
              ? "„Консорциум“ = няколко фирми, спечелили заедно. Сумата е на целия договор и се брои веднъж — но участник в консорциум може да има и собствен ред тук, така че концентрацията по фирма е подценена."
              : "“Consortium” = several firms that won together. The figure is the whole contract and is counted once — but a member firm may also hold its own row here, so per-firm concentration is understated."}
          </p>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Индекс на Херфиндал-Хиршман върху дела на изпълнителите в договорената стойност (по DOJ: под 1500 конкурентен, 1500–2500 умерен, над 2500 концентриран). Изчислено от договорите в текущия обхват."
            : "Herfindahl-Hirschman index over contractors' shares of the contracted value (DOJ bands: <1500 competitive, 1500–2500 moderate, >2500 concentrated). Computed from the contracts in the current scope."}
        </p>
      </CardContent>
    </Card>
  );
};
