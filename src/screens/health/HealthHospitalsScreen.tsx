// /sector/health/hospitals — what the health fund pays each hospital, for what,
// and how that moves.
//
// „БЕЗ ПЕРИОД" — no ScopeControl: the payments corpus is a monthly series with
// its own reporting cadence, never filtered by parliament.
//
// The tiles are the НЗОК pack's own (D4a) — not forked. Each section OWNS its id
// and renders even when a self-fetching tile hides itself, so a hub link always
// lands; healthRegistry.test.ts fails a hub link to a fragment this page does
// not render. Fragment ids: #map #payments #momentum #regions #ownership
// #financials #risk, and only those.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Banknote } from "lucide-react";
import { isBg } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import {
  useNzokHospitalPayments,
  useNzokHospitalTrends,
} from "@/data/budget/useBudget";
import { useHealthHubStats, type HealthHubStats } from "@/data/health/hubStats";
import { NzokHospitalMap } from "@/screens/components/procurement/nzok/NzokHospitalMap";
import { NzokHospitalPaymentsTile } from "@/screens/components/procurement/nzok/NzokHospitalPaymentsTile";
import { NzokHospitalMomentumTile } from "@/screens/components/procurement/nzok/NzokHospitalMomentumTile";
import { NzokHospitalCompareTile } from "@/screens/components/procurement/nzok/NzokHospitalCompareTile";
import { NzokRegionalChoroplethTile } from "@/screens/components/procurement/nzok/NzokRegionalChoroplethTile";
import { NzokPublicPrivateBand } from "@/screens/components/procurement/nzok/NzokPublicPrivateBand";
import { NzokHospitalFinancialsTile } from "@/screens/components/procurement/nzok/NzokHospitalFinancialsTile";
import { NzokHospitalRiskTile } from "@/screens/components/procurement/nzok/NzokHospitalRiskTile";
import { HealthPageFrame } from "./HealthPageFrame";
import { HealthNote } from "./HealthNote";
import { healthPct, STREAM_LABEL } from "./healthSectorData";

const Section: FC<{ id: string; children: ReactNode }> = ({ id, children }) => (
  <section id={id} className="scroll-mt-24 space-y-4">
    {children}
  </section>
);

/** The year's payments split by stream, from the hub blob — the basis of the
 *  hub's KPI 2, with the €0 placeholder rows the facility count leaves out (A2). */
const StreamsCard: FC<{ s: HealthHubStats }> = ({ s }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const p = s.payments;
  if (!p.eur) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Banknote className="h-4 w-4" />
          {bg
            ? `Плащанията за ${s.year} г. по вид`
            : `The ${s.year} payments by kind`}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <ul className="space-y-1.5">
          {p.byStream.map((r) => (
            <li key={r.stream} className="space-y-0.5 text-xs">
              <div className="flex justify-between gap-2">
                <span>
                  {bg ? STREAM_LABEL[r.stream].bg : STREAM_LABEL[r.stream].en}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatEurCompact(r.eur, lang)} ·{" "}
                  {healthPct(r.eur / p.eur, bg)} ·{" "}
                  {bg
                    ? `${formatInt(r.facilities, lang)} заведения`
                    : `${formatInt(r.facilities, lang)} facilities`}
                </span>
              </div>
              <div className="h-1.5 rounded bg-muted">
                <div
                  className="h-1.5 rounded bg-primary/70"
                  style={{ width: `${(r.eur / p.eur) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Лекарствата, платени на болниците, са част и от всички реимбурсирани лекарства на страницата „Лекарствата“ — затова числото за болниците на страницата на сектора е без тях. Заведение се брои, ако има поне едно ненулево плащане; ${formatInt(p.placeholderRows, lang)} реда с €0 в източника не се броят.`
            : `The medicines paid to hospitals are also part of every reimbursed medicine on the Medicines page — which is why the hospitals' figure on the sector hub leaves them out. A facility counts if it had at least one non-zero payment; ${formatInt(p.placeholderRows, lang)} €0 rows in the source are not counted.`}
        </p>
      </CardContent>
    </Card>
  );
};

export const HealthHospitalsScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const payments = useNzokHospitalPayments();
  const trends = useNzokHospitalTrends();
  const { data: hub } = useHealthHubStats();
  const failed = bg
    ? "Данните за този раздел не можаха да се заредят."
    : "The data for this section could not be loaded.";
  const absent = bg
    ? "Тези данни още не са публикувани."
    : "This data is not published yet.";

  return (
    <HealthPageFrame
      title={{ bg: "Болниците", en: "The hospitals" }}
      description={{
        bg: "Колко плаща здравната каса на всяка болница и за какво — болнична помощ, лекарства и медицински изделия, на картата, по области, по собственост и във времето.",
        en: "How much the health fund pays each hospital, and for what — hospital care, medicines and medical devices, on the map, by region, by ownership and over time.",
      }}
      scoped={false}
      ready={[payments.data, trends.data, hub]}
    >
      <Section id="map">
        <NzokHospitalMap />
      </Section>
      <Section id="payments">
        {hub ? <StreamsCard s={hub} /> : null}
        {payments.data ? (
          <NzokHospitalPaymentsTile data={payments.data} />
        ) : payments.isError ? (
          <HealthNote>{failed}</HealthNote>
        ) : payments.isLoading ? null : (
          <HealthNote>{absent}</HealthNote>
        )}
      </Section>
      <Section id="momentum">
        {trends.data ? (
          <NzokHospitalMomentumTile data={trends.data} />
        ) : trends.isError ? (
          <HealthNote>{failed}</HealthNote>
        ) : null}
      </Section>
      <Section id="regions">
        {payments.data ? (
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <NzokHospitalCompareTile data={payments.data} />
            <NzokRegionalChoroplethTile data={payments.data} />
          </div>
        ) : null}
      </Section>
      <Section id="ownership">
        <NzokPublicPrivateBand />
      </Section>
      <Section id="financials">
        <NzokHospitalFinancialsTile />
      </Section>
      <Section id="risk">
        <NzokHospitalRiskTile />
      </Section>
      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Плащанията са по договорите на болниците с НЗОК по чл. 45 ЗЗО — извън обществените поръчки. Поръчките на самите болници не са в сектора: те са дружества, на които касата плаща."
          : "The payments are under the hospitals' contracts with НЗОК (art. 45 of the Health Insurance Act) — outside public procurement. The hospitals' own procurement is not in the sector: they are companies the fund pays."}
      </p>
    </HealthPageFrame>
  );
};
