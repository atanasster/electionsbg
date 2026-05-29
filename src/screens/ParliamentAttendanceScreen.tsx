import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserCheck, UserX } from "lucide-react";
import { Title } from "@/ux/Title";
import { Link } from "@/ux/Link";
import { useAttendance } from "@/data/parliament/votes/useAttendance";
import { useMpProfile } from "@/data/parliament/votes/useMpProfile";
import { useCandidateUrlForVote } from "@/data/parliament/votes/useCandidateUrlForVote";
import { useMps } from "@/data/parliament/useMps";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { titleCaseName } from "@/lib/utils";
import type { AttendanceEntry } from "@/data/parliament/votes/types";

const MIN_ITEMS = 30;

const formatPct = (frac: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(frac);

const formatInt = (n: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB").format(n);

type Sort = "absent" | "present";

export const ParliamentAttendanceScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const {
    entries,
    computedAt,
    slice,
    ns: selectedNs,
    isLoading,
  } = useAttendance();
  const { mpNames, mpParty } = useMpProfile();
  const { findMpById, findMpByName, currentNs } = useMps();
  // `currentNs` is the display label ("52-ро Народно събрание"); selectedNs
  // is the folder code ("52"). Strip the label prefix to compare.
  const currentNsCode = currentNs?.match(/^\d+/)?.[0] ?? null;
  const isCurrentNs = !!selectedNs && selectedNs === currentNsCode;
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();
  const candidateUrl = useCandidateUrlForVote();
  const [sort, setSort] = useState<Sort>("absent");

  const lang = i18n.language;
  const pageTitle = t("attendance_title") || "Parliamentary attendance";

  const ordered: AttendanceEntry[] = useMemo(() => {
    const isSeated = (csvMpId: number): boolean => {
      if (!isCurrentNs) return mpNames[String(csvMpId)] !== undefined;
      const direct = findMpById(csvMpId);
      if (direct && direct.nsFolders.includes(selectedNs ?? "")) {
        return direct.isCurrent;
      }
      const byName = findMpByName(mpNames[String(csvMpId)]);
      if (byName) return byName.isCurrent;
      return false;
    };
    const eligible = entries.filter(
      (e) => e.totalItems >= MIN_ITEMS && isSeated(e.mpId),
    );
    const sorted = [...eligible].sort((a, b) =>
      sort === "absent"
        ? a.presentPct - b.presentPct
        : b.presentPct - a.presentPct,
    );
    return sorted;
  }, [
    entries,
    sort,
    mpNames,
    selectedNs,
    isCurrentNs,
    findMpById,
    findMpByName,
  ]);

  const nameOf = (id: number): string =>
    titleCaseName(findMpById(id)?.name ?? mpNames[String(id)]) || `MP #${id}`;
  const partyOf = (id: number, fallback: string): string =>
    mpParty[String(id)] ?? fallback;

  return (
    <>
      <Title description={t("attendance_description") || pageTitle}>
        {pageTitle}
      </Title>

      <div className="pb-12 space-y-6">
        <p className="text-sm text-muted-foreground">
          {t("attendance_intro") ||
            "Share of roll-call items where each MP cast a vote (yes / no / abstain). The denominator is items where the MP appears in the roll-call at all, so the metric scopes to each MP's seated window. MPs with fewer than 30 items are excluded to suppress noise from short tenures."}
        </p>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setSort("absent")}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${
              sort === "absent"
                ? "bg-primary text-primary-foreground border-primary"
                : "text-muted-foreground"
            }`}
          >
            <UserX className="h-3 w-3" />
            {t("attendance_sort_most_absent") || "Most absent"}
          </button>
          <button
            type="button"
            onClick={() => setSort("present")}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${
              sort === "present"
                ? "bg-primary text-primary-foreground border-primary"
                : "text-muted-foreground"
            }`}
          >
            <UserCheck className="h-3 w-3" />
            {t("attendance_sort_most_present") || "Most present"}
          </button>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">
            {t("loading") || "Loading…"}
          </div>
        ) : ordered.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("attendance_empty") ||
              "No attendance data has been computed yet — run the derived-metrics step first."}
          </div>
        ) : (
          <ul className="border rounded-xl bg-card divide-y">
            {ordered.map((e) => {
              const name = nameOf(e.mpId);
              const party = partyOf(e.mpId, e.partyShort);
              const color = colorForPartyShort(party) ?? "#94a3b8";
              const partyLabel = labelForPartyShort(party) || party;
              return (
                <li key={e.mpId}>
                  <Link
                    to={candidateUrl(e.mpId, name)}
                    underline={false}
                    className="flex items-center gap-3 p-3 hover:bg-muted/40"
                  >
                    <MpAvatar name={name} mpId={e.mpId} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{name}</div>
                      <div
                        className="text-[11px] uppercase tracking-wide truncate"
                        style={{ color }}
                      >
                        {partyLabel}
                      </div>
                    </div>
                    <div className="text-right tabular-nums shrink-0">
                      <div className="text-base font-semibold">
                        {formatPct(e.presentPct, lang)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatInt(e.presentCount, lang)} /{" "}
                        {formatInt(e.totalItems, lang)}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {slice && computedAt && (
          <p className="text-xs text-muted-foreground">
            {t("attendance_computed_at") || "Computed"}:{" "}
            <span className="tabular-nums">{computedAt.slice(0, 10)}</span>
            {". "}
            {t("attendance_window") || "Window"}:{" "}
            <span className="tabular-nums">{slice.windowFrom}</span> –{" "}
            <span className="tabular-nums">{slice.windowTo}</span>.{" "}
            {t("attendance_methodology_note") ||
              'Items counted only when the MP appears in the per-item roll-call. "Absent" is the literal code the CSV records — leave votes, committee work and procedural absences all collapse into one bucket.'}
          </p>
        )}
      </div>
    </>
  );
};
