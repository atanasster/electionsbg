import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ExternalLink, ListOrdered } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { ElectionAccuracy, Poll, PollDetail } from "@/data/polls/pollsTypes";
import { localDate } from "@/data/utils";

type Props = {
  polls: Poll[];
  details: PollDetail[];
  elections: ElectionAccuracy[];
};

const isoToLocalDate = (iso: string | null): string => {
  if (!iso) return "—";
  return localDate(iso.replace(/-/g, "_"));
};

// Mirror analyze_accuracy.ts so the actual % we display matches the value used
// in the MAE computation. Polled labels ("Прогресивна България", "ГЕРБ – СДС")
// differ from the canonical actual-result keys ("ПрБ", "ГЕРБ-СДС").
const normKey = (s: string) =>
  s
    .normalize("NFC")
    .replace(/\s*[–—-]\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const POLL_TO_ACTUAL: Record<string, string> = {
  "Прогресивна България": "ПрБ",
  "БСП за България": "БСП",
  "Коалиция за България (БСП)": "БСП",
  "Демократична България": "ДБ",
  "Алианс за права и свободи": "АПС",
  "Български възход": "БВ",
  "Обединени патриоти": "ОП",
  "Изправи се БГ! Ние идваме": "ИСМВ",
  "Изправи се! Мутри вън!": "ИСМВ",
  "Изправи се.БГ": "ИСМВ",
  "Реформаторски блок-Глас народен": "РБ",
  "Реформаторски блок": "РБ",
  "Патриотичен фронт": "ПФ",
  "България без цензура": "ББЦ",
  Воля: "Воля",
};

const resolveActualKey = (
  polledBg: string,
  actualKeys: Set<string>,
): string | null => {
  const direct = POLL_TO_ACTUAL[polledBg.trim()];
  if (direct && actualKeys.has(direct)) return direct;
  const norm = normKey(polledBg);
  if (actualKeys.has(norm)) return norm;
  if (norm === "ДПС-НН" && actualKeys.has("ДПС")) return "ДПС";
  if (norm === "ДПС" && actualKeys.has("ДПС-НН")) return "ДПС-НН";
  if (norm === "БСП" && actualKeys.has("БСП-ОЛ")) return "БСП-ОЛ";
  if (norm === "БСП-ОЛ" && actualKeys.has("БСП")) return "БСП";
  return null;
};

// Try to extract a fieldwork end date from the free-text "fieldwork" field
// (e.g., "Mar 13-19 2026") so polls can be sorted reliably newest-first.
const fieldworkEndKey = (fieldwork: string): number => {
  const m = fieldwork.match(
    /\b(\d{1,2})(?:[-–]\s*\d{1,2})?\s+([A-Za-z]+)\s+(\d{4})\b/,
  );
  if (m) {
    const day = parseInt(m[1], 10);
    const monthName = m[2];
    const year = parseInt(m[3], 10);
    const months = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const idx = months.indexOf(monthName.slice(0, 3).toLowerCase());
    if (idx >= 0) return new Date(year, idx, day).getTime();
  }
  return 0;
};

export const AgencyPollsList: FC<Props> = ({ polls, details, elections }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";

  const detailsByPoll = useMemo(() => {
    const m = new Map<string, PollDetail[]>();
    for (const d of details) {
      const arr = m.get(d.pollId);
      if (arr) arr.push(d);
      else m.set(d.pollId, [d]);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.support - a.support);
    return m;
  }, [details]);

  // For each election, both the pct map AND the set of valid keys (used by the
  // poll-label resolver to disambiguate ДПС / ДПС-НН etc.).
  const actualByElection = useMemo(() => {
    const m = new Map<
      string,
      { pct: Map<string, number>; keys: Set<string> }
    >();
    for (const e of elections) {
      const pct = new Map<string, number>();
      const keys = new Set<string>();
      for (const r of e.actualResults) {
        pct.set(r.key, r.pct);
        keys.add(r.key);
      }
      m.set(e.electionDate, { pct, keys });
    }
    return m;
  }, [elections]);

  const sortedPolls = useMemo(
    () =>
      [...polls].sort(
        (a, b) => fieldworkEndKey(b.fieldwork) - fieldworkEndKey(a.fieldwork),
      ),
    [polls],
  );

  if (sortedPolls.length === 0) {
    return (
      <StatCard
        label={
          <div className="flex items-center gap-2">
            <ListOrdered className="h-4 w-4" />
            <span>{t("polls_all_polls")}</span>
          </div>
        }
      >
        <div className="text-sm text-muted-foreground">
          {t("polls_no_polls_for_agency")}
        </div>
      </StatCard>
    );
  }

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4" />
          <span>
            {t("polls_all_polls")} ({sortedPolls.length})
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-3 mt-1">
        {sortedPolls.map((p) => {
          const ds = detailsByPoll.get(p.id) ?? [];
          const methodology = isBg ? p.methodology.bg : p.methodology.en;
          const showMethodology = methodology && methodology !== "N/A";
          const actuals = p.electionDate
            ? actualByElection.get(p.electionDate)
            : undefined;
          // Resolve each detail to its canonical actual key (so "ГЕРБ – СДС"
          // → "ГЕРБ-СДС" → 13.39%) up-front; we reuse this for both the bar,
          // the actual column, and the party link.
          const resolved = ds.map((d) => {
            const key = actuals
              ? resolveActualKey(d.nickName_bg, actuals.keys)
              : null;
            const actual =
              key !== undefined && key !== null
                ? actuals?.pct.get(key)
                : undefined;
            return { d, key, actual };
          });
          const maxSupport = Math.max(
            0.01,
            ...resolved.map((r) => r.d.support),
            ...resolved.map((r) => r.actual ?? 0),
          );
          return (
            <div
              key={p.id}
              className="rounded-lg border bg-background/50 p-3 flex flex-col gap-2"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                <span className="font-semibold text-sm">{p.fieldwork}</span>
                {p.electionDate ? (
                  <span className="text-muted-foreground">
                    {t("polls_for_election")}: {isoToLocalDate(p.electionDate)}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">
                    {t("polls_no_target_election")}
                  </span>
                )}
                {p.respondents ? (
                  <span className="text-muted-foreground tabular-nums">
                    n={p.respondents.toLocaleString()}
                  </span>
                ) : null}
                {p.source ? (
                  <a
                    href={p.source}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-auto text-primary hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("polls_source")}
                  </a>
                ) : null}
              </div>
              {showMethodology ? (
                <div className="text-[11px] text-muted-foreground italic">
                  {methodology}
                </div>
              ) : null}
              {ds.length > 0 ? (
                <>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(80px,2fr)_auto_auto_auto] gap-x-3 gap-y-1 items-center text-xs">
                    <span />
                    <span />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
                      {t("polls_polled_short")}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
                      {t("polls_actual_short")}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
                      {t("polls_diff_short")}
                    </span>
                    {resolved.map(({ d, key, actual }) => {
                      const widthPolled = Math.max(
                        2,
                        (d.support / maxSupport) * 100,
                      );
                      const actualLeftPct =
                        actual !== undefined
                          ? Math.min(100, (actual / maxSupport) * 100)
                          : undefined;
                      const diff =
                        actual !== undefined ? d.support - actual : undefined;
                      const diffColor =
                        diff === undefined
                          ? "text-muted-foreground"
                          : Math.abs(diff) < 1
                            ? "text-muted-foreground"
                            : diff > 0
                              ? "text-emerald-600"
                              : "text-rose-600";
                      const diffSign =
                        diff !== undefined && diff > 0 ? "+" : "";
                      return (
                        <div
                          className="contents"
                          key={`${d.pollId}-${d.nickName_en}`}
                        >
                          <Link
                            to={
                              p.electionDate
                                ? `/party/${key ?? d.nickName_bg}?elections=${p.electionDate.replace(/-/g, "_")}`
                                : `/party/${key ?? d.nickName_bg}`
                            }
                            className="text-xs truncate text-primary hover:underline"
                            title={isBg ? d.nickName_bg : d.nickName_en}
                          >
                            {isBg ? d.nickName_bg : d.nickName_en}
                          </Link>
                          <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="absolute top-0 bottom-0 left-0 rounded-full bg-primary/70"
                              style={{ width: `${widthPolled}%` }}
                            />
                            {actualLeftPct !== undefined ? (
                              <div
                                className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-foreground"
                                style={{ left: `${actualLeftPct}%` }}
                                title={t("polls_actual_short")}
                              />
                            ) : null}
                          </div>
                          <span className="tabular-nums text-xs font-semibold w-12 text-right">
                            {d.support.toFixed(1)}%
                          </span>
                          <span className="tabular-nums text-xs w-12 text-right text-muted-foreground">
                            {actual !== undefined
                              ? `${actual.toFixed(1)}%`
                              : "—"}
                          </span>
                          <span
                            className={`tabular-nums text-xs font-semibold w-14 text-right ${diffColor}`}
                          >
                            {diff !== undefined
                              ? `${diffSign}${diff.toFixed(1)}pp`
                              : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {actuals ? (
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {t("polls_actual_marker_legend")}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {t("polls_no_detail_breakdown")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
