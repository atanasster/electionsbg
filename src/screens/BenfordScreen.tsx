import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Sigma } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { useBenford, type BenfordPartyEntry } from "@/data/benford/useBenford";
import { useElectionContext } from "@/data/ElectionContext";
import { formatThousands } from "@/data/utils";
import { StatCard } from "@/screens/dashboard/StatCard";
import { MethodologyCallout } from "@/screens/components/MethodologyCallout";
import { BenfordChart } from "@/screens/components/benford/BenfordChart";

// Benford's law screen — section-level first-digit (and second-digit)
// vote-count distributions per party. The editorial framing is
// non-negotiable: a persistent caveat banner above every view, sorting
// by party number not by deviation, and the default toggle on the
// detail view favours 2BL (Mebane's recommended test).

const PARTIES_PER_ROW = "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";

const partyLabel = (
  p: Pick<BenfordPartyEntry, "nickName" | "name" | "name_en">,
  isBg: boolean,
) =>
  isBg ? p.nickName || p.name || "?" : p.nickName || p.name_en || p.name || "?";

// Plain-language read of the MAD score, calibrated to actual BG section-vote
// distributions (not Nigrini's accounting thresholds, which are too strict
// for range-bounded electoral data). Three buckets:
//   close     < 0.04 — distribution tracks Benford
//   moderate  0.04–0.08 — some deviation, common for parties
//   strong    ≥ 0.08 — pronounced deviation, usually from small or
//                       range-bounded per-section counts (NOT fraud)
type MadBucket = "close" | "moderate" | "strong";
const madBucket = (mad: number): MadBucket =>
  mad < 0.04 ? "close" : mad < 0.08 ? "moderate" : "strong";

const bucketColor = (b: MadBucket): string =>
  b === "close"
    ? "bg-emerald-500"
    : b === "moderate"
      ? "bg-amber-500"
      : "bg-orange-600";

// Overview — small multiples grid, one mini-chart per party. Defaults to
// 2BL because that's the Mebane-recommended applicable test for vote
// counts; the user can switch to 1BL.
export const BenfordScreen = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { selected } = useElectionContext();
  const { data } = useBenford();
  const [mode, setMode] = useState<"first" | "second">("second");

  const entries = data?.parties ?? [];
  const hasAnyTwo = entries.some((p) => p.secondDigit);

  // Default to 1BL if no party has enough sections for 2BL (early
  // elections with mostly small section counts).
  const activeMode = mode === "second" && !hasAnyTwo ? "first" : mode;

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <SEO title={t("benford_title")} description={t("benford_description")} />
      <div className="py-4 md:py-6">
        <H1 className="text-xl md:text-2xl font-bold text-foreground">
          {t("benford_title")}
        </H1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          {t("benford_description")}
        </p>
      </div>

      <MethodologyCallout
        variant="disputed"
        title={t("benford_caveat_title")}
        className="mb-4"
      >
        {t("benford_caveat_body")}
      </MethodologyCallout>

      {/* Mode toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("benford_mode_label")}
        </div>
        <div
          role="tablist"
          className="inline-flex rounded-md border bg-card overflow-hidden text-xs"
        >
          <button
            role="tab"
            aria-selected={activeMode === "second"}
            disabled={!hasAnyTwo}
            onClick={() => setMode("second")}
            className={`px-3 py-1.5 ${
              activeMode === "second"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title={t("benford_mode_second_hint")}
          >
            {t("benford_mode_second")}
          </button>
          <button
            role="tab"
            aria-selected={activeMode === "first"}
            onClick={() => setMode("first")}
            className={`px-3 py-1.5 ${
              activeMode === "first"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title={t("benford_mode_first_hint")}
          >
            {t("benford_mode_first")}
          </button>
        </div>
      </div>

      {/* Small-multiples grid — sorted by partyNum (NOT deviation) so the
          ordering doesn't imply a ranking. Filter out parties without
          test data for the current mode rather than showing empty tiles. */}
      <div className={`grid gap-3 ${PARTIES_PER_ROW}`}>
        {entries
          .map((p) => ({
            p,
            test: activeMode === "first" ? p.firstDigit : p.secondDigit,
          }))
          .filter((x) => x.test)
          .map(({ p, test }) => {
            const bucket = madBucket(test!.mad);
            return (
              <Link
                key={p.partyNum}
                to={`/benford/${p.partyNum}`}
                className="block rounded-xl border bg-card p-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: p.color || "#888" }}
                    />
                    <span className="truncate text-xs font-semibold">
                      {partyLabel(p, isBg)}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    n={formatThousands(test!.n)}
                  </span>
                </div>
                <BenfordChart
                  test={test}
                  mode={activeMode}
                  color={p.color}
                  small
                />
                <div className="mt-1 grid grid-cols-2 gap-x-2 text-[10px] text-muted-foreground tabular-nums">
                  <span>
                    MAD:{" "}
                    <span className="font-mono">{test!.mad.toFixed(4)}</span>
                  </span>
                  <span className="text-right">
                    χ²:{" "}
                    <span className="font-mono">{test!.chi2.toFixed(0)}</span>
                  </span>
                </div>
                {/* Plain-language interpretation footer. Colored dot
                    cues the bucket; the label avoids any fraud framing. */}
                <div className="mt-1.5 pt-1.5 border-t flex items-start gap-1.5 text-[10px] text-muted-foreground leading-snug">
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${bucketColor(bucket)}`}
                  />
                  <span>{t(`benford_bucket_${bucket}`)}</span>
                </div>
              </Link>
            );
          })}
      </div>

      <p className="text-[11px] text-muted-foreground mt-6">
        {t("benford_footer")} · {selected}
      </p>
    </div>
  );
};

// Per-party detail — full-size chart, both 1BL and 2BL toggle, and a
// plain-language interpretation paragraph.
export const BenfordDetailScreen = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data } = useBenford();
  const { partyNum } = useParams<{ partyNum: string }>();
  const entry = useMemo(() => {
    const num = Number(partyNum);
    return data?.parties.find((p) => p.partyNum === num);
  }, [data, partyNum]);
  const [mode, setMode] = useState<"first" | "second">("second");
  const activeMode = mode === "second" && !entry?.secondDigit ? "first" : mode;
  const test = activeMode === "first" ? entry?.firstDigit : entry?.secondDigit;

  if (!data) return null;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-12">
      <SEO
        title={
          entry
            ? `${t("benford_title")} — ${partyLabel(entry, isBg)}`
            : t("benford_title")
        }
        description={t("benford_description")}
      />
      <Link
        to="/benford"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2 mt-4"
      >
        <ChevronLeft className="h-4 w-4" />
        {t("benford_title")}
      </Link>
      {entry && (
        <div className="flex items-center gap-2 mt-1">
          <span
            className="inline-block w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: entry.color || "#888" }}
          />
          <H1 className="text-xl md:text-2xl font-bold text-foreground">
            {partyLabel(entry, isBg)}
          </H1>
        </div>
      )}

      <MethodologyCallout
        variant="disputed"
        title={t("benford_caveat_title")}
        className="mt-3 mb-4"
      >
        {t("benford_caveat_body")}
      </MethodologyCallout>

      {/* Mode toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("benford_mode_label")}
        </div>
        <div
          role="tablist"
          className="inline-flex rounded-md border bg-card overflow-hidden text-xs"
        >
          <button
            role="tab"
            aria-selected={activeMode === "second"}
            disabled={!entry?.secondDigit}
            onClick={() => setMode("second")}
            className={`px-3 py-1.5 ${
              activeMode === "second"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title={t("benford_mode_second_hint")}
          >
            {t("benford_mode_second")}
          </button>
          <button
            role="tab"
            aria-selected={activeMode === "first"}
            onClick={() => setMode("first")}
            className={`px-3 py-1.5 ${
              activeMode === "first"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title={t("benford_mode_first_hint")}
          >
            {t("benford_mode_first")}
          </button>
        </div>
      </div>

      <StatCard
        label={
          <div className="flex items-center justify-between w-full text-xs font-medium uppercase tracking-wide">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Sigma className="h-4 w-4" />
              <span>
                {activeMode === "first"
                  ? t("benford_mode_first")
                  : t("benford_mode_second")}
              </span>
            </div>
            {test && (
              <span className="tabular-nums text-muted-foreground">
                n = {formatThousands(test.n)}
              </span>
            )}
          </div>
        }
      >
        <BenfordChart test={test} mode={activeMode} color={entry?.color} />
        {test && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-md border p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                MAD
              </div>
              <div className="text-base font-bold tabular-nums">
                {test.mad.toFixed(4)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t("benford_mad_caption")}
              </div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                χ²
              </div>
              <div className="text-base font-bold tabular-nums">
                {test.chi2.toFixed(0)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t("benford_chi2_caption")}
              </div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("benford_p_value")}
              </div>
              <div className="text-base font-bold tabular-nums">
                {test.pValue < 0.001 ? "<0.001" : test.pValue.toFixed(3)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t("benford_p_caption")}
              </div>
            </div>
          </div>
        )}
      </StatCard>

      {test && (
        <div className="mt-4 flex items-start gap-2 text-sm">
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 mt-1.5 ${bucketColor(madBucket(test.mad))}`}
          />
          <span className="font-medium">
            {t(`benford_bucket_${madBucket(test.mad)}`)}
          </span>
        </div>
      )}
      <p className="text-xs text-muted-foreground leading-relaxed mt-3">
        {t("benford_interpretation")}
      </p>
    </div>
  );
};
