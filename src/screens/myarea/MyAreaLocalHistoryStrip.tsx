// "История на местния вот" — local-elections history strip for the
// MyArea dashboard. One row per regular cycle, aligned on a shared
// timeline column with three cells:
//   - cycle label (e.g. "10.23")
//   - mayor chip (initials + party-color ring, R2 badge for runoff,
//     "—" dashed placeholder when this município has no data)
//   - council seat bar (full per-party breakdown, same palette as
//     MyAreaGovernmentCard's snapshot bar — see councilSegments.ts)
// The whole row is a Link to the /local/<cycle>/<obshtina> page so
// clicking anywhere in a row drills into that cycle's full results.
//
// A second sub-section below lists partial (chmi) replacements for this
// município (if any) as small pills.
//
// Auto-hides when the município has no usable mayor data for the most
// recent regular cycle in the catalogue (e.g. Sofia районs returned 404 on
// pre-2019 cycles before районs were elected separately — those rows
// simply render as dashed placeholders, but the latest cycle's row drives
// auto-hide).
//
// Mounted on /my-area/:id just above MyAreaGovernmentCard.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import { Tooltip } from "@/ux/Tooltip";
import { useLocalMunicipalityHistory } from "@/data/local/useLocalMunicipalityHistory";
import { useChmiHistoryAll } from "@/data/local/useChmiHistory";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import type { LocalMayorResult, LocalCouncilParty } from "@/data/local/types";
import { buildCouncilSegments, type CouncilSegment } from "./councilSegments";

type Props = {
  obshtina: string;
};

const formatCycleShort = (cycle: string): string => {
  const m = cycle.match(/^(\d{4})_(\d{2})_/);
  if (!m) return cycle;
  return `${m[2]}.${m[1].slice(2)}`;
};

// Reason the município has no bundle for this cycle. Sofia районs (S2***)
// weren't elected separately until 2015 — pre-2015 cycles legitimately have
// no per-район shard because the city-wide СОФ bundle covered them.
// Everywhere else, a missing bundle just means CIK didn't publish results
// for this município in this cycle (rare; mostly partial-cycle artefacts).
const missingBundleReason = (
  cycle: string,
  obshtinaCode: string,
  lang: "bg" | "en",
): string => {
  const yearMatch = cycle.match(/^(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : 0;
  const isSofiaRayon = /^S2\d{3}$/.test(obshtinaCode);
  if (isSofiaRayon && year < 2015) {
    return lang === "bg"
      ? "Столичните райони не са избирани отделно преди 2015 г. — през този вот районът е представен от градския вот на София."
      : "Sofia districts were not elected separately before 2015 — the район was covered by the city-wide Sofia ballot in this cycle.";
  }
  return lang === "bg"
    ? "Няма данни за тази община за този вот."
    : "No local-elections data published for this município in this cycle.";
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

const MayorCell: FC<{
  mayor: LocalMayorResult | null;
  wentToR2: boolean;
  ringColor: string;
  lang: "bg" | "en";
}> = ({ mayor, wentToR2, ringColor, lang }) => {
  if (!mayor) {
    return (
      <div
        className="size-9 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center text-[10px] text-muted-foreground/50 shrink-0"
        aria-hidden
      >
        —
      </div>
    );
  }
  return (
    <div className="relative shrink-0">
      <div
        className="size-9 rounded-full border-2 flex items-center justify-center text-[10px] font-bold bg-muted/40"
        style={{ borderColor: ringColor }}
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
  );
};

const MayorTooltipContent: FC<{
  mayor: LocalMayorResult;
  cycle: string;
  obshtinaName: string;
  wentToR2: boolean;
  lang: "bg" | "en";
}> = ({ mayor, cycle, obshtinaName, wentToR2, lang }) => (
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
          <span className="opacity-80">{lang === "bg" ? "дял" : "share"}</span>
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

const CouncilBarVisual: FC<{
  segments: CouncilSegment[];
  totalSeats: number;
  ariaLabel: string;
}> = ({ segments, totalSeats, ariaLabel }) => {
  if (totalSeats === 0 || segments.length === 0) {
    return (
      <div
        className="h-4 flex-1 rounded border border-dashed border-muted-foreground/30"
        aria-label={ariaLabel}
      />
    );
  }
  return (
    <div
      className="h-4 flex-1 rounded overflow-hidden flex bg-muted/30"
      role="img"
      aria-label={ariaLabel}
    >
      {segments.map((s) => (
        <div
          key={s.key}
          className="h-full"
          style={{
            width: `${(s.seats / totalSeats) * 100}%`,
            backgroundColor: s.color,
          }}
          title={`${s.label} — ${s.seats}`}
        />
      ))}
    </div>
  );
};

const CouncilTooltipContent: FC<{
  segments: CouncilSegment[];
  totalSeats: number;
  cycle: string;
  obshtinaName: string;
  lang: "bg" | "en";
}> = ({ segments, totalSeats, cycle, obshtinaName, lang }) => {
  const numLocale = lang === "bg" ? "bg-BG" : "en-GB";
  const hasVotes = segments[0]?.party.totalVotes > 0;
  // table-fixed + explicit colgroup widths so a long coalition / independent
  // name (e.g. "независим Борис Бориславов Бонев") truncates inside the
  // party column instead of pushing the votes / seats columns off the
  // tooltip surface.
  return (
    <div className="text-left w-[300px] max-w-full">
      <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">
        {formatCycleLong(cycle, lang)}
        {obshtinaName ? ` · ${obshtinaName}` : ""}
      </div>
      <table className="w-full table-fixed border-collapse text-[11px] leading-tight">
        <colgroup>
          <col style={{ width: hasVotes ? "55%" : "75%" }} />
          {hasVotes ? <col style={{ width: "30%" }} /> : null}
          <col style={{ width: hasVotes ? "15%" : "25%" }} />
        </colgroup>
        <thead>
          <tr className="opacity-70">
            <th className="text-left font-normal pr-3">
              {lang === "bg" ? "партия" : "party"}
            </th>
            {hasVotes ? (
              <th className="text-right font-normal pr-2">
                {lang === "bg" ? "гласове" : "votes"}
              </th>
            ) : null}
            <th className="text-right font-normal">
              {lang === "bg" ? "мандати" : "seats"}
            </th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s) => (
            <tr key={s.key} className="font-medium">
              <td className="py-0.5 pr-3 overflow-hidden">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-sm shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="truncate min-w-0" title={s.label}>
                    {s.label}
                  </span>
                </div>
              </td>
              {hasVotes ? (
                <td className="py-0.5 pr-2 text-right tabular-nums opacity-90">
                  {s.party.totalVotes.toLocaleString(numLocale)}
                </td>
              ) : null}
              <td className="py-0.5 text-right tabular-nums font-semibold">
                {s.seats}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] mt-1 opacity-70">
        {lang === "bg" ? "общо мандати" : "total seats"}: {totalSeats}
      </div>
    </div>
  );
};

const PlaceholderTooltipContent: FC<{
  cycle: string;
  reason: string;
  lang: "bg" | "en";
}> = ({ cycle, reason, lang }) => (
  <div className="text-left max-w-[240px]">
    <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">
      {formatCycleLong(cycle, lang)}
    </div>
    <div className="text-[11px] leading-snug">{reason}</div>
  </div>
);

type CycleRowProps = {
  cycle: string;
  mayor: LocalMayorResult | null;
  wentToR2: boolean;
  council: LocalCouncilParty[];
  segments: CouncilSegment[];
  totalSeats: number;
  obshtinaCode: string;
  obshtinaName: string;
  lang: "bg" | "en";
  ringColor: string;
};

const CycleRow: FC<CycleRowProps> = ({
  cycle,
  mayor,
  wentToR2,
  segments,
  totalSeats,
  obshtinaCode,
  obshtinaName,
  lang,
  ringColor,
}) => {
  const hasMayor = !!mayor;
  const hasCouncil = totalSeats > 0;
  const isEmpty = !hasMayor && !hasCouncil;
  const reason = missingBundleReason(cycle, obshtinaCode, lang);

  const winner = hasCouncil ? segments[0] : null;
  const summaryText = (() => {
    if (isEmpty)
      return lang === "bg" ? "няма публикувани данни" : "no published data";
    if (winner) return `${winner.label} · ${winner.seats}/${totalSeats}`;
    if (hasMayor) return mayor.localPartyName;
    return "";
  })();

  const href = `/local/${cycle}/${obshtinaCode}`;
  const linkAriaLabel = `${formatCycleLong(cycle, lang)} · ${obshtinaName} — ${
    lang === "bg" ? "виж пълни резултати" : "view full results"
  }`;

  const content = (
    <div className="grid grid-cols-[36px_36px_1fr] items-center gap-2 sm:gap-3 py-1.5 px-1.5 rounded-md hover:bg-accent/40 transition-colors">
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {formatCycleShort(cycle)}
      </span>
      {hasMayor ? (
        <Tooltip
          content={
            <MayorTooltipContent
              mayor={mayor}
              cycle={cycle}
              obshtinaName={obshtinaName}
              wentToR2={wentToR2}
              lang={lang}
            />
          }
        >
          <span
            className="inline-flex"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") e.stopPropagation();
            }}
          >
            <MayorCell
              mayor={mayor}
              wentToR2={wentToR2}
              ringColor={ringColor}
              lang={lang}
            />
          </span>
        </Tooltip>
      ) : (
        <MayorCell
          mayor={null}
          wentToR2={false}
          ringColor={ringColor}
          lang={lang}
        />
      )}
      <div className="min-w-0 flex flex-col gap-1">
        {hasCouncil ? (
          <Tooltip
            content={
              <CouncilTooltipContent
                segments={segments}
                totalSeats={totalSeats}
                cycle={cycle}
                obshtinaName={obshtinaName}
                lang={lang}
              />
            }
          >
            <span
              className="flex"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") e.stopPropagation();
              }}
            >
              <CouncilBarVisual
                segments={segments}
                totalSeats={totalSeats}
                ariaLabel={`${
                  lang === "bg"
                    ? "Партийно разпределение на"
                    : "Party split across"
                } ${totalSeats} ${lang === "bg" ? "мандата" : "seats"}`}
              />
            </span>
          </Tooltip>
        ) : (
          <CouncilBarVisual
            segments={segments}
            totalSeats={totalSeats}
            ariaLabel={reason}
          />
        )}
        <span className="text-[10px] text-muted-foreground truncate">
          {summaryText}
        </span>
      </div>
    </div>
  );

  if (isEmpty) {
    return (
      <Tooltip
        content={
          <PlaceholderTooltipContent
            cycle={cycle}
            reason={reason}
            lang={lang}
          />
        }
      >
        <div className="cursor-help">{content}</div>
      </Tooltip>
    );
  }

  return (
    <Link
      to={href}
      underline={false}
      aria-label={linkAriaLabel}
      className="block"
    >
      {content}
    </Link>
  );
};

export const MyAreaLocalHistoryStrip: FC<Props> = ({ obshtina }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { rows, isLoading } = useLocalMunicipalityHistory(obshtina);
  const { data: chmi } = useChmiHistoryAll();
  const { colorFor, byId, displayNameForId } = useCanonicalParties();

  const chmiEvents = useMemo(() => {
    const events = chmi?.byObshtina?.[obshtina] ?? [];
    return [...events].sort((a, b) => a.date.localeCompare(b.date));
  }, [chmi, obshtina]);

  // Auto-hide rule: if the latest (rightmost) cycle has no bundle, the
  // município has no local-election data at all. Hide while loading too
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
        <History className="size-4 text-primary shrink-0" />
        <h2 className="text-sm font-semibold flex-1">
          {lang === "bg" ? "История на местния вот" : "Local vote history"}
        </h2>
      </div>

      <div className="grid grid-cols-[36px_36px_1fr] items-center gap-2 sm:gap-3 px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span />
        <span>{lang === "bg" ? "Кмет" : "Mayor"}</span>
        <span>{lang === "bg" ? "Общински съвет" : "Council"}</span>
      </div>

      <div className="flex flex-col">
        {rows.map((r) => {
          const mayor = r.bundle?.mayor?.elected ?? null;
          const wentToR2 = !!(
            mayor &&
            (mayor.round === 2 || r.bundle?.mayor?.round2?.length)
          );
          const ringColor = mayor
            ? (() => {
                if (mayor.primaryCanonicalId) {
                  const entry = byId.get(mayor.primaryCanonicalId);
                  if (entry?.color) return entry.color;
                }
                return colorFor(mayor.localPartyName) ?? "#9ca3af";
              })()
            : "#9ca3af";
          const council = r.bundle?.council ?? [];
          const segments = buildCouncilSegments(
            council,
            displayNameForId,
            colorFor,
          );
          const totalSeats = segments.reduce((acc, s) => acc + s.seats, 0);
          return (
            <CycleRow
              key={r.cycle}
              cycle={r.cycle}
              mayor={mayor}
              wentToR2={wentToR2}
              council={council}
              segments={segments}
              totalSeats={totalSeats}
              obshtinaCode={obshtina}
              obshtinaName={r.bundle?.obshtinaName ?? obshtinaName}
              lang={lang}
              ringColor={ringColor}
            />
          );
        })}
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
                    {ev.pctOfValid > 0 ? ` · ${ev.pctOfValid.toFixed(1)}%` : ""}
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
