// /budget/mod — "какъв е минималният осигурителен доход за моята професия".
//
// Прил. 1/1А ЗБДОО is the richest thing in the 2026 package and the only one
// that is personal: 86 КИД-2025 activities × 9 occupational qualification
// groups, telling any employee the legal minimum their employer must insure
// them on. Nobody in Bulgaria publishes it browsably — it exists as a table
// inside a 1.5 MB Държавен вестник page.
//
// The two periods are the story, not a technicality. Jan–Jul is the frozen
// carry-over (2.2% of cells clear the €550.66 floor); from 1 August the
// schedule was genuinely renegotiated (66.9% clear €620.20). Showing both side
// by side is what makes "your floor went up in August" legible.
//
// Прил. 2/2А rides along: the ТЗПБ work-injury rate is set per activity too, so
// the same КИД selection answers the employer-cost half.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Title } from "@/ux/Title";
import { formatEur } from "@/lib/currency";
import { useSearchParams } from "react-router-dom";
import { useModSchedule, useTzpbRates } from "@/data/budget/useBudget";

const norm = (s: string): string => s.toLocaleLowerCase("bg-BG").trim();

export const BudgetModScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang.startsWith("bg");
  const { data: mod } = useModSchedule();
  const { data: tzpb } = useTzpbRates();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");

  // Selection is keyed on the law's ПОРЕДЕН НОМЕР, not the КИД code. The code
  // is neither unique nor total: "86.1" appears on three rows with different
  // names AND different euro values (picking one showed €683.09 where €563.95
  // was meant), and „Централен кооперативен съюз" has no code at all, so it was
  // silently unselectable. The ordinal is the law's own row identifier.
  const selectedOrdinal = Number(searchParams.get("row") ?? "");

  const rows = useMemo(() => {
    if (!mod) return [];
    // The two periods list the same activities in the same order — verified
    // against the promulgated text (86/86, no ordinal mismatch). Pair on the
    // ORDINAL rather than trusting position, so a future year whose annexes
    // diverge shows a gap instead of silently pairing the wrong rows.
    const [p1, p1a] = mod.periods;
    const afterByOrdinal = new Map(
      (p1a?.rows ?? []).map((r) => [r.ordinal, r.byQualificationGroup]),
    );
    return p1.rows.map((r) => ({
      ordinal: r.ordinal,
      kidCode: r.kidCode,
      kidSection: r.kidSection,
      name: r.activityName,
      before: r.byQualificationGroup,
      after: afterByOrdinal.get(r.ordinal) ?? [],
    }));
  }, [mod]);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return rows;
    return rows.filter(
      (r) => norm(r.name).includes(q) || norm(r.kidCode).includes(q),
    );
  }, [rows, query]);

  const selected = useMemo(
    () => rows.find((r) => r.ordinal === selectedOrdinal) ?? null,
    [rows, selectedOrdinal],
  );

  // Прил. 1 and Прил. 2 are keyed at DIFFERENT КИД granularities — an exact
  // match resolves only 25 of the 86 activities, so 71% would render "—%".
  // Fall back to the longest ТЗПБ code that prefixes this activity's code
  // (ТЗПБ is set at the coarser level, so the parent rate is the applicable
  // one), and report honestly when even that finds nothing.
  const tzpbFor = useMemo(() => {
    if (!tzpb || !selected?.kidCode) return null;
    const find = (i: number): number | null => {
      const rows = tzpb.periods[i]?.rows ?? [];
      const exact = rows.find((x) => x.kidCode === selected.kidCode);
      if (exact) return exact.ratePct;
      const prefixed = rows
        .filter((x) => selected.kidCode.startsWith(x.kidCode))
        .sort((a, b) => b.kidCode.length - a.kidCode.length)[0];
      return prefixed?.ratePct ?? null;
    };
    const before = find(0);
    const after = find(1);
    return before == null && after == null ? null : { before, after };
  }, [tzpb, selected]);

  const eur = (v: number | null): string =>
    v == null ? "—" : formatEur(v, lang, { decimals: 2 });

  const select = (ordinal: number | null): void => {
    const next = new URLSearchParams(searchParams);
    if (ordinal != null) next.set("row", String(ordinal));
    else next.delete("row");
    setSearchParams(next, { replace: true });
  };

  const title = t("mod_browser_title");

  return (
    <>
      <Title description={t("mod_browser_desc")}>{title}</Title>

      <Card className="my-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4" />
            {t("mod_browser_pick")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("mod_browser_intro")}
          </p>
        </CardHeader>
        <CardContent className="p-3 md:p-4 space-y-3">
          <label className="relative block">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("mod_browser_search")}
              className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-3 text-sm"
              aria-label={t("mod_browser_search")}
            />
          </label>

          <div className="max-h-64 overflow-y-auto rounded-md border">
            {filtered.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">
                {t("mod_browser_none")}
              </p>
            ) : (
              <ul className="divide-y">
                {filtered.map((r) => (
                  <li key={r.ordinal}>
                    <button
                      type="button"
                      onClick={() => select(r.ordinal)}
                      className={
                        "flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/50 " +
                        (selected?.ordinal === r.ordinal ? "bg-muted" : "")
                      }
                    >
                      <span className="tabular-nums text-muted-foreground w-16 shrink-0">
                        {r.kidCode || "—"}
                      </span>
                      <span className="min-w-0 truncate">{r.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {selected && mod ? (
        <Card className="my-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{selected.name}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("mod_browser_kid", { code: selected.kidCode || "—" })}
            </p>
          </CardHeader>
          <CardContent className="p-3 md:p-4 space-y-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-normal">
                    {t("mod_browser_group")}
                  </th>
                  <th className="py-1 pr-3 text-right font-normal">
                    {mod.periods[0].periodFrom.slice(0, 7)} –{" "}
                    {mod.periods[0].periodTo.slice(5, 7)}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {t("mod_browser_from_aug")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {mod.qualificationGroups.map((g, i) => {
                  const b = selected.before[i] ?? null;
                  const a = selected.after[i] ?? null;
                  const rose = b != null && a != null && a > b;
                  return (
                    <tr key={g} className="border-t">
                      <td className="py-1 pr-3">{g}</td>
                      <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
                        {eur(b)}
                      </td>
                      <td
                        className={
                          "py-1 text-right tabular-nums " +
                          (rose ? "font-medium text-emerald-600" : "")
                        }
                      >
                        {eur(a)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {tzpbFor ? (
              <p className="text-xs">
                {t("mod_browser_tzpb", {
                  before: tzpbFor.before ?? "—",
                  after: tzpbFor.after ?? "—",
                })}
              </p>
            ) : null}

            <p className="text-[11px] text-muted-foreground">
              {bg ? mod.source.description : mod.source.description}{" "}
              <a
                href={mod.source.url}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted"
              >
                {mod.source.dvIssue}
              </a>
            </p>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
};

export default BudgetModScreen;
