// Campaign self-funding on the merged person dashboard: the selected cycle's figure, and the
// person's whole self-funding HISTORY beside it.
//
// The history is possible here and nowhere else. `person_elections()` returns one row per
// candidacy with that cycle's ЕРИК figures, so the person's rows ARE the series — no second
// fetch, no aggregation. The legacy candidate body has no resolved person and therefore no
// rows, which is why the history is person-only rather than shared through
// `CandidateElectoralBody` (docs/plans/person-candidate-display-unification-v1.md §1.2).
//
// ⚠️ THREE cycles publish campaign financing at all — 2024_06_09, 2024_10_27, 2026_04_19 —
// so this is a three-point list at most, and a cycle that publishes none is labelled as such
// rather than shown as €0. `hasFinancials` per cycle comes from the elections table already
// in the bundle (`ElectionContext.stats`), so the distinction costs no request.
//
// ⚠️ AND A ZERO IS NEVER RENDERED AS „gave nothing". 10 filing rows / €7,284.85 across 7
// candidates do not attribute, because ЕРИК spells their name shorter than the ballot does
// (a missing patronymic, or hyphen spacing) — €5,155 of that is one prominent politician's.
// So absence of a figure is absence of an ATTRIBUTION, not a statement about the person, and
// a cycle with no attributed rows is simply not listed.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, Coins } from "lucide-react";
import { useElectionContext } from "@/data/ElectionContext";
import type { PersonElectionRow } from "@/data/dashboard/usePersonElections";
import { dottedDate } from "@/data/utils";
import { money } from "@/screens/dashboard/moneyCell";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import type { DashboardSectionId } from "@/data/articles/useArticles";
import { CandidateDonationsTile } from "@/screens/dashboard/CandidateDonationsTile";
import { StatCard } from "@/screens/dashboard/StatCard";

type Props = {
  /** The person's rows, newest first — the same payload the electoral block reads. */
  rows: PersonElectionRow[];
  /** The cycle the electoral block's selector points at. */
  selectedCycle: string;
  name: string;
  /** The candidate slug for the selected cycle, for the drill-down link. */
  linkSlug?: string;
  /** The „Свързани анализи" topic, passed IN rather than declared here.
   *
   *  A rail only behaves when its section is a descendant of a `SectionArticlesProvider`, and
   *  a topic declared across a component boundary cannot say whether it is — outside one the
   *  strip silently falls back to filtering per section, against the HEADER's cycle, and can
   *  double-list an article the provider already placed elsewhere. So the caller that owns the
   *  provider owns the topic too, and all three declarations sit in one file. */
  articleTopic?: DashboardSectionId;
};

/** One row per cycle the person declared self-funding in, newest first — cash and in-kind
 *  kept apart, because the mix swings from 48% to 3% between cycles and a combined figure
 *  reads as money given. */
/** Whether a cycle has anything for the tile to draw.
 *
 *  ⚠️ The ARRAY, not `donationCount`. `DashboardSection` cannot see through a component
 *  boundary, so this file must gate on the same predicate the tile hides on
 *  (`if (!data?.length) return null`) or the „САМОФИНАНСИРАНЕ" heading paints above nothing.
 *  The two agree in the corpus today (0 of 66,977 rows have a count that disagrees with the
 *  array) — but that invariant lives in the loader, and this component has no reason to
 *  depend on it. */
const funded = (r: PersonElectionRow): boolean =>
  (r.donations?.length ?? 0) > 0;

const History: FC<{ rows: PersonElectionRow[] }> = ({ rows }) => {
  const { t } = useTranslation();
  // Sorted here rather than trusted from the payload. 085 does order it newest-first, but
  // `personDataCycles` re-sorts the SAME array rather than relying on that, so the codebase
  // already treats the order as not-a-contract — and nothing would fail if it changed.
  const withRows = rows
    .filter(funded)
    .sort((a, b) => b.election.localeCompare(a.election));
  // A single point is the figure already on the card above it, not a history.
  if (withRows.length < 2) return null;
  return (
    <StatCard
      hint={t("pp_self_funding_history_hint")}
      label={
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4" />
          <span>{t("pp_self_funding_history")}</span>
        </div>
      }
    >
      <div
        // Named so a test can scope to the history rather than to the identically-headed
        // columns inside the donations tile above it.
        data-testid="self-funding-history"
        className="mt-2 grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-x-3 gap-y-1.5 text-sm"
      >
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("elections")}
        </span>
        {/* Visually unlabelled — the „N вноски" column reads as a caption beside the date —
            but a screen reader announces „1 вноска" with no context otherwise.
            ⚠️ Its OWN key, not the plural suffix: `t("pp_self_funding_rows_other")` returns
            „{{count}} вноски" verbatim when called without a count (verified on i18next
            24.2.3), so a screen reader was announcing the raw placeholder. */}
        <span className="sr-only">{t("pp_self_funding_rows_label")}</span>
        <span className="text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("monetary")}
        </span>
        <span className="text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("non_monetary")}
        </span>
        {withRows.map((r) => (
          <div key={r.election} className="contents">
            <span className="tabular-nums">{dottedDate(r.election)}</span>
            <span className="text-xs text-muted-foreground">
              {t("pp_self_funding_rows", { count: r.donationCount })}
            </span>
            <span className="text-right font-semibold tabular-nums">
              {money(r.donatedMonetaryEur)} {t("lv")}
            </span>
            <span className="text-right tabular-nums text-muted-foreground">
              {money(r.donatedNonMonetaryEur)} {t("lv")}
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};

export const PersonSelfFunding: FC<Props> = ({
  rows,
  selectedCycle,
  name,
  linkSlug,
  articleTopic,
}) => {
  const { t } = useTranslation();
  const { stats } = useElectionContext();
  const selected = rows.find((r) => r.election === selectedCycle);
  const anyRows = rows.some(funded);
  // Nothing attributed anywhere: render no section at all. NOT a €0 — see the file header.
  if (!anyRows) return null;
  // Whether the SELECTED cycle publishes financing, from the elections table already in the
  // bundle. Distinguishes „this vote publishes no campaign financing" from „nothing was
  // declared", which a bare absence cannot.
  //
  // ⚠️ THREE states, not two. A cycle absent from the elections table is UNKNOWN, and `!!`
  // would fold it into „the register publishes nothing" — an assertion about a public
  // register derived from a failed lookup, which is the same defect one level up from the one
  // this file exists to avoid. Unreachable today (all 10 cycles in person_election_stats
  // resolve), but `stats` carries only the PARLIAMENTARY table while the loader keys on
  // whatever cycles the shard tree holds.
  const cycle = stats?.find((e) => e.name === selectedCycle);
  const emptyMessage = !cycle
    ? null
    : cycle.hasFinancials
      ? t("pp_self_funding_none", { date: dottedDate(selectedCycle) })
      : t("pp_self_funding_unpublished", { date: dottedDate(selectedCycle) });

  return (
    <DashboardSection
      id="person-self-funding"
      title={t("pp_self_funding")}
      // `Banknote`, matching the tile inside it — „Дарения" keeps `Coins`. The point of
      // naming the two facts apart is lost if their headings are visually identical ~300px
      // from each other.
      icon={Banknote}
      articleTopic={articleTopic}
      headingLevel={2}
    >
      {selected && funded(selected) ? (
        <CandidateDonationsTile
          name={name}
          linkSlug={linkSlug}
          rows={selected.donations}
          election={selectedCycle}
        />
      ) : emptyMessage ? (
        <p className="rounded-lg bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : null}
      <History rows={rows} />
    </DashboardSection>
  );
};
