// /sector/health/drugs — the medicines the health fund pays for: by active
// substance, quarter by quarter, the unit prices and the hospital-administered
// ones. Plan: docs/plans/health-hub-v1.md §3.
//
// „БЕЗ ПЕРИОД" — no ScopeControl: the drug corpora are quarterly series with
// their own cadence.
//
// The tiles are the НЗОК pack's own (D4a) — not forked. Each section OWNS its
// id. Fragment ids: #pharmacy #trend #savings #unit-price #overpay
// #hospital-drugs, and only those.

import { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Syringe } from "lucide-react";
import { isBg } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { useNzokDrugReimbursement } from "@/data/budget/useBudget";
import { useHealthHubStats } from "@/data/health/hubStats";
import { NzokDrugReimbursementTile } from "@/screens/components/procurement/nzok/NzokDrugReimbursementTile";
import { NzokDrugQuarterlyTrendTile } from "@/screens/components/procurement/nzok/NzokDrugQuarterlyTrendTile";
import { NzokSavingsLeaderboardTile } from "@/screens/components/procurement/nzok/NzokSavingsLeaderboardTile";
import { NzokDrugUnitPriceTile } from "@/screens/components/procurement/nzok/NzokDrugUnitPriceTile";
import { NzokDrugRiskTile } from "@/screens/components/procurement/nzok/NzokDrugRiskTile";
import { HEALTH_PATHS } from "@/lib/healthPaths";
import { HealthPageFrame } from "./HealthPageFrame";
import { HealthNote } from "./HealthNote";
import { healthPct } from "./healthSectorData";

const Section: FC<{ id: string; children: ReactNode }> = ({ id, children }) => (
  <section id={id} className="scroll-mt-24 space-y-4">
    {children}
  </section>
);

/** #hospital-drugs — the `drugs` stream of the hospital payments, from the hub
 *  blob, set against every reimbursed medicine the same year. */
const HospitalDrugsCard: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: s, isError } = useHealthHubStats();
  if (isError || s === null)
    return (
      <HealthNote>
        {bg
          ? "Данните за лекарствата в болниците не можаха да се заредят."
          : "The data on medicines in hospitals could not be loaded."}
      </HealthNote>
    );
  if (!s) return null;
  const d = s.payments.byStream.find((r) => r.stream === "drugs");
  if (!d?.eur)
    return (
      <HealthNote>
        {bg
          ? `За ${s.year} г. няма плащания за лекарства към болници.`
          : `No medicine payments to hospitals in ${s.year}.`}
      </HealthNote>
    );
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Syringe className="h-4 w-4" />
          {bg ? "Лекарствата в болниците" : "Medicines in hospitals"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <p>
          <span className="text-2xl font-bold tabular-nums">
            {formatEurCompact(d.eur, lang)}
          </span>{" "}
          {bg
            ? `платени на ${formatInt(d.facilities, lang)} болници за лекарства през ${s.year} г., отделно от клиничните пътеки.`
            : `paid to ${formatInt(d.facilities, lang)} hospitals for medicines in ${s.year}, apart from the clinical pathways.`}
        </p>
        {s.medicines.eur > 0 ? (
          <p className="text-muted-foreground">
            {bg
              ? `Те са част от ${formatEurCompact(s.medicines.eur, lang)} за всички реимбурсирани лекарства същата година (${healthPct(d.eur / s.medicines.eur, bg)}) — не се добавят към тях.`
              : `They are part of the ${formatEurCompact(s.medicines.eur, lang)} for every reimbursed medicine that year (${healthPct(d.eur / s.medicines.eur, bg)}) — not added to it.`}
          </p>
        ) : null}
        <Link
          to={`${HEALTH_PATHS.hospitals}#payments`}
          className="inline-block text-xs font-medium text-primary hover:underline"
        >
          {bg ? "по болници →" : "by hospital →"}
        </Link>
      </CardContent>
    </Card>
  );
};

export const HealthDrugsScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const drugs = useNzokDrugReimbursement();

  return (
    <HealthPageFrame
      title={{ bg: "Лекарствата", en: "The medicines" }}
      description={{
        bg: "Лекарствата, които здравната каса плаща — по активно вещество и тримесечие, цените за опаковка спрямо медианата и скъпите лекарства в болниците.",
        en: "The medicines the health fund pays for — by active substance and quarter, the pack prices against the median, and the expensive medicines in hospitals.",
      }}
      scoped={false}
      ready={[drugs.data]}
    >
      <Section id="pharmacy">
        {drugs.data ? (
          <NzokDrugReimbursementTile data={drugs.data} />
        ) : drugs.isError ? (
          <HealthNote>
            {bg
              ? "Данните за реимбурсираните лекарства не можаха да се заредят."
              : "The reimbursed-medicines data could not be loaded."}
          </HealthNote>
        ) : null}
      </Section>
      <Section id="trend">
        <NzokDrugQuarterlyTrendTile />
      </Section>
      <Section id="savings">
        <NzokSavingsLeaderboardTile />
      </Section>
      <Section id="unit-price">
        <NzokDrugUnitPriceTile />
      </Section>
      <Section id="overpay">
        <NzokDrugRiskTile />
      </Section>
      <Section id="hospital-drugs">
        <HospitalDrugsCard />
      </Section>
      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Цена над медианата е сигнал за проверка, не доказателство за надплащане: различни опаковки, доставки и договори могат да я обяснят."
          : "A price above the median is a flag for review, not proof of overpayment: different packs, deliveries and contracts can explain it."}
      </p>
    </HealthPageFrame>
  );
};
