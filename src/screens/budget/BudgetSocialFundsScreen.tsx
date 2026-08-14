// /budget/social-funds — the social-security funds, and what the state adds.
//
// Plan: docs/plans/budget-hub-v1.md T6.11. Source: НОИ's monthly per-fund
// cash-execution report (B1).
//
// THE PAGE IS ONE IDENTITY, and without it the figures look impossible:
//
//     приходи − разходи + трансфери − вноска в ЕС = салдо
//     6 590 528 454 − 12 585 473 587 + 5 892 736 120 − 0 = −102 209 013   (ДОО, 2024)
//
// ДОО'S OWN CONTRIBUTIONS COVER 52.4% OF ITS SPENDING. The rest — €5.89bn, of
// which 99.97% comes from the central budget — is a transfer in. Rendering
// revenue beside expenditure without it shows a €6bn hole next to a stated
// balance of −€102m, and a reader concludes one of the two is wrong.
//
// That €5.89bn is also the other end of a number this module already shows: it
// is part of „Трансфери (нето)" on /budget/spending, which is 58% of the state
// budget'"'"'s expenditure section. The two pages are the same money seen from
// either side, and each links to the other.
//
// ONE MORE THING THE SOURCE FORCES: a year carries per-fund detail only once
// НОИ has published the B1 sheets. Mid-cycle the ingest publishes a
// yearbook-only shell with no `funds`, and that year must not render as three
// funds with zero in every column.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
import { formatEur, formatEurSigned } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useNoiFunds } from "@/data/budget/useBudget";

const eur = (m: { amountEur?: number | null } | null | undefined) =>
  m?.amountEur ?? null;

export const BudgetSocialFundsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });
  const { data: file, isLoading } = useNoiFunds();

  // Only years that actually carry per-fund detail. A yearbook-only shell has
  // no `funds` at all, and offering it renders an empty table under a year
  // heading — „the funds reported nothing", which is not what happened.
  const years = useMemo(
    () =>
      (file?.years ?? [])
        .filter((y) => (y.funds?.length ?? 0) > 0)
        .map((y) => y.fiscalYear)
        .sort((a, b) => a - b),
    [file],
  );
  const requested = fyParam && /^\d{4}$/.test(fyParam) ? Number(fyParam) : null;
  const fy =
    requested != null && years.includes(requested)
      ? requested
      : (years[years.length - 1] ?? null);

  const year = useMemo(
    () => (file?.years ?? []).find((y) => y.fiscalYear === fy) ?? null,
    [file, fy],
  );
  const funds = useMemo(
    () =>
      [...(year?.funds ?? [])].sort(
        (a, b) => (eur(b.expenditure) ?? 0) - (eur(a.expenditure) ?? 0),
      ),
    [year],
  );

  const title = t("budget_funds_title");

  return (
    <>
      <Title description={t("budget_funds_description")}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_funds_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-5">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_funds_intro")}
        </p>

        {years.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {years.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setFyParam(String(y))}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  y === fy
                    ? "border-primary bg-primary/10 text-primary font-semibold"
                    : "border-border hover:border-primary/60",
                )}
              >
                {y}
              </button>
            ))}
          </div>
        ) : null}

        {isLoading || (fy == null && !file) ? (
          <div className="h-80 animate-pulse rounded-xl border bg-card" />
        ) : funds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("budget_funds_empty")}
          </p>
        ) : (
          <>
            {funds.map((f) => {
              const rev = eur(f.revenue);
              const exp = eur(f.expenditure);
              const tr = eur(f.transfers);
              const eu = eur(f.euContribution);
              const bal = eur(f.balance);
              const central = eur(f.transfersCentralBudget);
              // The one derived figure the source supports: how much of the
              // fund's own spending its own revenue covers.
              const selfFunded =
                rev != null && exp != null && exp !== 0
                  ? (rev / exp) * 100
                  : null;
              // Only claimed when the published terms actually produce the
              // published balance.
              const identityHolds =
                rev != null && exp != null && tr != null && bal != null
                  ? Math.abs(rev - exp + tr - (eu ?? 0) - bal) < 1_000
                  : null;

              return (
                <div
                  key={f.fundCode}
                  className="rounded-xl border bg-card p-4 shadow-sm"
                >
                  <h2 className="text-base font-semibold">
                    {bg ? f.fundLabelBg : f.fundLabelEn}
                  </h2>

                  {selfFunded != null ? (
                    <p className="mt-1 text-sm">
                      {/* Two of the three funds cover MORE than their own
                          spending — Учителски 130.8%, ГВРС 133.5% — so one
                          sentence cannot serve both directions. */}
                      {t(
                        selfFunded >= 100
                          ? "budget_funds_self_over"
                          : "budget_funds_self",
                        { pct: selfFunded.toFixed(1), defaultValue: "" },
                      )}
                    </p>
                  ) : null}

                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {[
                      { k: "budget_funds_revenue", v: rev, sign: 1 as const },
                      {
                        k: "budget_funds_expenditure",
                        v: exp,
                        sign: -1 as const,
                      },
                      { k: "budget_funds_transfers", v: tr, sign: 1 as const },
                      { k: "budget_funds_eu", v: eu, sign: -1 as const },
                    ].map((row) => (
                      <div
                        key={row.k}
                        className="flex items-baseline justify-between gap-3 border-b py-1 last:border-b-0"
                      >
                        <dt className="text-muted-foreground">
                          {row.sign === -1 ? <span aria-hidden>− </span> : null}
                          {t(row.k)}
                        </dt>
                        <dd className="shrink-0 tabular-nums">
                          {row.v == null ? "—" : formatEur(row.v)}
                        </dd>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-3 border-t-2 py-1 font-semibold sm:col-span-2">
                      <dt>{t("budget_funds_balance")}</dt>
                      <dd className="shrink-0 tabular-nums">
                        {bal == null ? "—" : formatEurSigned(bal)}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-2 text-xs text-muted-foreground">
                    {/* THREE states. The parser throws on a break above one
                        lev, so the „disagrees" branch is effectively
                        unreachable in practice — which means a two-way ternary
                        renders „НОИ'"'"'s lines disagree" for what is really a
                        MISSING FIELD, a normal state while the bucket serves a
                        funds.json written before those columns were parsed
                        (see NoiFundSnapshot'"'"'s own comment). */}
                    {identityHolds === true
                      ? t("budget_funds_identity")
                      : identityHolds === null
                        ? t("budget_funds_identity_missing")
                        : t("budget_funds_identity_broken")}
                  </p>

                  {/* The other end of the transfer, named and linked. */}
                  {central != null && central > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("budget_funds_central", {
                        amount: formatEur(central),
                        defaultValue: "",
                      })}{" "}
                      <Link
                        // …with the YEAR. Without it the link lands on the
                        // module'"'"'s default year and the reader compares this
                        // fund'"'"'s 2024 transfer against 2026'"'"'s €8.17bn line.
                        to={`/budget/spending${fy ? `?fy=${fy}` : ""}`}
                        className="text-primary hover:underline"
                      >
                        {t("budget_funds_see_spending")}
                      </Link>
                    </p>
                  ) : null}
                </div>
              );
            })}
          </>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_funds_source", {
            asOf: year?.asOf ?? "",
            defaultValue: "",
          })}
        </p>
      </section>
    </>
  );
};
