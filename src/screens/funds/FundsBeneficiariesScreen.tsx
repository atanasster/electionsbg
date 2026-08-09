// /funds/beneficiaries — who received the money.
//
// One of the six pages the hub rework (docs/plans/funds-hub-v1.md §3) splits out of the
// /funds dashboard, so the hub can front it with a tile instead of rendering its fetch.
//
// SELF-CONTAINED: its own Title, breadcrumb, source footer, and its own fetch. That is the
// whole point of the split — the hub was pulling 390 KB across 8 requests to draw previews.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ONE SOURCE FOR THE FIGURES AND THE LIST, AND THIS PAGE GOT IT WRONG ONCE. The first draft read
// its stat cards from `funds_hub_stats()` (migration 145, over `fund_projects`) while the
// ranking underneath came from `fund_payloads(kind='index')`. Those are DIFFERENT POPULATIONS:
//
//     53 108   organisations in ИСУН's beneficiary register   ← the blob, and this list
//     47 599   organisations appearing on a contract          ← fund_projects, i.e. 145
//     46 164   the EIK-keyed rollup                           ← fund_beneficiaries
//
// All three answer different questions, and the page announced the second above a list drawn
// from the first — 5 509 organisations and €156.9m apart, with the drift unbounded because the
// two refresh on different triggers.
//
// So everything here reads `useFundsIndex()`, the same blob as the list. That is the
// dashboard-hub skill's destination rule stated the other way round: a page leads with the
// basis of what it actually shows. `funds_hub_stats()` is for the HUB TILE — and step 6 must
// make that tile quote the register count too, or it lands a reader on a page whose headline
// disagrees with it.
//
// The GRANT card went with the mix: `grant_eur` is a `fund_projects` concept the blob does not
// carry, so keeping it would have re-imported two corpora for one number. „Изплатено" replaces
// it, and it comes from this same blob.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Users } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useFundsIndex } from "@/data/funds/useFundsIndex";
import { TopBeneficiariesCard } from "./TopBeneficiariesCard";
import { formatEur, formatInt } from "@/lib/currency";

export const FundsBeneficiariesScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: index, isLoading } = useFundsIndex();
  const totals = index?.totals;

  const title = t("funds_benef_title") || "Бенефициенти";
  const description =
    t("funds_benef_description") ||
    "Организациите с договори по ИСУН 2020 — кой е получил най-много и колко от тях са свързани с политици.";

  const rows = index?.topByContracted ?? [];

  return (
    <>
      <Title description={description}>{title}</Title>
      <section className="mx-auto w-full px-3 pb-10 sm:px-4">
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          currentKey="funds_benef_title"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label={t("funds_benef_count") || "Бенефициенти"}
            hint={
              t("funds_benef_count_hint") ||
              "Организациите в регистъра на бенефициентите на ИСУН 2020 — същият регистър, от който е и класацията отдолу."
            }
          >
            <div className="flex items-baseline gap-2">
              <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="text-2xl font-bold tabular-nums">
                {totals ? formatInt(totals.beneficiaries, i18n.language) : "—"}
              </span>
            </div>
            {/* THE GAP, STATED — from THIS blob's own `withEik`, not from a second corpus.
                Without it a reader cannot tell that several thousand of these are identified by
                name alone, which is also why those rows have no /company page to link to. */}
            {totals ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {formatInt(
                  totals.beneficiaries - totals.withEik,
                  i18n.language,
                )}{" "}
                {t("funds_benef_no_eik") || "само по име, без ЕИК"}
              </div>
            ) : null}
          </StatCard>
          <StatCard
            label={t("funds_benef_contracted") || "Договорено"}
            hint={
              t("funds_benef_contracted_hint") ||
              "Стойността на договорите, включително собственото съфинансиране на бенефициента."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {totals ? formatEur(totals.contractedEur) : "—"}
            </div>
            {totals ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {formatInt(totals.contractCount, i18n.language)}{" "}
                {t("funds_benef_contracts") || "договора"}
              </div>
            ) : null}
          </StatCard>
          <StatCard
            label={t("funds_benef_paid") || "Изплатено"}
            hint={
              t("funds_benef_paid_hint") ||
              "Реално изплатеното по тези договори. Делът спрямо усвояването на безвъзмездната помощ е различен — вж. „Програми“."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {totals ? formatEur(totals.paidEur) : "—"}
            </div>
          </StatCard>
        </div>

        <h2 className="mt-8 text-lg font-semibold">
          {t("funds_benef_top") || "Най-големите получатели"}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {t("funds_benef_top_hint") ||
            "Подредени по договорена стойност. „Свързан с депутат“ е сигнал за проверка, не заключение."}
        </p>
        {isLoading ? (
          <div className="h-64 animate-pulse rounded-xl border bg-card" />
        ) : rows.length ? (
          // 25, not the hub's 15 — this is the page the reader came to for the ranking, and
          // the list is already in hand.
          <TopBeneficiariesCard rows={rows} rowCount={25} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("funds_benef_empty") || "Няма заредени бенефициенти."}
          </p>
        )}

        <p className="mt-4 text-[11px] text-muted-foreground/80">
          {t("funds_index_source_hint") ||
            "Източник: публичният регистър на бенефициентите в ИСУН 2020."}{" "}
          <a
            href="https://2020.eufunds.bg/bg/0/0/Beneficiary"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            2020.eufunds.bg <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </section>
    </>
  );
};
