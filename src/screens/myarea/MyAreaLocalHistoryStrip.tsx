// "История на местния вот" — local-elections history strip for the
// MyArea dashboard. Two panels:
//   - Mayor (left): one chip per regular cycle, party-color ring, R2 badge
//     when the race went to runoff, tooltip with full breakdown. A second
//     row of smaller pills underneath surfaces partial (chmi) replacements
//     for this município.
//   - Council (right): per-cycle horizontal seat bar showing top-3 parties
//     by mandate count, headline = leading party's seat count.
//
// Auto-hides when the município has no usable mayor data for the most
// recent regular cycle in the catalogue (e.g. Sofia районs returned 404 on
// pre-2019 cycles before районs were elected separately — those chips
// simply don't render, but the latest cycle's chip drives auto-hide).
//
// Mounted on /my-area/:id just above MyAreaGovernmentCard.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Landmark } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import { Tooltip } from "@/ux/Tooltip";
import { useLocalMunicipalityHistory } from "@/data/local/useLocalMunicipalityHistory";
import { useChmiHistoryAll } from "@/data/local/useChmiHistory";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import type { LocalMayorResult, LocalCouncilParty } from "@/data/local/types";

type Props = {
  obshtina: string;
};

// Color resolver that prefers the stable canonical-id (since local-coalition
// labels rebrand cycle-to-cycle — Sredec mayor Trayko Traykov ran under three
// different list labels across cycles but is the same `p_6` canonical
// throughout) and falls back to a nickName lookup when the parser couldn't
// resolve a canonical id (independents, niche local lists).
type PartyLike = {
  primaryCanonicalId: string | null;
  localPartyName: string;
};
const colorOf = (
  party: PartyLike,
  byId: Map<string, { color: string }> | Map<string, unknown>,
  colorForName: (n: string) => string | undefined,
): string => {
  if (party.primaryCanonicalId) {
    const entry = (byId as Map<string, { color?: string }>).get(
      party.primaryCanonicalId,
    );
    if (entry?.color) return entry.color;
  }
  return colorForName(party.localPartyName) ?? "#9ca3af";
};

const formatCycleShort = (cycle: string): string => {
  const m = cycle.match(/^(\d{4})_(\d{2})_/);
  if (!m) return cycle;
  return `${m[2]}.${m[1].slice(2)}`;
};

const MONTHS_BG = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];
const MONTHS_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const formatCycleLong = (cycle: string, lang: "bg" | "en"): string => {
  const m = cycle.match(/^(\d{4})_(\d{2})_(\d{2})/);
  if (!m) return cycle;
  const [, y, mo, d] = m;
  const mi = parseInt(mo, 10) - 1;
  if (lang === "bg") return `${parseInt(d, 10)} ${MONTHS_BG[mi]} ${y}`;
  return `${MONTHS_EN[mi]} ${parseInt(d, 10)}, ${y}`;
};

const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

type MayorChipProps = {
  cycle: string;
  mayor: LocalMayorResult | null;
  wentToR2: boolean;
  obshtinaName: string;
  lang: "bg" | "en";
  ringColor: string;
};

const MayorChip: FC<MayorChipProps> = ({
  cycle,
  mayor,
  wentToR2,
  obshtinaName,
  lang,
  ringColor,
}) => {
  const ring = mayor ? ringColor : "#e5e7eb";
  if (!mayor) {
    return (
      <div className="flex flex-col items-center gap-1 min-w-[60px]">
        <div
          className="size-10 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center text-[10px] text-muted-foreground/50"
          aria-hidden
        >
          —
        </div>
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {formatCycleShort(cycle)}
        </span>
      </div>
    );
  }
  const tooltipContent = (
    <div className="text-left max-w-[260px]">
      <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">
        {formatCycleLong(cycle, lang)}
        {obshtinaName ? ` · ${obshtinaName}` : ""}
      </div>
      <div className="text-[12px] font-semibold leading-tight mb-1">
        {mayor.candidateName}
      </div>
      <div className="text-[11px] opacity-80 mb-2 leading-tight">
        {mayor.localPartyName}
      </div>
      <div className="text-[11px] leading-tight space-y-0.5">
        <div className="flex justify-between gap-3">
          <span className="opacity-80">
            {lang === "bg" ? "гласове" : "votes"}
          </span>
          <span className="font-semibold tabular-nums">
            {mayor.votes.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB")}
          </span>
        </div>
        {mayor.pctOfValid > 0 ? (
          <div className="flex justify-between gap-3">
            <span className="opacity-80">
              {lang === "bg" ? "дял" : "share"}
            </span>
            <span className="font-semibold tabular-nums">
              {mayor.pctOfValid.toFixed(1)}%
            </span>
          </div>
        ) : null}
        {wentToR2 ? (
          <div className="text-[10px] mt-1 opacity-70">
            {lang === "bg" ? "избран на втори тур" : "elected in round 2"}
          </div>
        ) : null}
      </div>
    </div>
  );
  return (
    <Tooltip content={tooltipContent}>
      <div className="flex flex-col items-center gap-1 min-w-[60px] cursor-default">
        <div className="relative">
          <div
            className="size-10 rounded-full border-2 flex items-center justify-center text-[10px] font-bold bg-muted/40"
            style={{ borderColor: ring }}
          >
            {initials(mayor.candidateName)}
          </div>
          {wentToR2 ? (
            <span
              className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-amber-500 text-white text-[8px] font-bold flex items-center justify-center"
              aria-label={lang === "bg" ? "втори тур" : "round 2"}
            >
              2
            </span>
          ) : null}
        </div>
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {formatCycleShort(cycle)}
        </span>
      </div>
    </Tooltip>
  );
};

type CouncilBarProps = {
  cycle: string;
  council: LocalCouncilParty[];
  obshtinaName: string;
  lang: "bg" | "en";
  resolveColor: (p: LocalCouncilParty) => string;
};

const CouncilBar: FC<CouncilBarProps> = ({
  cycle,
  council,
  obshtinaName,
  lang,
  resolveColor,
}) => {
  const totalMandates = council.reduce((acc, p) => acc + p.mandatesWon, 0);
  const top3 = council
    .filter((p) => p.mandatesWon > 0)
    .sort((a, b) => b.mandatesWon - a.mandatesWon)
    .slice(0, 3);
  const numLocale = lang === "bg" ? "bg-BG" : "en-GB";
  if (totalMandates === 0 || top3.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <div className="h-5 rounded bg-muted/30" aria-hidden />
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {formatCycleShort(cycle)} · {lang === "bg" ? "няма данни" : "no data"}
        </span>
      </div>
    );
  }
  const tooltipContent = (
    <div className="text-left">
      <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">
        {formatCycleLong(cycle, lang)}
        {obshtinaName ? ` · ${obshtinaName}` : ""}
      </div>
      <table className="w-full border-collapse text-[11px] leading-tight">
        <thead>
          <tr className="opacity-70">
            <th className="text-left font-normal pr-3">
              {lang === "bg" ? "партия" : "party"}
            </th>
            {top3[0].totalVotes > 0 ? (
              <th className="text-right font-normal pr-3">
                {lang === "bg" ? "гласове" : "votes"}
              </th>
            ) : null}
            <th className="text-right font-normal">
              {lang === "bg" ? "мандати" : "seats"}
            </th>
          </tr>
        </thead>
        <tbody>
          {top3.map((p) => (
            <tr key={p.localPartyName} className="font-medium">
              <td className="py-0.5 pr-3">
                <div className="flex items-center gap-1.5 max-w-[160px]">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-sm shrink-0"
                    style={{
                      backgroundColor: resolveColor(p),
                    }}
                  />
                  <span className="truncate">{p.localPartyName}</span>
                </div>
              </td>
              {top3[0].totalVotes > 0 ? (
                <td className="py-0.5 pr-3 text-right tabular-nums opacity-90">
                  {p.totalVotes.toLocaleString(numLocale)}
                </td>
              ) : null}
              <td className="py-0.5 text-right tabular-nums font-semibold">
                {p.mandatesWon}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] mt-1 opacity-70">
        {lang === "bg" ? "общо мандати" : "total seats"}: {totalMandates}
      </div>
    </div>
  );
  return (
    <Tooltip content={tooltipContent}>
      <div className="flex flex-col gap-1 cursor-default">
        <div className="flex items-stretch h-5 rounded overflow-hidden bg-muted/30">
          {top3.map((p) => {
            const widthPct = (p.mandatesWon / totalMandates) * 100;
            return (
              <div
                key={p.localPartyName}
                className="h-full"
                style={{
                  width: `${widthPct}%`,
                  background: resolveColor(p),
                }}
              />
            );
          })}
        </div>
        <span className="text-[9px] text-muted-foreground tabular-nums truncate">
          {formatCycleShort(cycle)} · {top3[0].localPartyName} ·{" "}
          {top3[0].mandatesWon}/{totalMandates}
        </span>
      </div>
    </Tooltip>
  );
};

export const MyAreaLocalHistoryStrip: FC<Props> = ({ obshtina }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { rows, isLoading } = useLocalMunicipalityHistory(obshtina);
  const { data: chmi } = useChmiHistoryAll();
  const { colorFor, byId } = useCanonicalParties();
  const resolveColor = (party: PartyLike): string =>
    colorOf(party, byId, colorFor);

  const chmiEvents = useMemo(() => {
    const events = chmi?.byObshtina?.[obshtina] ?? [];
    return [...events].sort((a, b) => a.date.localeCompare(b.date));
  }, [chmi, obshtina]);

  // Auto-hide rule: if the latest (rightmost) cycle has no bundle, the
  // município has no local-election data at all (e.g. SOF wrapper with
  // no mayor.elected — unlikely but defensive). Hide while loading too
  // so we don't flash an empty card.
  const latest = rows[rows.length - 1];
  if (isLoading) return null;
  if (!latest?.bundle?.mayor?.elected) return null;

  // Local fullHref points to the latest cycle's full município page.
  const fullHref = `/local/${latest.cycle}/${obshtina}`;
  const fullLabel =
    lang === "bg"
      ? "Виж пълно местно табло за общината"
      : "View full local results for this municipality";

  const obshtinaName = latest.bundle?.obshtinaName ?? "";

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Landmark className="size-4 text-primary shrink-0" />
        <h2 className="text-sm font-semibold flex-1">
          {lang === "bg" ? "История на местния вот" : "Local vote history"}
        </h2>
      </div>

      <div className="grid gap-4 lg:gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Left — Mayor chips + chmi sub-row */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {lang === "bg" ? "Кмет" : "Mayor"}
            </span>
            <div className="flex items-end gap-3 flex-wrap">
              {rows.map((r) => {
                const mayor = r.bundle?.mayor?.elected ?? null;
                const wentToR2 = !!(
                  mayor &&
                  (mayor.round === 2 || r.bundle?.mayor?.round2?.length)
                );
                const ringColor = mayor ? resolveColor(mayor) : "#9ca3af";
                return (
                  <MayorChip
                    key={r.cycle}
                    cycle={r.cycle}
                    mayor={mayor}
                    wentToR2={wentToR2}
                    obshtinaName={r.bundle?.obshtinaName ?? obshtinaName}
                    lang={lang}
                    ringColor={ringColor}
                  />
                );
              })}
            </div>
          </div>

          {chmiEvents.length > 0 ? (
            <div className="flex flex-col gap-1 pt-2 border-t border-border/40">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {lang === "bg"
                  ? `Частични избори · ${chmiEvents.length}`
                  : `Partial elections · ${chmiEvents.length}`}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {chmiEvents.map((ev, i) => {
                  const ring = colorFor(ev.localPartyName) ?? "#9ca3af";
                  const tooltipContent = (
                    <div className="text-left max-w-[260px]">
                      <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">
                        {ev.date}
                        {ev.kmetstvoName ? ` · ${ev.kmetstvoName}` : ""}
                      </div>
                      <div className="text-[12px] font-semibold leading-tight">
                        {ev.candidateName}
                      </div>
                      <div className="text-[11px] opacity-80 leading-tight">
                        {ev.localPartyName}
                      </div>
                      <div className="text-[10px] mt-1 opacity-70">
                        {lang === "bg" ? "тур" : "round"} {ev.round}
                        {ev.pctOfValid > 0
                          ? ` · ${ev.pctOfValid.toFixed(1)}%`
                          : ""}
                      </div>
                    </div>
                  );
                  return (
                    <Tooltip
                      key={`${ev.cycle}-${ev.kmetstvoName ?? ""}-${i}`}
                      content={tooltipContent}
                    >
                      <div
                        className="size-6 rounded-full border-2 flex items-center justify-center text-[8px] font-bold bg-muted/30 cursor-default"
                        style={{ borderColor: ring }}
                        aria-label={`chmi ${ev.date}`}
                      >
                        ч
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* Right — Council seat bars */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {lang === "bg" ? "Общински съвет" : "Council"}
          </span>
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <CouncilBar
                key={r.cycle}
                cycle={r.cycle}
                council={r.bundle?.council ?? []}
                obshtinaName={r.bundle?.obshtinaName ?? obshtinaName}
                lang={lang}
                resolveColor={resolveColor}
              />
            ))}
          </div>
        </div>
      </div>

      <Link
        to={fullHref}
        underline={false}
        className="flex items-center justify-between gap-2 text-sm rounded-md border p-2 hover:bg-accent/40 transition-colors group/full"
        aria-label={fullLabel}
      >
        <span className="font-medium">{fullLabel}</span>
        <ArrowRight className="size-4 text-muted-foreground group-hover/full:text-primary transition-colors" />
      </Link>
    </Card>
  );
};
