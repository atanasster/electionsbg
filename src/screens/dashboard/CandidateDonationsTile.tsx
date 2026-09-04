import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Banknote } from "lucide-react";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { FinancingFromCandidates } from "@/data/dataTypes";
import { formatThousands } from "@/data/utils";
import { money } from "./moneyCell";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";
import { dataUrl } from "@/data/dataUrl";

const TOP_N = 10;

type CandidateDonation = Omit<FinancingFromCandidates, "name">;

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined]
>): Promise<CandidateDonation[] | null> => {
  if (!queryKey[1] || !queryKey[2]) return null;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/candidates/${queryKey[2]}/donations.json`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

type Props = {
  name: string;
  linkSlug?: string;
  /** Rows from the PG payload (`person_elections()` → `donations`), for the surface that has
   *  a resolved person. When given, nothing is fetched: the name-keyed shard this tile
   *  otherwise reads is one file per NAME, so on a shared name it renders two people's
   *  self-funding as one person's — the defect the person layer re-keys these figures to
   *  avoid (docs/plans/person-candidate-display-unification-v1.md §3). The legacy
   *  candidate body has no resolved person and keeps the fetch. */
  rows?: CandidateDonation[];
  /** The cycle these rows describe. Only used for the drill-down link, which needs the
   *  sub-page to open on the same cycle rather than on the header's. */
  election?: string;
};

/** The fetching arm — the name-keyed shard, for the surface with no resolved person.
 *
 *  A separate component so the payload path calls no react-query hook AT ALL. `enabled:
 *  false` still requires a QueryClientProvider up the tree, which would make "nothing is
 *  fetched" true of the network and false of the component: the person dashboard would carry
 *  a dependency on a fetch layer it does not use, and so would every test of it. */
const FetchedDonations: FC<Omit<Props, "rows">> = (props) => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["candidate_donations_tile", selected, props.name],
    queryFn,
  });
  return <DonationsCard {...props} rows={data ?? undefined} />;
};

export const CandidateDonationsTile: FC<Props> = ({ rows, ...props }) =>
  rows ? (
    <DonationsCard {...props} rows={rows} />
  ) : (
    <FetchedDonations {...props} />
  );

const DonationsCard: FC<Props> = ({ name, linkSlug, rows, election }) => {
  const { t } = useTranslation();
  const data = rows;

  const summary = useMemo(() => {
    if (!data?.length) return undefined;
    const monetary = data.reduce((s, d) => s + (d.monetary ?? 0), 0);
    const nonMonetary = data.reduce((s, d) => s + (d.nonMonetary ?? 0), 0);
    const total = monetary + nonMonetary;
    const sorted = [...data]
      .map((d) => ({
        ...d,
        amount: (d.monetary ?? 0) + (d.nonMonetary ?? 0),
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, TOP_N);
    const maxAmount = sorted[0]?.amount ?? 1;
    return {
      monetary,
      nonMonetary,
      total,
      count: data.length,
      rows: sorted.map((d) => ({
        ...d,
        barPct: (d.amount / maxAmount) * 100,
      })),
    };
  }, [data]);

  if (!summary) return null;
  const candidateSlug = linkSlug ?? encodeURIComponent(name);

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint
            text={t("dashboard_candidate_donations_hint")}
            underline={false}
          >
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              {/* „Самофинансиране", not „Дарения". This is money the candidate GAVE to
                  their own party's campaign — the person dashboard's „Дарения" block is the
                  other direction (they appear in a party's donor list) and the two carried
                  the same word. */}
              <span>{t("self_funding")}</span>
            </div>
          </Hint>
          {summary.count > TOP_N ? (
            <Link
              to={
                election
                  ? {
                      pathname: `/candidate/${candidateSlug}/donations`,
                      search: { elections: election },
                    }
                  : `/candidate/${candidateSlug}/donations`
              }
              className="text-[10px] normal-case text-primary hover:underline"
              underline={false}
            >
              {t("dashboard_see_details")} →
            </Link>
          ) : null}
        </div>
      }
      className="overflow-hidden"
    >
      <div className="flex items-baseline gap-3 mt-1">
        {/* The COMBINED figure, deliberately — the hint says so. The split beneath it is
            not decoration: in-kind is 48% of one cycle's corpus total and 3% of another's,
            so „€X дарени" alone would read as money given. */}
        <span className="text-2xl font-bold tabular-nums">
          {money(summary.total)} {t("lv")}
        </span>
        {/* „1 вноска" / „2 вноски" — a plural key, and „вноска" rather than „дарение":
            this is the candidate's own contribution to their party's campaign. Read
            „1 дарения" before. */}
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("pp_self_funding_rows", { count: summary.count })}
        </span>
      </div>
      {/* Each basis NAMED and unsummed — this line is what keeps the headline above it from
          reading as cash. Only the bases that carry money: `formatThousands(0)` returns an
          EMPTY STRING, so the previous unconditional pair rendered „511 парични ·
          непарични" — a label with no number, which reads as a missing value, not as zero. */}
      <div className="text-xs text-muted-foreground tabular-nums">
        {[
          summary.monetary
            ? `${formatThousands(summary.monetary)} ${t("monetary").toLowerCase()}`
            : null,
          summary.nonMonetary
            ? `${formatThousands(summary.nonMonetary)} ${t("non_monetary").toLowerCase()}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <div className="grid grid-cols-[auto_minmax(80px,1.5fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-3 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("date")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("monetary")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("non_monetary")}
        </span>
        {summary.rows.map((d, i) => (
          <div key={`don_${i}`} className="contents">
            <span className="text-xs tabular-nums text-muted-foreground">
              {d.date ?? "—"}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(2, d.barPct)}%` }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {money(d.monetary)}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {money(d.nonMonetary)}
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
