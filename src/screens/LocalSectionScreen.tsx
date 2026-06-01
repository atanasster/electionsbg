// Per-polling-station (section) local-elections page.
// Route: /local/:cycle/:obshtinaCode/section/:sectionCode
//
// Local section data is council-only (the per-station mayor ballot isn't in the
// ingested bundle), so this is a focused page: turnout + the full council
// party-vote breakdown for one station. No parliamentary cross-link — section
// numbering isn't stable across local↔parliamentary cycles, so the same code
// wouldn't reliably resolve to the matching parliamentary station.

import { FC, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalSections } from "@/data/local/useLocalSections";
import { RankedBar } from "@/screens/components/local/LocalRankedBar";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { formatThousands } from "@/data/utils";

export const LocalSectionScreen: FC = () => {
  const { cycle, obshtinaCode, sectionCode } = useParams<{
    cycle: string;
    obshtinaCode: string;
    sectionCode: string;
  }>();
  const { t } = useTranslation();
  const { shard } = useLocalSections(obshtinaCode, cycle, true);

  const partyById = useMemo(() => {
    const m = new Map<number, { name: string; color: string }>();
    for (const p of shard?.parties ?? [])
      m.set(p.localPartyNum, { name: p.localPartyName, color: p.color });
    return m;
  }, [shard]);

  const section = useMemo(
    () => shard?.sections.find((s) => s.sectionCode === sectionCode),
    [shard, sectionCode],
  );

  const bars = useMemo(() => {
    if (!section) return [];
    return [...section.partyVotes]
      .sort((a, b) => b.votes - a.votes)
      .map((pv) => ({
        ...pv,
        meta: partyById.get(pv.localPartyNum),
      }));
  }, [section, partyById]);

  if (!cycle || !obshtinaCode || !sectionCode) return null;

  const back = (
    <div className="mb-2 text-xs text-muted-foreground">
      <Link to={`/local/${cycle}`} className="hover:underline">
        {t("local_election_screen_back")}
      </Link>
      <span className="mx-2">·</span>
      <Link to={`/local/${cycle}/${obshtinaCode}`} className="hover:underline">
        {shard?.obshtinaName ?? obshtinaCode}
      </Link>
      <span className="mx-2">·</span>
      <span>{friendlyCycleDate(cycle)}</span>
    </div>
  );

  if (shard && !section) {
    return (
      <main className="container mx-auto px-4 py-6">
        {back}
        <h1 className="mb-1 text-2xl font-semibold">
          {t("local_section_page_title", { code: sectionCode })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("local_section_not_found")}
        </p>
      </main>
    );
  }

  const turnoutPct =
    section && section.numRegisteredVoters > 0
      ? (section.totalActualVoters / section.numRegisteredVoters) * 100
      : null;
  const leaderVotes = bars[0]?.votes ?? 0;

  return (
    <main className="container mx-auto px-4 py-6">
      {back}
      <h1 className="mb-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tabular-nums">
        {t("local_section_page_title", { code: sectionCode })}
        {section?.isMobile ? (
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("local_sections_mobile_badge")}
          </span>
        ) : null}
      </h1>
      {section ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {section.settlement}
        </p>
      ) : null}

      {/* Stat header. */}
      {section ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("local_election_stat_turnout")}
            </div>
            <div className="mt-1 text-base font-semibold tabular-nums">
              {turnoutPct != null ? `${turnoutPct.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("local_sections_th_voted")}
            </div>
            <div className="mt-1 text-base font-semibold tabular-nums">
              {formatThousands(section.totalActualVoters)}
              <span className="text-xs font-normal text-muted-foreground">
                {" / "}
                {formatThousands(section.numRegisteredVoters)}
              </span>
            </div>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("local_election_stat_valid_votes")}
            </div>
            <div className="mt-1 text-base font-semibold tabular-nums">
              {formatThousands(section.numValidVotes)}
            </div>
          </div>
        </div>
      ) : null}

      {/* Council party-vote breakdown. */}
      <h2 className="mb-3 text-lg font-semibold">
        {t("local_section_council_votes")}
      </h2>
      {section ? (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <ul>
            {bars.map((b) => (
              <RankedBar
                key={b.localPartyNum}
                label={b.meta?.name ?? `#${b.localPartyNum}`}
                value={b.votes}
                pct={
                  section.numValidVotes > 0
                    ? (b.votes / section.numValidVotes) * 100
                    : 0
                }
                leaderValue={leaderVotes}
                color={b.meta?.color ?? "#9ca3af"}
              />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      )}
    </main>
  );
};
