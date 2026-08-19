// /procurement/methodology — the published spec, on the site.
//
// The full text lives in docs/methodology/procurement-risk-flags.md, which is
// GENERATED from src/lib/riskFlagCatalog.ts. This page is not a second copy of
// it: everything factual here is read from the same catalogue at render time, so
// the page cannot state a threshold or a weight the code is not using. The prose
// that is genuinely prose (framing, limits) is i18n.
//
// ⚠️ THE VERSION SHOWN IS THE SERVED ONE, NOT THE BUNDLE'S. `CATALOG_VERSION` is
// what this deploy declares; `useRiskCatalogVersion()` is what the last cache
// rebuild actually stamped, and they diverge across the window between a deploy
// and a rebuild. A reader is invited here to cite a version, so the page prints
// the provable one — and distinguishes "not stamped" (a fact about the database)
// from "could not load" (a fact about this request), because publishing the
// second as the first would be a false claim about the data.
//
// ⚠️ NO RAW CATALOGUE FIELD IS RENDERED. `availability`, `citation` and `caveat`
// are English prose written for the handbook; rendering them here put English
// sentences into a Bulgarian page. Everything user-facing is i18n; the numbers
// (thresholds, weights) come straight from the catalogue because a number is
// language-neutral and must not be re-typed.

import { FC, PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import {
  ArticleH2,
  ArticleLI,
  ArticleP,
  ArticleStrong,
  ArticleUL,
} from "@/components/article/ArticleProse";
import { MethodologyCallout } from "@/screens/components/MethodologyCallout";
import { useRiskCatalogVersion } from "@/data/procurement/useRiskCatalogVersion";
import {
  AWARDER_EXPOSURE_LIST,
  CATALOG_VERSION,
  CONTRACT_DISPLAY_ORDER,
  CONTRACT_FLAG_LIST,
  SUPPLIER_EXPOSURE_LIST,
  TENDER_FLAG_LIST,
  contractFlag,
  type ContractFlagDef,
  type TenderFlagDef,
} from "@/lib/riskFlagCatalog";

const HANDBOOK_URL =
  "https://github.com/atanasster/electionsbg/blob/main/docs/methodology/procurement-risk-flags.md";

const RISK_FLAGS_JSON_URL =
  "https://github.com/atanasster/electionsbg/blob/main/public/risk-flags.json";

const LabelP: FC<PropsWithChildren<{ label: string }>> = ({
  label,
  children,
}) => (
  <ArticleP>
    <ArticleStrong>{label}</ArticleStrong> {children}
  </ArticleP>
);

/** A threshold as a number with a unit — language-neutral, so it is formatted
 *  rather than translated. Rendering it is what makes this page the spec the
 *  prerendered copy promises; the first cut advertised thresholds and showed
 *  none. */
const thresholdText = (f: ContractFlagDef | TenderFlagDef): string => {
  const t = f.threshold;
  if (!t) return "—";
  switch (t.kind) {
    case "gteRatio":
      return `≥ ${Math.round(t.value * 100)}%`;
    case "ltDays":
      return `< ${t.value} d`;
    case "lteDays":
      return `≤ ${t.value} d`;
    case "ltMonths":
      return `< ${t.value} m`;
    case "gteMultiple":
      return `> +${Math.round((t.value - 1) * 100)}%`;
    case "gteEur":
      return `≥ €${t.value.toLocaleString("en-US")}`;
    case "cpvPrefix":
      return `CPV ${t.value}`;
  }
};

/** The served version, with its provenance stated rather than implied. */
const VersionLine: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useRiskCatalogVersion();
  if (isLoading) return null;

  // A failed request is NOT the same as an unstamped database. Rendering the
  // first as the second would assert something about the data on the strength of
  // a network error, on the one line a reader is invited to cite.
  if (isError || !data) return null;

  const served = data.version;
  const day = data.rebuiltAt ? data.rebuiltAt.slice(0, 10) : null;
  // Only claim drift in the direction we can actually detect: the bundle is
  // ahead of the cache. The reverse (a cache built by a newer deploy than the
  // one serving this page) is possible mid-rollout and is not the reader's
  // problem, so a bare `!==` would fire on it and say something untrue.
  const bundleAhead = served !== null && served !== CATALOG_VERSION;

  return (
    <ArticleP>
      {served ? (
        <>
          <ArticleStrong>
            {t("proc_meth_version_served")} v{served}
          </ArticleStrong>
          {day ? ` · ${t("proc_meth_version_rebuilt")} ${day}` : null}
          {bundleAhead ? <> · {t("proc_meth_version_drift")}</> : null}
        </>
      ) : (
        <ArticleStrong>{t("proc_meth_version_unstamped")}</ArticleStrong>
      )}
    </ArticleP>
  );
};

/** Which caveats have translated copy. A caveat is only shown where it has been
 *  written in the reader's language — the English original is in the handbook,
 *  and half-translating a warning is worse than linking to it. */
const CAVEAT_KEY: Partial<Record<string, string>> = {
  shortTenderPeriod: "proc_meth_caveat_shortTenderPeriod",
  shortDecisionPeriod: "proc_meth_caveat_shortDecisionPeriod",
};

/** One row per contract check, with the anchor every flag chip links to.
 *
 *  ⚠️ The availability column states the SERVER's rule (`serverAlwaysAvailable`,
 *  asserted against 112 by risk_catalog_sql_parity.test.ts), never the chip's
 *  not-applicable message. The first cut rendered `naReasonKey` here, which is a
 *  UI state — `appealUpheld`'s reads "no appeal recorded for this procedure" —
 *  and so published an inapplicability condition for six checks the server can
 *  never mark unavailable. */
const ContractFlagTable: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="my-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-3">{t("proc_meth_col_flag")}</th>
            <th className="py-2 pr-3">{t("proc_meth_col_means")}</th>
            <th className="py-2 pr-3 whitespace-nowrap">
              {t("proc_meth_col_threshold")}
            </th>
            <th className="py-2">{t("proc_meth_col_avail")}</th>
          </tr>
        </thead>
        <tbody>
          {CONTRACT_DISPLAY_ORDER.map((id) => {
            const f = contractFlag(id);
            const caveatKey = CAVEAT_KEY[id];
            return (
              // The id IS the anchor target: a flag chip anywhere on the site
              // links to /procurement/methodology#<flag-id>, so this must stay
              // the raw catalogue id rather than a localised slug.
              <tr key={id} id={id} className="scroll-mt-24 border-b align-top">
                <td className="py-2 pr-3">
                  {t(f.labelKey) || id}
                  {f.ref ? (
                    <div className="text-xs text-muted-foreground">{f.ref}</div>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {t(f.whyKey)}
                  {caveatKey ? (
                    <div className="mt-1 text-amber-700 dark:text-amber-400">
                      {t(caveatKey)}
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                  {thresholdText(f)}
                </td>
                <td className="py-2 text-muted-foreground">
                  {f.serverAlwaysAvailable
                    ? t("proc_meth_avail_always")
                    : t("proc_meth_avail_conditional")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/** The four procedure-level checks. Their ids are anchor targets too, so a
 *  tender-side chip can cite them. */
const TenderFlagTable: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="my-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-3">{t("proc_meth_col_flag")}</th>
            <th className="py-2 pr-3 whitespace-nowrap">
              {t("proc_meth_col_threshold")}
            </th>
            <th className="py-2">{t("proc_meth_col_basis_short")}</th>
          </tr>
        </thead>
        <tbody>
          {TENDER_FLAG_LIST.map((f) => {
            const caveatKey = CAVEAT_KEY[f.id];
            return (
              <tr
                key={f.id}
                id={f.id}
                className="scroll-mt-24 border-b align-top"
              >
                <td className="py-2 pr-3 font-mono text-xs">{f.id}</td>
                <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                  {thresholdText(f)}
                </td>
                <td className="py-2 text-muted-foreground">
                  {/* The NUMBER, not `baseRate` — that field is English prose
                      for the handbook ("14.3% (126,413 tenders, 2020–2026) —
                      stable by year") and rendering it put English onto the
                      Bulgarian page. */}
                  {f.baseRatePct !== undefined ? (
                    <div>
                      {t("proc_meth_base_rate")} {f.baseRatePct}%
                    </div>
                  ) : null}
                  {caveatKey ? (
                    <div className="mt-1 text-amber-700 dark:text-amber-400">
                      {t(caveatKey)}
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const componentList = (
  list: readonly { key: string; weight: number }[],
  t: (k: string) => string,
): string =>
  list.map((c) => `${t(`proc_meth_comp_${c.key}`)} ${c.weight}`).join(" · ");

export const ProcurementMethodologyScreen = () => {
  const { t } = useTranslation();
  const unmapped = [...CONTRACT_FLAG_LIST, ...TENDER_FLAG_LIST].filter(
    (f) => !f.ocp.id,
  ).length;

  return (
    <ArticleLayout
      title={t("proc_meth_title")}
      description={t("proc_meth_description")}
      breadcrumb={null}
      seoType="website"
    >
      <MethodologyCallout
        variant="disputed"
        title={t("proc_meth_caveat_title")}
        className="mb-4"
      >
        {t("proc_meth_caveat_body")}
      </MethodologyCallout>

      <ArticleP>{t("proc_meth_intro")}</ArticleP>
      <VersionLine />

      <ArticleH2>{t("proc_meth_h_read")}</ArticleH2>
      <ArticleP>{t("proc_meth_p_abc")}</ArticleP>
      <ArticleP>{t("proc_meth_p_denominator")}</ArticleP>

      <ArticleH2>
        {t("proc_meth_h_flags")} ({CONTRACT_FLAG_LIST.length})
      </ArticleH2>
      <ArticleP>{t("proc_meth_p_flags_intro")}</ArticleP>
      <ContractFlagTable />

      <ArticleH2>
        {t("proc_meth_h_tender")} ({TENDER_FLAG_LIST.length})
      </ArticleH2>
      <ArticleP>{t("proc_meth_p_tender")}</ArticleP>
      <TenderFlagTable />

      <ArticleH2>{t("proc_meth_h_contract_grade")}</ArticleH2>
      <ArticleP>{t("proc_meth_p_contract_grade")}</ArticleP>

      <ArticleH2>{t("proc_meth_h_grades")}</ArticleH2>
      <ArticleP>{t("proc_meth_p_grades")}</ArticleP>
      <LabelP label={t("proc_meth_grade_buyer_t")}>
        {componentList(AWARDER_EXPOSURE_LIST, t)}
      </LabelP>
      <LabelP label={t("proc_meth_grade_supplier_t")}>
        {componentList(SUPPLIER_EXPOSURE_LIST, t)}
      </LabelP>
      <ArticleP>{t("proc_meth_p_grades_differ")}</ArticleP>

      <ArticleH2>{t("proc_meth_h_align")}</ArticleH2>
      <ArticleP>
        {t("proc_meth_p_align")} {t("proc_meth_p_align_unmapped", { unmapped })}
      </ArticleP>

      <ArticleH2>{t("proc_meth_h_limits")}</ArticleH2>
      <ArticleUL>
        <ArticleLI>{t("proc_meth_limit_validation")}</ArticleLI>
        <ArticleLI>{t("proc_meth_limit_goodhart")}</ArticleLI>
        <ArticleLI>{t("proc_meth_limit_construct")}</ArticleLI>
      </ArticleUL>

      <ArticleH2>{t("proc_meth_h_reuse")}</ArticleH2>
      <ArticleP>{t("proc_meth_p_reuse")}</ArticleP>
      <ArticleUL>
        <ArticleLI>
          <a
            className="underline"
            href={RISK_FLAGS_JSON_URL}
            rel="noreferrer"
            target="_blank"
          >
            risk-flags.json
          </a>{" "}
          — {t("proc_meth_dl_json")}
        </ArticleLI>
        <ArticleLI>
          <a
            className="underline"
            href={HANDBOOK_URL}
            rel="noreferrer"
            target="_blank"
          >
            {t("proc_meth_dl_handbook")}
          </a>
        </ArticleLI>
      </ArticleUL>
    </ArticleLayout>
  );
};
