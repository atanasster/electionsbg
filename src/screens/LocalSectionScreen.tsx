// Per-polling-station (section) local-elections page.
// Route: /local/:cycle/:obshtinaCode/section/:sectionCode
//
// Local section data is council-only (the per-station mayor ballot isn't in the
// ingested bundle), so this is a focused page: turnout + the full council
// party-vote breakdown for one station. No parliamentary cross-link — section
// numbering isn't stable across local↔parliamentary cycles, so the same code
// wouldn't reliably resolve to the matching parliamentary station.

import { FC, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalSection } from "@/data/local/useLocalSection";
import { RankedBar } from "@/screens/components/local/LocalRankedBar";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { formatThousands } from "@/data/utils";
import { PlaceHeader } from "@/screens/components/PlaceHeader";

export const LocalSectionScreen: FC = () => {
  const { cycle, obshtinaCode, sectionCode } = useParams<{
    cycle: string;
    obshtinaCode: string;
    sectionCode: string;
  }>();
  const { t } = useTranslation();
  // The per-station detail file carries this one section's full breakdown — a
  // tiny fetch, not the whole município shard.
  const { detail, isLoading } = useLocalSection(
    obshtinaCode,
    sectionCode,
    cycle,
  );

  const partyById = useMemo(() => {
    const m = new Map<number, { name: string; color: string }>();
    for (const p of detail?.parties ?? [])
      m.set(p.localPartyNum, { name: p.localPartyName, color: p.color });
    return m;
  }, [detail]);

  const section = detail?.section;
  // The local section bundle stores EKATTE with leading zeros stripped
  // ("151"), but settlements.json — and every other view's URL — keys on the
  // 5-digit padded form ("00151"). Pad it so the breadcrumb resolves the parent
  // settlement (and its município) and the up-links land on real pages.
  const ekatte = section?.ekatte
    ? section.ekatte.includes("-")
      ? section.ekatte
      : section.ekatte.padStart(5, "0")
    : undefined;

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

  // Unified place header — eyebrow links back to the cycle overview, the
  // breadcrumb drills up the settlement → município → oblast chain, and the
  // Parliamentary pill drops to the parent settlement (section codes don't map
  // across cycles). The mobile-station badge rides in the extra slot.
  const header = (
    <PlaceHeader
      active="local"
      level="section"
      sectionCode={sectionCode}
      ekatte={ekatte}
      obshtina={obshtinaCode}
      cycle={cycle}
      eyebrowTo={`/local/${cycle}`}
      eyebrowSuffix={friendlyCycleDate(cycle)}
      extra={
        section?.isMobile ? (
          <span className="inline-flex rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("local_sections_mobile_badge")}
          </span>
        ) : undefined
      }
      className="mb-4"
    />
  );

  if (!isLoading && !section) {
    return (
      <section className="my-4">
        {header}
        <p className="text-sm text-muted-foreground">
          {t("local_section_not_found")}
        </p>
      </section>
    );
  }

  const turnoutPct =
    section && section.numRegisteredVoters > 0
      ? (section.totalActualVoters / section.numRegisteredVoters) * 100
      : null;
  const leaderVotes = bars[0]?.votes ?? 0;

  return (
    <section className="my-4">
      {header}

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
    </section>
  );
};
