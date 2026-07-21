// Interactive what-if article: "What if large sections went machine-only?"
// (/articles/2026-07-21-machine-only-sections)
//
// Every parliamentary section since 2021 recorded machine + paper votes side by
// side. That split is a natural experiment. Here the reader forces every section
// above a chosen size onto the machine, optionally letting some paper-voters
// abstain (turnout realism), and watches national vote share + a live Hare-quota
// seat allocation recompute. All inputs are embedded (machineOnlyScenario.data.json,
// built by scripts/reports/machineOnlyScenario.ts) — no fetch, no GCS.

import { FC, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import {
  ArticleH2,
  ArticleLI,
  ArticleOL,
  ArticleP,
  ArticleUL,
} from "@/components/article/ArticleProse";
import { MapLayout } from "@/layout/dataview/MapLayout";
import {
  allocateSeats,
  MAJORITY_SEATS,
  TOTAL_SEATS,
} from "@/screens/utils/seatAllocation";
import { MachineOnlyRegionMap, type RegionSlice } from "./MachineOnlyRegionMap";
import scenarioData from "./machineOnlyScenario.data.json";

// ---- embedded-data types -------------------------------------------------

type PartyMeta = {
  partyNum: number;
  nickName: string;
  name: string;
  color: string;
};
type ThresholdRow = {
  partyNum: number;
  base: number;
  reassignable: number;
  actualPaper: number;
};
type ThresholdSlice = {
  affectedSections: number;
  affectedRegistered: number;
  affectedPaperVoters: number;
  affectedMachineVoters: number;
  rows: ThresholdRow[];
  // Present only for the latest election (drives the regional map).
  regions?: Record<string, RegionSlice>;
};
type Election = {
  date: string;
  registered: number;
  actualVoters: number;
  officialSeats: Record<string, number>;
  parties: PartyMeta[];
  byThreshold: Record<string, ThresholdSlice>;
};
type ScenarioData = {
  thresholds: number[];
  totalSeats: number;
  partyThresholdPct: number;
  elections: Election[];
};

const DATA = scenarioData as unknown as ScenarioData;
const THRESHOLD_PCT = DATA.partyThresholdPct;

// Drop-off options: share of paper-voters in affected sections who abstain
// rather than switch to a machine. 0 = turnout held constant.
const DROPOFFS = ["0", "10", "25", "50", "75", "100"] as const;

const MONTHS_BG = ["", "яну", "фев", "мар", "апр", "май", "юни", "юли", "авг", "сеп", "окт", "ное", "дек"]; // prettier-ignore
const MONTHS_EN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; // prettier-ignore

const electionLabel = (date: string, lang: "bg" | "en") => {
  const [y, m] = date.split("_");
  const mm = Number(m);
  return `${(lang === "bg" ? MONTHS_BG : MONTHS_EN)[mm]} ${y}`;
};

// ---- small presentational pieces -----------------------------------------

const Kpi: FC<{ label: string; children: React.ReactNode; hint?: string }> = ({
  label,
  children,
  hint,
}) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
      {children}
    </div>
    {hint ? (
      <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
    ) : null}
  </div>
);

// A labelled control group in the interactive panel.
const Control: FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    {children}
  </div>
);

// Connected segmented control for an ordinal set of values (shadcn-style).
// Full-width equal segments read as a scale, unlike separate pills.
function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex w-full gap-1 rounded-lg border border-border bg-muted/50 p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`flex-1 rounded-md px-2 py-1.5 text-sm font-medium tabular-nums transition-colors ${
              active
                ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// One party's actual→model vote share as two stacked bars + a delta chip.
const DualBar: FC<{
  name: string;
  color: string;
  actualPct: number;
  modelPct: number;
  maxPct: number;
  labelActual: string;
  labelModel: string;
}> = ({
  name,
  color,
  actualPct,
  modelPct,
  maxPct,
  labelActual,
  labelModel,
}) => {
  const d = modelPct - actualPct;
  const w = (p: number) => `${Math.max(0.5, (p / maxPct) * 100)}%`;
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span
          className="truncate text-sm font-medium text-foreground"
          title={name}
        >
          {name}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
            Math.abs(d) < 0.05
              ? "text-muted-foreground"
              : d > 0
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          }`}
        >
          {d >= 0 ? "+" : ""}
          {d.toFixed(2)} pp
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div
          className="h-2.5 rounded-full bg-muted-foreground/30"
          style={{ width: w(actualPct) }}
          title={`${labelActual}: ${actualPct.toFixed(2)}%`}
        />
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {actualPct.toFixed(1)}%
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <div
          className="h-2.5 rounded-full"
          style={{ width: w(modelPct), backgroundColor: color }}
          title={`${labelModel}: ${modelPct.toFixed(2)}%`}
        />
        <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
          {modelPct.toFixed(1)}%
        </span>
      </div>
    </div>
  );
};

// 240-seat hemicycle laid out across rows; seats coloured left→right by party.
type Seat = { x: number; y: number; angle: number };
const hemicycleSeats = (n: number): Seat[] => {
  if (n <= 0) return [];
  const rows = Math.max(3, Math.min(10, Math.round(Math.sqrt(n / 2.2))));
  const r0 = 0.45;
  const radii = Array.from({ length: rows }, (_, i) =>
    rows === 1 ? 1 : r0 + ((1 - r0) * i) / (rows - 1),
  );
  const radiusSum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.max(1, Math.round((n * r) / radiusSum)));
  let diff = n - counts.reduce((a, b) => a + b, 0);
  for (
    let i = counts.length - 1;
    diff !== 0 && i >= 0;
    i = i === 0 ? counts.length - 1 : i - 1
  ) {
    if (diff > 0) {
      counts[i]++;
      diff--;
    } else if (counts[i] > 1) {
      counts[i]--;
      diff++;
    }
  }
  const seats: Seat[] = [];
  radii.forEach((r, rowIdx) => {
    const c = counts[rowIdx];
    for (let s = 0; s < c; s++) {
      const angle = c === 1 ? Math.PI / 2 : Math.PI - (Math.PI * s) / (c - 1);
      seats.push({ x: r * Math.cos(angle), y: -r * Math.sin(angle), angle });
    }
  });
  return seats.sort((a, b) => b.angle - a.angle);
};

// ---- main screen ---------------------------------------------------------

export const MachineOnlyScenarioScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const nf = useMemo(
    () => new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB"),
    [lang],
  );

  const [threshold, setThreshold] = useState<string>("200");
  const [dropoff, setDropoff] = useState<string>("0");

  // The scenario always runs against the latest election.
  const election = DATA.elections[DATA.elections.length - 1];
  const partyMeta = useMemo(
    () => new Map(election.parties.map((p) => [p.partyNum, p])),
    [election],
  );

  const model = useMemo(() => {
    const slice = election.byThreshold[threshold];
    const d = Number(dropoff) / 100;
    const meta = new Map(election.parties.map((p) => [p.partyNum, p]));

    const actualVotes = slice.rows.map((r) => ({
      partyNum: r.partyNum,
      nickName: meta.get(r.partyNum)?.nickName,
      totalVotes: r.base + r.actualPaper,
    }));
    const modelVotes = slice.rows.map((r) => ({
      partyNum: r.partyNum,
      nickName: meta.get(r.partyNum)?.nickName,
      totalVotes: r.base + (1 - d) * r.reassignable,
    }));

    const actualRows = allocateSeats(actualVotes, THRESHOLD_PCT);
    const modelRows = allocateSeats(modelVotes, THRESHOLD_PCT);
    const aSeat = new Map(actualRows.map((r) => [r.partyNum, r]));
    const mSeat = new Map(modelRows.map((r) => [r.partyNum, r]));

    const parties = slice.rows
      .map((r) => {
        const m = meta.get(r.partyNum);
        const a = aSeat.get(r.partyNum);
        const mo = mSeat.get(r.partyNum);
        return {
          partyNum: r.partyNum,
          name: m?.nickName ?? String(r.partyNum),
          fullName: m?.name ?? String(r.partyNum),
          color: m?.color ?? "#888888",
          actualPct: a?.pct ?? 0,
          modelPct: mo?.pct ?? 0,
          actualSeats: a?.seats ?? 0,
          modelSeats: mo?.seats ?? 0,
        };
      })
      .sort((x, y) => y.modelPct - x.modelPct);

    // machine adoption already present in the affected sections — the lower it
    // is, the more the model extrapolates a self-selected minority.
    const machineAdoption =
      100 *
      (slice.affectedMachineVoters /
        Math.max(1, slice.affectedMachineVoters + slice.affectedPaperVoters));

    // turnout: paper-voters who abstain drop out of the electorate
    const modelVoters = Math.round(
      election.actualVoters - d * slice.affectedPaperVoters,
    );
    const actualTurnout = (100 * election.actualVoters) / election.registered;
    const modelTurnout = (100 * modelVoters) / election.registered;

    // headline seat movers
    const movers = parties
      .map((p) => ({ ...p, seatDelta: p.modelSeats - p.actualSeats }))
      .filter((p) => p.actualSeats > 0 || p.modelSeats > 0)
      .sort((a, b) => Math.abs(b.seatDelta) - Math.abs(a.seatDelta));
    const gainer = [...movers].sort((a, b) => b.seatDelta - a.seatDelta)[0];
    const loser = [...movers].sort((a, b) => a.seatDelta - b.seatDelta)[0];

    return {
      slice,
      parties,
      machineAdoption,
      inParliament: parties.filter((p) => p.modelSeats > 0).length,
      actualInParliament: parties.filter((p) => p.actualSeats > 0).length,
      modelVoters,
      actualTurnout,
      modelTurnout,
      gainer,
      loser,
    };
  }, [election, threshold, dropoff]);

  const maxPct = useMemo(
    () =>
      Math.max(
        ...model.parties.map((p) => Math.max(p.actualPct, p.modelPct)),
        1,
      ),
    [model],
  );

  // hemicycle seat colours (model), left→right by descending model seats
  const seatColors = useMemo(() => {
    const arr: string[] = [];
    [...model.parties]
      .filter((p) => p.modelSeats > 0)
      .sort((a, b) => b.modelSeats - a.modelSeats)
      .forEach((p) => {
        for (let i = 0; i < p.modelSeats; i++) arr.push(p.color);
      });
    return arr;
  }, [model]);
  const seats = useMemo(() => hemicycleSeats(TOTAL_SEATS), []);

  const barParties = model.parties.filter(
    (p) => p.actualPct >= 1 || p.modelPct >= 1,
  );
  const seatTableParties = model.parties.filter(
    (p) => p.actualSeats > 0 || p.modelSeats > 0,
  );

  return (
    <ArticleLayout
      title={t("machine_only_title")}
      description={t("machine_only_description")}
      date="2026-07-21"
      author="Claude Opus 4.8"
      breadcrumb={{ to: "/articles", label: t("articles_title") }}
      seoType="article"
    >
      <ArticleP>{t("machine_only_intro1")}</ArticleP>
      <ArticleP>
        <Trans
          i18nKey="machine_only_intro_real"
          components={{
            src: (
              <a
                className="text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary"
                href="https://www.focus-news.net/novini/Bylgaria/Izcyalo-mashinno-glasuvane-s-izklyuchenie-na-malkite-sekcii-predlaga-Progresivna-Bulgariya-2992060"
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          }}
        />
      </ArticleP>
      <ArticleP>{t("machine_only_intro2")}</ArticleP>

      <div className="my-6 rounded-lg border-l-4 border-primary/60 bg-primary/5 py-3 pl-4 pr-3">
        <ArticleP>
          <span className="font-semibold text-foreground">
            {t("machine_only_finding_lead")}
          </span>{" "}
          {t("machine_only_finding")}
        </ArticleP>
      </div>

      {/* ---- interactive controls ---- */}
      <div className="mt-8 rounded-xl border border-border bg-card/60 p-4 md:p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Control label={t("machine_only_ctrl_threshold")}>
            <Segmented
              ariaLabel={t("machine_only_ctrl_threshold")}
              value={threshold}
              onChange={setThreshold}
              options={DATA.thresholds.map((th) => ({
                value: String(th),
                label: `>${th}`,
              }))}
            />
          </Control>
          <Control label={t("machine_only_ctrl_dropoff")}>
            <Segmented
              ariaLabel={t("machine_only_ctrl_dropoff")}
              value={dropoff}
              onChange={setDropoff}
              options={DROPOFFS.map((d) => ({ value: d, label: `${d}%` }))}
            />
          </Control>
        </div>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          {t("machine_only_ctrl_caption", {
            sections: nf.format(model.slice.affectedSections),
            registered: nf.format(model.slice.affectedRegistered),
          })}{" "}
          {t("machine_only_ctrl_adoption", {
            adoption: model.machineAdoption.toFixed(0),
          })}
        </p>
      </div>

      {/* ---- KPI strip ---- */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label={t("machine_only_kpi_turnout")}
          hint={`${model.actualTurnout.toFixed(1)}% → ${model.modelTurnout.toFixed(1)}%`}
        >
          {(model.modelTurnout - model.actualTurnout >= 0 ? "+" : "") +
            (model.modelTurnout - model.actualTurnout).toFixed(1)}
          pp
        </Kpi>
        <Kpi
          label={t("machine_only_kpi_parties")}
          hint={`${model.actualInParliament} → ${model.inParliament}`}
        >
          {model.inParliament}
        </Kpi>
        <Kpi
          label={t("machine_only_kpi_gainer")}
          hint={model.gainer ? model.gainer.name : "—"}
        >
          {model.gainer && model.gainer.seatDelta > 0
            ? `+${model.gainer.seatDelta}`
            : "0"}
        </Kpi>
        <Kpi
          label={t("machine_only_kpi_loser")}
          hint={model.loser ? model.loser.name : "—"}
        >
          {model.loser && model.loser.seatDelta < 0
            ? model.loser.seatDelta
            : "0"}
        </Kpi>
      </div>

      {/* ---- live vote-share bars ---- */}
      <ArticleH2>
        {t("machine_only_h_voteshare", {
          year: election.date.split("_")[0],
        })}
      </ArticleH2>
      <p className="-mt-2 mb-3 text-xs text-muted-foreground">
        {t("machine_only_voteshare_note", {
          election: electionLabel(election.date, lang),
        })}
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-full bg-muted-foreground/30" />
          {t("machine_only_legend_actual")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-full bg-primary" />
          {t("machine_only_legend_model")}
        </span>
      </div>
      <div className="divide-y divide-border/50 rounded-lg border border-border p-3">
        {barParties.map((p) => (
          <DualBar
            key={p.partyNum}
            name={p.name}
            color={p.color}
            actualPct={p.actualPct}
            modelPct={p.modelPct}
            maxPct={maxPct}
            labelActual={t("machine_only_legend_actual")}
            labelModel={t("machine_only_legend_model")}
          />
        ))}
      </div>

      {/* ---- live seat allocation ---- */}
      <ArticleH2>{t("machine_only_h_seats")}</ArticleH2>
      <ArticleP>{t("machine_only_seats_lede")}</ArticleP>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col items-center gap-3">
          <svg
            viewBox="-1.12 -1.18 2.24 1.3"
            className="w-full max-w-[460px]"
            role="img"
            aria-label={t("machine_only_h_seats")}
          >
            {seats.map((s, i) => (
              <circle
                key={i}
                cx={s.x}
                cy={s.y}
                r={0.026}
                fill={seatColors[i] ?? "#d1d5db"}
                stroke="rgba(0,0,0,0.15)"
                strokeWidth={0.003}
              />
            ))}
            <text
              x={0}
              y={-0.06}
              textAnchor="middle"
              className="fill-foreground"
              style={{ font: "600 0.16px var(--font-sans, sans-serif)" }}
            >
              {TOTAL_SEATS}
            </text>
          </svg>
          <div className="text-xs text-muted-foreground tabular-nums">
            {t("machine_only_majority")}: {MAJORITY_SEATS} / {TOTAL_SEATS}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-2">{t("machine_only_col_party")}</th>
                <th className="py-1.5 px-2 text-right">
                  {t("machine_only_col_actual_seats")}
                </th>
                <th className="py-1.5 px-2 text-right">
                  {t("machine_only_col_model_seats")}
                </th>
                <th className="py-1.5 pl-2 text-right">
                  {t("machine_only_col_delta")}
                </th>
              </tr>
            </thead>
            <tbody>
              {seatTableParties.map((p) => {
                const d = p.modelSeats - p.actualSeats;
                return (
                  <tr key={p.partyNum} className="border-t border-border/40">
                    <td className="py-1.5 pr-2">
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          aria-hidden
                          className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-border"
                          style={{ backgroundColor: p.color }}
                        />
                        <span className="truncate" title={p.fullName}>
                          {p.name}
                        </span>
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                      {p.actualSeats}
                    </td>
                    <td className="py-1.5 px-2 text-right font-semibold tabular-nums">
                      {p.modelSeats}
                    </td>
                    <td
                      className={`py-1.5 pl-2 text-right font-semibold tabular-nums ${
                        d > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : d < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      {d > 0 ? `+${d}` : d}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("machine_only_seats_note")}
          </p>
        </div>
      </div>

      {/* ---- regional projection map ---- */}
      {model.slice.regions ? (
        <>
          <ArticleH2>{t("machine_only_map_h")}</ArticleH2>
          <ArticleP>{t("machine_only_map_lede")}</ArticleP>
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            <MapLayout>
              {(size) => (
                <MachineOnlyRegionMap
                  size={size}
                  regions={model.slice.regions as Record<string, RegionSlice>}
                  dropoff={Number(dropoff) / 100}
                  parties={partyMeta}
                />
              )}
            </MapLayout>
          </div>
        </>
      ) : null}

      {/* ---- methodology ---- */}
      <ArticleH2>{t("machine_only_h_method")}</ArticleH2>
      <ArticleP>{t("machine_only_method_p1")}</ArticleP>
      <ArticleP>{t("machine_only_method_p2")}</ArticleP>
      <div className="my-4 rounded-lg border border-border bg-muted/30 p-4 font-mono text-[13px] leading-6 text-foreground/90">
        machineShare<sub>p</sub> = machineVotes<sub>p</sub> / Σ machineVotes
        <br />
        votes<sub>p</sub>(d) = machineVotes<sub>p</sub> + (1 − d) · paperTotal ·
        machineShare<sub>p</sub>
      </div>
      <ArticleP>{t("machine_only_method_p3")}</ArticleP>
      <ArticleOL>
        <ArticleLI>{t("machine_only_method_step1")}</ArticleLI>
        <ArticleLI>{t("machine_only_method_step2")}</ArticleLI>
        <ArticleLI>{t("machine_only_method_step3")}</ArticleLI>
        <ArticleLI>{t("machine_only_method_step4")}</ArticleLI>
      </ArticleOL>
      <ArticleP>{t("machine_only_method_frame")}</ArticleP>

      <ArticleH2>{t("machine_only_h_caveats")}</ArticleH2>
      <ArticleUL>
        <ArticleLI>{t("machine_only_caveat_behavior")}</ArticleLI>
        <ArticleLI>{t("machine_only_caveat_medium")}</ArticleLI>
        <ArticleLI>{t("machine_only_caveat_invalid")}</ArticleLI>
        <ArticleLI>{t("machine_only_caveat_adoption")}</ArticleLI>
        <ArticleLI>{t("machine_only_caveat_turnout")}</ArticleLI>
        <ArticleLI>{t("machine_only_caveat_seats")}</ArticleLI>
        <ArticleLI>{t("machine_only_caveat_nomachine")}</ArticleLI>
        <ArticleLI>{t("machine_only_caveat_none")}</ArticleLI>
      </ArticleUL>

      <ArticleH2>{t("machine_only_h_refs")}</ArticleH2>
      <ArticleUL>
        <ArticleLI>
          <a
            className="text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary"
            href="https://onlinelibrary.wiley.com/doi/abs/10.3982/ECTA11520"
            target="_blank"
            rel="noopener noreferrer"
          >
            Fujiwara, T. (2015). Voting Technology, Political Responsiveness,
            and Infant Health: Evidence from Brazil. Econometrica 83(2).
          </a>
        </ArticleLI>
        <ArticleLI>
          <a
            className="text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary"
            href="https://www.sciencedirect.com/science/article/abs/pii/S0261379416301238"
            target="_blank"
            rel="noopener noreferrer"
          >
            Zucco, C. &amp; Nicolau, J. (2016). Trading old errors for new
            errors? The impact of electronic voting technology on party label
            votes in Brazil. Electoral Studies 43.
          </a>
        </ArticleLI>
      </ArticleUL>

      <ArticleP>{t("machine_only_footer")}</ArticleP>
    </ArticleLayout>
  );
};
