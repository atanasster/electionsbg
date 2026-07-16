// Cross-corpus leaderboard for /funds — companies that both won ЗОП procurement
// contracts AND drew EU-funds (ИСУН) grants, ranked by combined public money.
// The national analogue of the per-entity join the /company/:eik page already
// shows (procurement tile + CompanyFundsTile side by side): here every row is a
// firm present in both corpora, with the ЗОП / ЕС split spelled out so the
// "double-dipping" is legible. Fed by useDualCorpusRankings (DB, all-time).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { orgTypeLabel } from "@/data/funds/orgLabels";
import {
  useDualCorpusRankings,
  type DualCorpusRow,
} from "@/data/funds/useDualCorpusRankings";

const numFmt = new Intl.NumberFormat("bg-BG");
const ROWS_SHOWN = 15;

const HeadlineStat: FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div className="flex flex-col">
    <span className="text-lg font-bold tabular-nums leading-tight">
      {value}
    </span>
    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
  </div>
);

const Row: FC<{ rank: number; row: DualCorpusRow }> = ({ rank, row }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
      <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
        {rank}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link
            to={`/company/${row.eik}`}
            className="font-medium hover:underline"
          >
            {decodeEntities(row.name)}
          </Link>
          {row.orgType ? (
            <span className="text-xs text-muted-foreground">
              {orgTypeLabel(row.orgType, lang)}
            </span>
          ) : null}
          {row.mpTied ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {t("funds_mp_badge") || "MP-connected"}
            </span>
          ) : null}
        </div>
        {/* ЗОП / ЕС split — the whole point of the tile. */}
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
          <span>
            {t("dual_corpus_zop_short") || "ЗОП"}{" "}
            {formatEur(row.procurementEur, lang)}
            <span className="text-muted-foreground/60">
              {" "}
              ({numFmt.format(row.procurementCount)})
            </span>
          </span>
          <span>
            {t("dual_corpus_eu_short") || "ЕС"}{" "}
            {formatEur(row.fundsContractedEur, lang)}
            <span className="text-muted-foreground/60">
              {" "}
              ({numFmt.format(row.fundsProjects)})
            </span>
          </span>
        </div>
      </div>
      <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
        {formatEur(row.combinedEur, lang)}
      </span>
    </li>
  );
};

export const DualCorpusLeaderboardTile: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data } = useDualCorpusRankings();

  if (!data || data.rows.length === 0) return null;

  const visible = data.rows.slice(0, ROWS_SHOWN);

  return (
    <Card>
      <CardContent className="space-y-3 p-3 md:p-4">
        {/* Headline strip over the full intersection (not just the shown rows). */}
        <div className="flex flex-wrap gap-x-8 gap-y-2 border-b pb-3">
          <HeadlineStat
            label={t("dual_corpus_companies") || "Фирми"}
            value={numFmt.format(data.companyCount)}
          />
          <HeadlineStat
            label={t("dual_corpus_combined") || "Общо публични средства"}
            value={formatEurCompact(data.combinedEur, lang)}
          />
          <HeadlineStat
            label={t("dual_corpus_grants_short") || "от които грантове"}
            value={formatEurCompact(data.fundsContractedEur, lang)}
          />
          {data.mpTiedCount > 0 ? (
            <HeadlineStat
              label={t("dual_corpus_mp_tied") || "свързани с депутати"}
              value={numFmt.format(data.mpTiedCount)}
            />
          ) : null}
        </div>

        <ul className="flex flex-col divide-y divide-border text-sm">
          {visible.map((r, i) => (
            <Row key={r.eik} rank={i + 1} row={r} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
