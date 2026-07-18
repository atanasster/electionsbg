// Multi-election-year combine.
//
// Several Bulgarian parliamentary years held more than one election (2021 ran in
// April, July and November; 2024 in June and October). When a question names
// such a year WITHOUT pinning a month, we don't silently answer for the newest
// ballot — we run the asked tool for every election in the year and merge the
// results into one comparison answer:
//   - a scalar metric with a numeric headline (turnout, machine share) -> a bar
//     with one bar per election;
//   - a per-party results table -> an aligned table (party rows × one value
//     column per election);
//   - any other scalar -> a small table (one row per election);
//   - mixed/unexpected shapes -> the newest ballot, flagged in the subtitle.
//
// The trigger lives here too (`yearScope`); `runTool` calls it for every path
// (offline + cloud routers, the Explorer), so the behaviour is uniform.

import type { ElectionInfo } from "../../src/data/dataTypes";
import { electionsChrono } from "./dataset";
import { factLabel } from "../render/factLabels";
import { electionShortLabel, fmtInt, fmtPct } from "./format";
import type {
  Column,
  Envelope,
  Row,
  ToolArgs,
  ToolContext,
  ToolDef,
} from "./types";

// Does the tool take a single `election` arg? The series/compare tools take
// counts or a/b instead, so they're never fanned out across a year.
const isElectionScoped = (tool: ToolDef): boolean =>
  tool.params.some((p) => p.name === "election" && p.type === "election");

// Tools whose envelope ALREADY spans two elections — vote transitions are
// inherently "prior ballot → this ballot", so fanning them across a year would
// line up mismatched baselines (April→July next to July→Nov). They answer for
// the single resolved election (the newest in the year) instead.
const CROSS_ELECTION_TOOLS = new Set(["voteTransitions"]);

// A month token AFTER the year ("2021_07", "2021-07-11") pins one ballot — the
// keyword router resolves month NAMES to an exact date before we get here, and
// the cloud router emits ISO-ish strings. Mirrors resolveElection's month check.
const hasMonth = (raw: string, yearIdx: number): boolean =>
  /0[1-9]|1[0-2]/.test(raw.slice(yearIdx + 4));

// When `args.election` is a bare, monthless year that held >1 election, return
// that year + its ballots (chronological); otherwise null (answer one election).
export const yearScope = (
  tool: ToolDef,
  args: ToolArgs,
): { year: string; elections: ElectionInfo[] } | null => {
  if (!isElectionScoped(tool)) return null;
  if (CROSS_ELECTION_TOOLS.has(tool.name)) return null;
  const a = args.election;
  if (typeof a !== "string" || !a) return null;
  const m = a.match(/20\d{2}/);
  if (!m) return null;
  if (hasMonth(a, m.index ?? 0)) return null; // a month pins a single ballot
  const year = m[0];
  const elections = electionsChrono().filter((e) =>
    e.name.startsWith(`${year}_`),
  );
  return elections.length > 1 ? { year, elections } : null;
};

// Identity / lookup keys that shouldn't become comparison columns. `color` is a
// per-row render hint (the hemicycle's party colour), never a value to compare.
const DROP_KEYS = new Set(["election", "party", "query", "name", "color"]);

export const combineByElection = async (
  tool: ToolDef,
  args: ToolArgs,
  ctx: ToolContext,
  year: string,
  elections: ElectionInfo[],
): Promise<Envelope> => {
  const t = (bg: string, en: string) => (ctx.lang === "bg" ? bg : en);
  const labelOf = (e: ElectionInfo) => electionShortLabel(e.name, ctx.lang);
  const labelFor = (k: string) => factLabel(k, ctx.lang);

  // Run the tool for each ballot (chronological); drop any that error or 404 —
  // the combine should survive a single missing data file.
  const settled = await Promise.all(
    elections.map(async (e) => {
      try {
        return { e, env: await tool.run({ ...args, election: e.name }, ctx) };
      } catch {
        return null;
      }
    }),
  );
  const got = settled.filter(
    (x): x is { e: ElectionInfo; env: Envelope } => x != null,
  );

  // Honest "couldn't combine" subtitle: name the one ballot we're actually
  // showing and say the rest lacked comparable data — never claim a comparison
  // that isn't on screen.
  const onlyNote = (e: ElectionInfo) =>
    t(
      `Показани са данните за ${labelOf(e)}; останалите избори през ${year} нямат сравними данни.`,
      `Showing ${labelOf(e)}; the other ${year} elections have no comparable data.`,
    );

  // Fallback: fewer than two ballots produced data — show the one we have.
  if (got.length < 2) {
    const shown =
      got[0] ??
      (() => {
        const newest = elections[elections.length - 1];
        return { e: newest, env: null as Envelope | null };
      })();
    const env =
      shown.env ?? (await tool.run({ ...args, election: shown.e.name }, ctx));
    env.subtitle = onlyNote(shown.e);
    return env;
  }

  const base = got[0].env;
  // Most snapshot titles read "<label> — <ballot date>"; strip the date suffix.
  // Titles without that separator (e.g. ones that embed a date mid-string) are
  // left as-is — the year is conveyed by the subtitle instead of being appended.
  const hasSep = base.title.includes(" — ");
  const baseLabel = hasSep ? base.title.split(" — ")[0] : base.title;
  const title = hasSep
    ? t(`${baseLabel} през ${year}`, `${baseLabel} in ${year}`)
    : baseLabel;
  const subtitle = t(
    `Сравнение на ${got.length} избора през ${year}`,
    `Comparing ${got.length} elections in ${year}`,
  );
  const provenance = [...new Set(got.flatMap((g) => g.env.provenance))];

  // 1) scalar metric with a numeric headline -> one bar per election
  if (got.every((g) => g.env.kind === "scalar" && g.env.value != null)) {
    const fmtVal = (v: number) =>
      base.valueFormat === "pct" ? fmtPct(v, ctx.lang) : fmtInt(v, ctx.lang);
    const points = got.map((g) => ({
      x: labelOf(g.e),
      y: g.env.value ?? null,
    }));
    const ranked = [...got].sort(
      (a, b) => (b.env.value ?? 0) - (a.env.value ?? 0),
    );
    const top = ranked[0];
    const bottom = ranked[ranked.length - 1];
    const facts: Record<string, string | number> = {
      year,
      elections_count: got.length,
      highest: `${fmtVal(top.env.value ?? 0)} (${labelOf(top.e)})`,
      lowest: `${fmtVal(bottom.env.value ?? 0)} (${labelOf(bottom.e)})`,
    };
    got.forEach((g) => {
      facts[labelOf(g.e)] = fmtVal(g.env.value ?? 0);
    });
    return {
      tool: "yearCompare",
      kind: "series",
      title,
      subtitle,
      categories: got.map((g) => labelOf(g.e)),
      series: [{ key: "value", label: baseLabel, points }],
      viz: "bar",
      facts,
      provenance,
    };
  }

  // 2) per-party (table) results -> aligned table, one value column per election
  if (
    got.every(
      (g) =>
        g.env.kind === "table" && g.env.columns?.length && g.env.rows?.length,
    )
  ) {
    const keyCol = base.columns![0].key; // the row identity (e.g. "party")
    const valCol = base.columns!.find((c) => c.numeric) ?? base.columns![1];
    // union of row keys, ranked by their total of the value column across ballots
    const totals = new Map<string, number>();
    got.forEach((g) =>
      g.env.rows!.forEach((r) => {
        const k = String(r[keyCol] ?? "");
        if (!k) return;
        const v = Number(r[valCol.key] ?? 0);
        totals.set(k, (totals.get(k) ?? 0) + (Number.isFinite(v) ? v : 0));
      }),
    );
    const rowKeys = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([k]) => k);
    const columns: Column[] = [
      { key: "k", label: base.columns![0].label },
      ...got.map((g) => ({
        key: g.e.name,
        label: labelOf(g.e),
        numeric: true,
        format: valCol.format,
      })),
    ];
    const rows: Row[] = rowKeys.map((k) => {
      const row: Row = { k };
      got.forEach((g) => {
        const hit = g.env.rows!.find((r) => String(r[keyCol] ?? "") === k);
        row[g.e.name] = hit ? (hit[valCol.key] ?? null) : null;
      });
      return row;
    });
    return {
      tool: "yearCompare",
      kind: "table",
      title,
      subtitle: t(
        `${subtitle} (по „${valCol.label}“)`,
        `${subtitle} (by ${valCol.label})`,
      ),
      columns,
      rows,
      viz: "none",
      facts: { year, elections_count: got.length, metric: valCol.label },
      provenance,
    };
  }

  // 3) other scalars -> a small table, one row per election
  if (got.every((g) => g.env.kind === "scalar")) {
    const keys: string[] = [];
    got.forEach((g) =>
      Object.keys(g.env.facts).forEach((k) => {
        if (!DROP_KEYS.has(k) && !keys.includes(k)) keys.push(k);
      }),
    );
    const columns: Column[] = [
      { key: "k", label: t("Избор", "Election") },
      ...keys.map((k) => ({ key: k, label: labelFor(k) })),
    ];
    const rows: Row[] = got.map((g) => {
      const row: Row = { k: labelOf(g.e) };
      keys.forEach((k) => {
        row[k] = g.env.facts[k] ?? null;
      });
      return row;
    });
    return {
      tool: "yearCompare",
      kind: "table",
      title,
      subtitle,
      columns,
      rows,
      viz: "none",
      facts: { year, elections_count: got.length },
      provenance,
    };
  }

  // 4) mixed / unexpected shapes -> the newest ballot, flagged honestly.
  const last = got[got.length - 1];
  last.env.subtitle = onlyNote(last.e);
  return last.env;
};
