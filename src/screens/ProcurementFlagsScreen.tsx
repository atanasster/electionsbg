// /procurement/flags — public red-flag feed. Surfaces the procurement risk
// signals we already compute, aggregated into one accountability view: debarred
// suppliers still winning work, buyers whose spend is concentrated on a single
// supplier (full searchable/sortable table in ConcentrationSection, id=
// "concentration"), and the largest MP-tied contractor relationships. DB-backed
// (useRiskFeed + useDebarred + ConcentrationSection's own fetch), scoped to the
// selected parliament window or the full corpus (?pscope).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Ban, Link as LinkIcon } from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useDebarred } from "@/data/procurement/useDebarred";
import { useRiskFeed } from "@/data/procurement/useRiskFeed";
import { formatEur } from "@/lib/currency";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { ConcentrationOblastTiles } from "@/screens/components/procurement/ConcentrationOblastTiles";
import { ConcentrationSection } from "@/screens/components/procurement/ConcentrationSection";
import { useHashScroll } from "@/ux/useHashScroll";

const numFmt = new Intl.NumberFormat("bg-BG");

// Summary metric tile — gives the reader the scale of each signal before the
// ranked excerpts below.
const StatTile: FC<{ label: string; value: string; sub?: string }> = ({
  label,
  value,
  sub,
}) => (
  <div className="rounded-md bg-muted/50 p-3">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</div>
    {sub ? (
      <div className="text-xs text-muted-foreground tabular-nums">{sub}</div>
    ) : null}
  </div>
);

// "top N of TOTAL" — set the reader's expectation that the list is a ranked
// excerpt, not the whole flagged universe.
const ShownOf: FC<{ shown: number; total?: number }> = ({ shown, total }) => {
  const { t } = useTranslation();
  if (!total || total <= shown) return null;
  return (
    <span className="text-xs text-muted-foreground font-normal tabular-nums">
      {(t("flags_shown_of") || "top {{shown}} of {{total}}")
        .replace("{{shown}}", numFmt.format(shown))
        .replace("{{total}}", numFmt.format(total))}
    </span>
  );
};

export const ProcurementFlagsScreen: FC = () => {
  const { t } = useTranslation();
  const { debarred } = useDebarred();
  const { data: feed } = useRiskFeed();
  useHashScroll();

  const today = new Date().toISOString().slice(0, 10);
  // Debarred suppliers whose ban is still active.
  const activeDebarred = debarred.list
    .filter((d) => !d.debarredUntil || d.debarredUntil >= today)
    .sort((a, b) => (a.debarredUntil < b.debarredUntil ? 1 : -1))
    .slice(0, 20);

  const topMp = (feed?.topMpTied ?? []).slice(0, 20);

  return (
    <>
      <Title
        description={
          t("flags_desc") ||
          "Procurement red flags across the corpus: debarred suppliers, single-supplier concentration, and MP-tied contractors."
        }
      >
        {t("flags_title") || "Procurement red flags"}
      </Title>
      <ProcurementSectionHeader current="flags_nav" scopeMode="toggle" />
      <section aria-label="procurement flags" className="my-4 space-y-4">
        <p className="text-xs text-muted-foreground">
          {t("flags_intro") ||
            "Signals worth a second look — each is a public-record fact, not an accusation."}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile
            label={t("flags_concentration") || "Single-supplier concentration"}
            value={numFmt.format(feed?.concentrationTotal ?? 0)}
            sub={
              feed?.concentration100Total
                ? `${numFmt.format(feed.concentration100Total)} ${
                    t("flags_at_full_share") || "at 100%"
                  }`
                : undefined
            }
          />
          <StatTile
            label={t("flags_mp_tied") || "Largest MP-tied contractors"}
            value={numFmt.format(feed?.mpTiedTotal ?? 0)}
          />
          <StatTile
            label={t("flags_connected_people") || "Connected people"}
            value={numFmt.format(feed?.connectedPeopleTotal ?? 0)}
            sub={t("flags_connected_people_sub") || "MPs + officials"}
          />
          <StatTile
            label={t("flags_debarred") || "Debarred suppliers (active ban)"}
            value={numFmt.format(activeDebarred.length)}
          />
        </div>

        {feed?.concentrationByOblast &&
        feed.concentrationByOblast.length > 0 ? (
          <Card>
            <CardContent className="p-3 md:p-4">
              <ConcentrationOblastTiles
                byOblast={feed.concentrationByOblast}
                nationalCount={feed.concentrationNationalCount ?? 0}
              />
            </CardContent>
          </Card>
        ) : null}

        <ConcentrationSection />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-2 flex-wrap">
                <LinkIcon className="h-4 w-4 text-amber-600" />
                {t("flags_mp_tied") || "Largest MP-tied contractors"}
                <ShownOf shown={topMp.length} total={feed?.mpTiedTotal} />
              </span>
              <Link
                to="/procurement/mps"
                className="text-[10px] normal-case text-primary hover:underline"
              >
                {(
                  t("flags_mp_tied_search_all") ||
                  "Search all {{count}} connected politicians & officials"
                ).replace(
                  "{{count}}",
                  numFmt.format(feed?.connectedPeopleTotal ?? 0),
                )}{" "}
                →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            <ul className="flex flex-col">
              {topMp.map((e) => (
                <li
                  key={`${e.mpId}|${e.contractorEik}`}
                  className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-sm"
                >
                  <Link
                    to={`/company/${e.contractorEik}`}
                    className="min-w-0 flex-1 truncate hover:underline font-medium"
                  >
                    {e.contractorName}
                  </Link>
                  <Link
                    to={`/candidate/mp-${e.mpId}/procurement`}
                    className="text-xs text-muted-foreground shrink-0 hover:underline hidden sm:inline"
                  >
                    {e.mpName}
                  </Link>
                  <span className="tabular-nums text-xs shrink-0 min-w-[90px] text-right font-medium">
                    {formatEur(e.totalEur)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Ban className="h-4 w-4 text-red-600" />
              {t("flags_debarred") || "Debarred suppliers (active ban)"}
              <span className="text-xs text-muted-foreground font-normal">
                {numFmt.format(activeDebarred.length)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            {activeDebarred.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("flags_debarred_empty") || "No active debarments on record."}
              </p>
            ) : (
              <ul className="flex flex-col">
                {activeDebarred.map((d, idx) => (
                  <li
                    key={`${d.nameNormalized}-${idx}`}
                    className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {t("flags_debarred_until") || "until"}{" "}
                      {d.debarredUntil || "—"}
                    </span>
                    {d.detailsUrl ? (
                      <a
                        href={d.detailsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:underline shrink-0"
                      >
                        {t("flags_debarred_decision") || "decision"}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
};
