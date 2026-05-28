// National chronological feed of extraordinary local elections (chmi +
// nov). Surfaces from /local/chmi — the cycle overview links here, and
// individual município tiles point users in this direction.
//
// Per the design choice partials never appear in the elections dropdown,
// so this screen is the single national entry point for partial-elections
// reporting.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useChmiHistoryAll } from "@/data/local/useChmiHistory";
import type { ChmiHistoryEvent } from "@/data/local/useChmiHistory";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";

type KindFilter = "all" | ChmiHistoryEvent["kind"];

const KIND_LABEL_KEY: Record<ChmiHistoryEvent["kind"], string> = {
  obshtina_mayor: "local_election_chmi_kind_obshtina",
  kmetstvo_mayor: "local_election_chmi_kind_kmetstvo",
  rayon_mayor: "local_election_chmi_kind_rayon",
};

const KIND_TONE: Record<ChmiHistoryEvent["kind"], string> = {
  obshtina_mayor: "border-red-500/40 bg-red-50 text-red-700",
  kmetstvo_mayor: "border-blue-500/40 bg-blue-50 text-blue-700",
  rayon_mayor: "border-purple-500/40 bg-purple-50 text-purple-700",
};

const KindBadge: FC<{ kind: ChmiHistoryEvent["kind"] }> = ({ kind }) => {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${KIND_TONE[kind]}`}
    >
      {t(KIND_LABEL_KEY[kind])}
    </span>
  );
};

export const ChmiFeedScreen: FC = () => {
  const { t } = useTranslation();
  const { data: history } = useChmiHistoryAll();
  const { colorFor } = useCanonicalParties();
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const events = useMemo(() => history?.allEvents ?? [], [history]);
  const filtered = useMemo(() => {
    if (kindFilter === "all") return events;
    return events.filter((e) => e.kind === kindFilter);
  }, [events, kindFilter]);

  const summary = useMemo(() => {
    if (events.length === 0) return null;
    const munis = new Set(events.map((e) => e.obshtinaCode)).size;
    const dates = events.map((e) => e.date).sort();
    return {
      count: events.length,
      munis,
      from: dates[0],
      to: dates[dates.length - 1],
    };
  }, [events]);

  const kindCounts = useMemo(() => {
    const counts: Record<ChmiHistoryEvent["kind"], number> = {
      obshtina_mayor: 0,
      kmetstvo_mayor: 0,
      rayon_mayor: 0,
    };
    for (const e of events as ChmiHistoryEvent[]) counts[e.kind]++;
    return counts;
  }, [events]);

  return (
    <main className="container mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("chmi_feed_title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-prose">
        {t("chmi_feed_intro")}
      </p>
      {summary ? (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {t("chmi_feed_summary", {
            events: summary.count,
            munis: summary.munis,
            from: summary.from,
            to: summary.to,
          })}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(
          [
            ["all", t("chmi_feed_filter_all"), events.length],
            [
              "obshtina_mayor",
              t("local_election_chmi_kind_obshtina"),
              kindCounts.obshtina_mayor,
            ],
            [
              "kmetstvo_mayor",
              t("local_election_chmi_kind_kmetstvo"),
              kindCounts.kmetstvo_mayor,
            ],
            [
              "rayon_mayor",
              t("local_election_chmi_kind_rayon"),
              kindCounts.rayon_mayor,
            ],
          ] as const
        ).map(([key, label, count]) => {
          const active = kindFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setKindFilter(key)}
              className={`rounded-md border px-2 py-1 text-xs font-medium tabular-nums ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground hover:bg-accent"
              }`}
            >
              {label} · {count}
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
            <tr>
              <th className="py-2 px-3 text-left w-28">
                {t("chmi_feed_th_date")}
              </th>
              <th className="py-2 px-3 text-left w-36">
                {t("chmi_feed_th_kind")}
              </th>
              <th className="py-2 px-3 text-left">
                {t("chmi_feed_th_municipality")}
              </th>
              <th className="py-2 px-3 text-left">{t("chmi_feed_th_seat")}</th>
              <th className="py-2 px-3 text-left">
                {t("chmi_feed_th_winner")}
              </th>
              <th className="py-2 px-3 text-left">{t("chmi_feed_th_party")}</th>
              <th className="py-2 px-3 text-right w-16">%</th>
            </tr>
          </thead>
          <tbody>
            {(filtered as ChmiHistoryEvent[]).map((e, i) => {
              const color = e.primaryCanonicalId
                ? colorFor(e.primaryCanonicalId)
                : undefined;
              return (
                <tr
                  key={`${e.cycle}-${e.obshtinaCode}-${e.kmetstvoName ?? "main"}-${i}`}
                  className="border-b last:border-b-0"
                >
                  <td className="py-2 px-3 tabular-nums text-muted-foreground">
                    {e.date}
                  </td>
                  <td className="py-2 px-3">
                    <KindBadge kind={e.kind} />
                  </td>
                  <td className="py-2 px-3">
                    <Link
                      to={`/settlement/${e.obshtinaCode}`}
                      className="font-medium hover:underline"
                    >
                      {e.obshtinaName}
                    </Link>
                  </td>
                  <td className="py-2 px-3 text-muted-foreground">
                    {e.kmetstvoName ?? "—"}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <MpAvatar name={e.candidateName} showPartyRing={false} />
                      <span>{e.candidateName}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-muted-foreground">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {color ? (
                        <span
                          aria-hidden
                          className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
                          style={{ backgroundColor: color }}
                        />
                      ) : null}
                      <span className="truncate" title={e.localPartyName}>
                        {e.localPartyName}
                      </span>
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {e.pctOfValid.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
};
