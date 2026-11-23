// The six vaccine sources. Maps to `update-vaccines`.
// Plan: docs/plans/vaccines-flow-v1.md T1.
//
// Every fingerprint THROWS on an unreachable source or zero parsed rows — none
// returns an empty fingerprint, because three of these sources keep no history
// and "nothing there" must never read as "nothing changed".
//
// The two НЦЗПБ / СЕСПА watchers also fail when a week fell off the source
// before we captured it (plan §7.9): a missed weekly capture is an error, not
// a quiet day.

import type { Fingerprint, WatchSource } from "../types";
import { fetchText, sha256 } from "../fingerprint";
import {
  HIS_INFOAPP_URL,
  parseImmunizations,
} from "../../health/vaccines/his_infoapp";
import {
  COMEXT_URL,
  FLU_COVERAGE_URL,
  NCIPD_TABLE_URL,
  SESPA_URL,
  VACCINE_CN_CODES,
  fetchFluCoverage,
  fetchHisReport,
  fetchIncidence,
  fetchSespa,
  hisReportUrl,
} from "../../health/vaccines/sources";
import {
  FILES,
  SNAPSHOT_DIR,
  lastIncidenceWeek,
  lastShortageWindow,
  missedAShortageWindow,
  missedAWeek,
  readJsonl,
  type FluLine,
  type ShortageLine,
} from "../../health/vaccines/snapshot";

const snap = (f: string) => `${SNAPSHOT_DIR}/${f}`;

const required = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`missing ${what}`);
  return v;
};

const metaNum = (
  meta: Record<string, unknown> | undefined,
  k: string,
): number | undefined => {
  const v = meta?.[k];
  return typeof v === "number" ? v : undefined;
};

export const hisImmunizationsDaily: WatchSource = {
  id: "his_immunizations_daily",
  label: "НЗИС — имунизации от началото на годината (his.bg)",
  url: hisReportUrl(new Date().getUTCFullYear()),
  // The counter moves every day, and the snapshot writer records it on every
  // flip — so the probe has to sample faster than the day it publishes on
  // (the ted_bg precedent). One small HTML page per hour.
  cadence: "hourly",
  publishes: "daily",
  egress: "bg",
  egressProbe: "https://his.bg/",
  async fingerprint(): Promise<Fingerprint> {
    const report = await fetchHisReport(new Date().getUTCFullYear());
    const csv = report.byVaccine.map((v) => `${v.labelEn},${v.n}`).join("\n");
    const flu = report.byVaccine
      .filter((v) => /influenza/i.test(v.labelEn))
      .reduce((a, v) => a + v.n, 0);
    const updatedAt = required(
      [...report.updatedAt].sort().at(-1),
      "НЗИС as-of stamp",
    );
    return {
      value: sha256(csv),
      detail: `${report.year}: ${report.total.toLocaleString()} immunizations, flu ${flu.toLocaleString()} (as of ${updatedAt})`,
      meta: { year: report.year, total: report.total, flu, updatedAt },
    };
  },
  describe(prev, curr) {
    const a = metaNum(prev?.meta, "flu");
    const b = metaNum(curr.meta, "flu");
    if (a === undefined || b === undefined) return curr.detail;
    return `${curr.detail} — flu ${b - a >= 0 ? "+" : ""}${(b - a).toLocaleString()}`;
  },
};

export const hisImmunizationApp: WatchSource = {
  id: "his_immunization_app",
  label: "НЗИС — имунизации по месец, област, възраст (info-app)",
  url: HIS_INFOAPP_URL,
  // The grain is the MONTH: a closed month is what this source adds, while the
  // current month's partial cells are what his_immunizations_daily already
  // captures daily. The file itself is regenerated every night.
  cadence: "daily",
  publishes: "monthly",
  egress: "bg",
  egressProbe: "https://his.bg/",
  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(HIS_INFOAPP_URL, { retries: 2 });
    if (!html) throw new Error("НЗИС info-app unreachable");
    const rows = parseImmunizations(html);
    if (!rows.length) throw new Error("НЗИС info-app decoded to zero rows");
    const maxPeriod = rows.reduce((m, r) => (r.period > m ? r.period : m), "");
    const total = rows.reduce((a, r) => a + r.n, 0);
    // Over the decoded content, not the file: the file is regenerated nightly
    // whether or not its data moved.
    return {
      value: `${maxPeriod}|${rows.length}|${total}`,
      detail: `${rows.length.toLocaleString()} cells to ${maxPeriod}, ${total.toLocaleString()} immunizations`,
      meta: { maxPeriod, rows: rows.length, total },
    };
  },
};

export const ialShortageList: WatchSource = {
  id: "ial_shortage_list",
  label: "ИАЛ СЕСПА — лекарства с установен недостиг (чл. 217в ЗЛПХМ)",
  url: SESPA_URL,
  cadence: "daily",
  publishes: "weekly",
  egress: "bg",
  egressProbe: "https://sespa.mh.government.bg/",
  async fingerprint(): Promise<Fingerprint> {
    const list = await fetchSespa();
    const last = lastShortageWindow(
      readJsonl<ShortageLine>(snap(FILES.shortage)),
    );
    if (last && missedAShortageWindow(last.valid_to, list.validFrom))
      throw new Error(
        `СЕСПА: newest capture is ${last.valid_from}…${last.valid_to}, the source now shows ${list.validFrom} — a weekly list was missed`,
      );
    const codes = list.rows.map((r) => r.ncprCode).sort();
    const vaccines = list.rows.filter((r) => r.isVaccine).map((r) => r.name);
    return {
      value: sha256(`${list.validFrom}|${list.validTo}|${codes.join(",")}`),
      detail: `${list.validFrom}…${list.validTo}: ${list.rows.length} products, vaccines: ${vaccines.join(", ") || "none"}`,
      meta: { validFrom: list.validFrom, count: list.rows.length, vaccines },
    };
  },
};

export const ncipdFluWeekly: WatchSource = {
  id: "ncipd_flu_weekly",
  label: "НЦЗПБ — седмична заболяемост от грип и ОРЗ (grippe.gateway.bg)",
  url: NCIPD_TABLE_URL(1),
  cadence: "daily",
  publishes: "weekly",
  egress: "bg",
  egressProbe: "https://grippe.gateway.bg/",
  async fingerprint(): Promise<Fingerprint> {
    const latest = await fetchIncidence(1);
    const older = await fetchIncidence(2);
    const last = lastIncidenceWeek(readJsonl<FluLine>(snap(FILES.flu)));
    if (missedAWeek(last, older.weekStart))
      throw new Error(
        `НЦЗПБ: newest capture is the week of ${last}, the source now starts at ${older.weekStart} — a week was missed`,
      );
    const nat = required(
      latest.rows.find((r) => r.isNational),
      "НЦЗПБ national row",
    );
    const cases = required(nat.cases.at(-1), "НЦЗПБ national total");
    return {
      value: `${latest.weekStart}|${cases}`,
      detail: `week ${latest.isoWeek} (${latest.weekStart}): ${cases.toLocaleString()} cases, ${nat.rate.at(-1)} per 10,000`,
      meta: { isoWeek: latest.isoWeek, weekStart: latest.weekStart, cases },
    };
  },
};

const eurostatUpdated = async (
  url: string,
): Promise<{ updated: string; latest: string }> => {
  const text = await fetchText(url, { retries: 2 });
  if (!text) throw new Error(`Eurostat unreachable: ${url}`);
  const d = JSON.parse(text) as {
    updated?: string;
    dimension?: { time?: { category: { index: Record<string, number> } } };
  };
  const times = Object.keys(d.dimension?.time?.category.index ?? {}).sort();
  if (!d.updated || !times.length)
    throw new Error(`Eurostat: no 'updated' or time dimension for ${url}`);
  return {
    updated: d.updated,
    latest: required(times.at(-1), "Eurostat latest period"),
  };
};

export const eurostatVaccineTrade: WatchSource = {
  id: "eurostat_vaccine_trade",
  label: "Eurostat Comext — търговия с ваксини (CN 3002 41)",
  url: COMEXT_URL,
  cadence: "weekly",
  publishes: "monthly",
  async fingerprint(): Promise<Fingerprint> {
    // A one-year import query is small enough to answer synchronously and
    // carries the dataset's `updated` stamp and the latest month.
    const y = new Date().getUTCFullYear();
    const q = new URLSearchParams({
      format: "JSON",
      lang: "en",
      reporter: "BG",
      freq: "M",
      flow: "1",
      indicators: "VALUE_IN_EUROS",
      sinceTimePeriod: `${y - 1}-01`,
    });
    for (const p of VACCINE_CN_CODES) q.append("product", p);
    const { updated, latest } = await eurostatUpdated(`${COMEXT_URL}?${q}`);
    return {
      value: `${updated}|${latest}`,
      detail: `updated ${updated}, latest period ${latest}`,
      meta: { updated, latest },
    };
  },
};

export const eurostatFluCoverage: WatchSource = {
  id: "eurostat_flu_coverage",
  label: "Eurostat — обхват с грипна ваксина 65+ (hlth_ps_immu)",
  url: FLU_COVERAGE_URL,
  cadence: "weekly",
  publishes: "annual",
  async fingerprint(): Promise<Fingerprint> {
    const { updated, rows } = await fetchFluCoverage();
    const bg = rows
      .filter((r) => r.geo === "BG")
      .sort((a, b) => a.year - b.year)
      .at(-1);
    if (!bg) throw new Error("hlth_ps_immu: no Bulgarian row");
    return {
      value: `${updated}|${rows.length}`,
      detail: `updated ${updated}; BG ${bg.year} = ${bg.pct}%`,
      meta: { updated, bgYear: bg.year, bgPct: bg.pct },
    };
  },
};

export const VACCINE_SOURCES: WatchSource[] = [
  hisImmunizationsDaily,
  hisImmunizationApp,
  ialShortageList,
  ncipdFluWeekly,
  eurostatVaccineTrade,
  eurostatFluCoverage,
];
