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
// ⚠️ NO RAW CATALOGUE PROSE IS RENDERED. `availability`, `citation`, `caveat`
// and ALIGNMENT_SOURCES.method are English prose written for the handbook;
// rendering them here put English sentences into a Bulgarian page. Everything
// user-facing is i18n; the numbers (thresholds, weights) come straight from the
// catalogue because a number is language-neutral and must not be re-typed.
//
// ⚠️ THE TWO SCREENSHOTS ARE THE ONE PLACE THIS PAGE SHOWS A NUMBER IT DOES NOT
// DERIVE. They are snapshots, so a corpus reload moves the corpus underneath
// them — which is why their captions are deliberately number-free and say
// "example": the picture illustrates the SHAPE (a ledger that also lists what
// passed and what was inapplicable; one entity carrying two different grades),
// and every threshold, weight and count a reader might cite is rendered from
// the catalogue elsewhere on the page. Regenerate with
// `node scripts/capture-risk-shots.mjs`, which also documents why they are webp
// rather than png (a png used to be deleted by the postbuild image pass with
// this reference left dangling — closed since 2026-08-20, but webp is still the
// one copy both the markdown and this component can name).
//
// The source footnotes are the one place a non-numeric catalogue field reaches
// the page: ALIGNMENT_SOURCES' `title`, `url` and `verifiedOn`. Those are
// bibliographic facts about two English documents — a document's title is its
// name in every language, and a translated URL is a second source of truth that
// can drift from the catalogue the mappings were actually read against. The
// sentence AROUND them is i18n, as everywhere else.

import { FC, PropsWithChildren } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import {
  ArticleH2,
  ArticleLI,
  ArticleP,
  ArticleStrong,
  ArticleUL,
} from "@/components/article/ArticleProse";
import { proseClasses } from "@/components/article/proseClasses";
import { MethodologyCallout } from "@/screens/components/MethodologyCallout";
import { useRiskCatalogVersion } from "@/data/procurement/useRiskCatalogVersion";
import { formatDateLong } from "@/lib/formatDate";
import {
  ALIGNMENT_SOURCES,
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

/** The two external methodologies every check is cross-walked against, in
 *  footnote order. The number a citation prints and the position in the list at
 *  the foot of the page are BOTH derived from this array, so a third source
 *  cannot renumber one side and not the other.
 *
 *  The titles, URLs and verification dates come from ALIGNMENT_SOURCES rather
 *  than from i18n: they are bibliographic facts about English documents, and a
 *  translated copy of a URL or a document title is a second source of truth that
 *  can go stale against the catalogue the mappings were actually read from.
 *  `method` is deliberately NOT rendered — it is English prose for the handbook,
 *  the same reason `availability` and `caveat` stay out of this page. */
const SOURCE_ORDER = ["ocp", "imonitor"] as const;
type SourceId = (typeof SOURCE_ORDER)[number];

const sourceAnchor = (id: SourceId): string => `src-${id}`;

/** An in-text citation: the name links DOWN to its footnote, which is where the
 *  document's URL and provenance live. Deliberately not a direct link to the
 *  PDF — a reader who follows a citation off-site never sees when it was read
 *  or how much of it was compared, which is the part that makes the mapping
 *  checkable rather than merely asserted. */
const Cite: FC<PropsWithChildren<{ id: SourceId }>> = ({ id, children }) => (
  <a className={proseClasses.a} href={`#${sourceAnchor(id)}`}>
    {children}
    <sup className="ml-0.5 align-super text-[0.7em]">
      {SOURCE_ORDER.indexOf(id) + 1}
    </sup>
  </a>
);

const SourceNotes: FC = () => {
  const { t, i18n } = useTranslation();
  return (
    <ol className={proseClasses.ol}>
      {SOURCE_ORDER.map((id) => {
        const src = ALIGNMENT_SOURCES[id];
        const size =
          "flagCount" in src
            ? t("proc_meth_src_flags", { count: src.flagCount })
            : t("proc_meth_src_indicators", { count: src.indicatorCount });
        return (
          <li
            key={id}
            id={sourceAnchor(id)}
            className={`${proseClasses.li} scroll-mt-24`}
          >
            <a
              className={proseClasses.a}
              href={src.url}
              rel="noreferrer"
              target="_blank"
            >
              {src.title}
            </a>{" "}
            <span className="text-muted-foreground">
              (PDF) — {size} ·{" "}
              {t("proc_meth_src_verified", {
                date: formatDateLong(src.verifiedOn, i18n.language),
              })}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

/** A captioned screenshot of the live UI. `width`/`height` are the file's own
 *  intrinsic pixels — the image renders `w-full`, so the pair only serves to
 *  reserve the aspect ratio and keep the page CLS-free (the article renderer
 *  gets the same attributes from `collectImageDimensions`; a hand-written JSX
 *  page has to state them, so a re-capture that changes a dimension has to
 *  change these too — `capture-risk-shots.mjs` prints both and says so). */
const Shot: FC<{
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
}> = ({ src, alt, caption, width, height }) => (
  <figure className="my-6">
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={proseClasses.img}
    />
    <figcaption className="mt-2 text-xs leading-5 text-muted-foreground">
      {caption}
    </figcaption>
  </figure>
);

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

  // An unstamped database shows no version line at all.
  if (!served) return null;

  return (
    <ArticleP>
      <ArticleStrong>
        {t("proc_meth_version_served")} v{served}
      </ArticleStrong>
      {day ? ` · ${t("proc_meth_version_rebuilt")} ${day}` : null}
      {bundleAhead ? <> · {t("proc_meth_version_drift")}</> : null}
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

      <ArticleP>
        <Trans
          i18nKey="proc_meth_intro"
          components={{
            dash: <Link to="/procurement" className={proseClasses.a} />,
          }}
        />
      </ArticleP>
      <VersionLine />

      <ArticleH2>{t("proc_meth_h_read")}</ArticleH2>
      <ArticleP>{t("proc_meth_p_abc")}</ArticleP>
      <ArticleP>{t("proc_meth_p_denominator")}</ArticleP>
      <Shot
        src="/articles/images/procurement-risk/02-signals.webp"
        alt={t("proc_meth_shot_signals_alt")}
        caption={t("proc_meth_shot_signals_cap")}
        width={2000}
        height={2114}
      />

      <ArticleH2>
        {t("proc_meth_h_flags")} ({CONTRACT_FLAG_LIST.length})
      </ArticleH2>
      <ContractFlagTable />

      <ArticleH2>
        <Trans
          i18nKey="proc_meth_h_tender"
          components={{
            tenders: (
              <Link to="/procurement/tenders" className={proseClasses.a} />
            ),
          }}
        />{" "}
        ({TENDER_FLAG_LIST.length})
      </ArticleH2>
      <ArticleP>
        <Trans
          i18nKey="proc_meth_p_tender"
          components={{
            tenders: (
              <Link to="/procurement/tenders" className={proseClasses.a} />
            ),
          }}
        />
      </ArticleP>
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
      <ArticleP>
        <Trans
          i18nKey="proc_meth_p_grades_differ"
          components={{
            tenders: (
              <Link to="/procurement/tenders" className={proseClasses.a} />
            ),
          }}
        />
      </ArticleP>
      <Shot
        src="/articles/images/procurement-risk/01-grades.webp"
        alt={t("proc_meth_shot_grades_alt")}
        caption={t("proc_meth_shot_grades_cap")}
        width={1920}
        height={1324}
      />

      <ArticleH2>{t("proc_meth_h_align")}</ArticleH2>
      <ArticleP>
        <Trans
          i18nKey="proc_meth_p_align"
          components={{ ocp: <Cite id="ocp" />, im: <Cite id="imonitor" /> }}
        />{" "}
        {t("proc_meth_p_align_unmapped", { unmapped })}
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

      <ArticleH2>{t("proc_meth_h_sources")}</ArticleH2>
      <SourceNotes />
    </ArticleLayout>
  );
};
