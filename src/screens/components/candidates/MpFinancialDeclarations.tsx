import { FC, Fragment, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Briefcase, ExternalLink, ArrowRightLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMpDeclarations } from "@/data/parliament/useMpDeclarations";
import type { MpDeclaration, MpOwnershipStake } from "@/data/dataTypes";

const formatBgn = (n: number | null, lang: string): string => {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return String(n);
  }
};

type StakeYear = {
  year: number;
  fromFiscal: boolean;
  shareSize: string | null;
  valueBgn: number | null;
};

type StakeRange = {
  fromYear: number;
  toYear: number;
  fromFiscal: boolean;
  shareSize: string | null;
  valueBgn: number | null;
};

type ConsolidatedStake = {
  key: string;
  table: "10" | "11";
  companyName: string;
  companySlug: string | null;
  itemType: string | null;
  registeredOffice: string | null;
  holderName: string | null;
  heldByOther: boolean;
  ranges: StakeRange[];
  latestYear: number;
};

const yearKey = (decl: MpDeclaration): { year: number; fromFiscal: boolean } =>
  decl.fiscalYear != null
    ? { year: decl.fiscalYear, fromFiscal: true }
    : { year: decl.declarationYear, fromFiscal: false };

const groupKey = (s: MpOwnershipStake): string => {
  const company = (s.companySlug ?? s.companyName ?? "").trim().toLowerCase();
  const holder = (s.holderName ?? "").trim().toLowerCase();
  return `${s.table}|${company}|${holder}`;
};

const collapseRanges = (entries: StakeYear[]): StakeRange[] => {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => a.year - b.year);
  const ranges: StakeRange[] = [];
  for (const e of sorted) {
    const last = ranges[ranges.length - 1];
    const sameValues =
      last &&
      last.shareSize === e.shareSize &&
      last.valueBgn === e.valueBgn &&
      // only collapse contiguous or duplicate years (gaps break the range)
      e.year - last.toYear <= 1;
    if (sameValues) {
      last.toYear = Math.max(last.toYear, e.year);
    } else {
      ranges.push({
        fromYear: e.year,
        toYear: e.year,
        fromFiscal: e.fromFiscal,
        shareSize: e.shareSize,
        valueBgn: e.valueBgn,
      });
    }
  }
  return ranges;
};

const consolidate = (declarations: MpDeclaration[]): ConsolidatedStake[] => {
  // Sort declarations newest first so the "most recent record per year" wins
  // when two declarations cover the same fiscal year.
  const decls = [...declarations].sort(
    (a, b) => b.declarationYear - a.declarationYear,
  );
  const groups = new Map<
    string,
    {
      stakes: Array<{
        stake: MpOwnershipStake;
        year: number;
        fromFiscal: boolean;
      }>;
      first: MpOwnershipStake;
    }
  >();
  for (const decl of decls) {
    const { year, fromFiscal } = yearKey(decl);
    for (const stake of decl.ownershipStakes) {
      const k = groupKey(stake);
      let g = groups.get(k);
      if (!g) {
        g = { stakes: [], first: stake };
        groups.set(k, g);
      }
      g.stakes.push({ stake, year, fromFiscal });
    }
  }
  const result: ConsolidatedStake[] = [];
  for (const [key, g] of groups) {
    // Dedupe by year — first hit wins (decls are newest-first).
    const byYear = new Map<number, StakeYear>();
    for (const { stake, year, fromFiscal } of g.stakes) {
      if (byYear.has(year)) continue;
      byYear.set(year, {
        year,
        fromFiscal,
        shareSize: stake.shareSize,
        valueBgn: stake.valueBgn,
      });
    }
    const ranges = collapseRanges(Array.from(byYear.values()));
    const declarantName = decls[0]?.declarantName ?? "";
    const holder = g.first.holderName?.trim() ?? null;
    const heldByOther = !!(
      holder && holder.toLowerCase() !== declarantName.trim().toLowerCase()
    );
    result.push({
      key,
      table: g.first.table,
      companyName: g.first.companyName ?? "—",
      companySlug: g.first.companySlug ?? null,
      itemType: g.first.itemType,
      registeredOffice: g.first.registeredOffice,
      holderName: holder,
      heldByOther,
      ranges,
      latestYear: ranges.length ? ranges[ranges.length - 1].toYear : 0,
    });
  }
  // Newest-active first; current holdings (table 10) above transfers (table 11).
  return result.sort((a, b) => {
    if (a.table !== b.table) return a.table === "10" ? -1 : 1;
    if (b.latestYear !== a.latestYear) return b.latestYear - a.latestYear;
    return a.companyName.localeCompare(b.companyName);
  });
};

const RangeLabel: FC<{ r: StakeRange; lang: string }> = ({ r, lang }) => {
  const yearLabel =
    r.fromYear === r.toYear ? `${r.fromYear}` : `${r.fromYear}–${r.toYear}`;
  const parts: string[] = [];
  if (r.shareSize) parts.push(r.shareSize);
  if (r.valueBgn != null) parts.push(`${formatBgn(r.valueBgn, lang)} лв`);
  return (
    <span className="font-mono">
      <span className="text-muted-foreground">{yearLabel}</span>
      {parts.length > 0 && <span className="ml-1.5">{parts.join(" · ")}</span>}
    </span>
  );
};

const StakeRow: FC<{ stake: ConsolidatedStake; lang: string }> = ({
  stake,
  lang,
}) => {
  const { t } = useTranslation();
  const Icon = stake.table === "11" ? ArrowRightLeft : Briefcase;
  const slug = stake.companySlug;
  const subtitle = [stake.itemType, stake.registeredOffice]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 items-start py-2 border-b last:border-b-0">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5" />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium truncate">
            {slug ? (
              <Link
                to={`/mp/company/${encodeURIComponent(slug)}`}
                className="hover:underline"
              >
                {stake.companyName}
              </Link>
            ) : (
              stake.companyName
            )}
            {stake.table === "11" && (
              <span className="ml-2 text-xs font-normal text-muted-foreground italic">
                {t("stake_transferred") || "transferred"}
              </span>
            )}
          </div>
        </div>
        {subtitle && (
          <div className="text-xs text-muted-foreground truncate">
            {subtitle}
          </div>
        )}
        {stake.heldByOther && stake.holderName && (
          <div className="text-xs text-muted-foreground italic truncate">
            {stake.holderName}
          </div>
        )}
        {stake.ranges.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {stake.ranges.map((r, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <span
                    aria-hidden
                    className="text-muted-foreground/60 select-none"
                  >
                    →
                  </span>
                )}
                <RangeLabel r={r} lang={lang} />
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const MpFinancialDeclarations: FC<{ name: string }> = ({ name }) => {
  const { t, i18n } = useTranslation();
  const { declarations } = useMpDeclarations(name);

  const consolidated = useMemo(
    () => consolidate(declarations.filter((d) => d.ownershipStakes.length > 0)),
    [declarations],
  );

  const sourceDecls = useMemo(
    () =>
      [...declarations]
        .filter((d) => d.ownershipStakes.length > 0)
        .sort((a, b) => b.declarationYear - a.declarationYear),
    [declarations],
  );

  if (consolidated.length === 0) return null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Briefcase className="h-4 w-4" />
          {t("business_interests") || "Business interests"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div>
          {consolidated.map((s) => (
            <StakeRow key={s.key} stake={s} lang={i18n.language} />
          ))}
        </div>
        {sourceDecls.length > 0 && (
          <div className="text-xs text-muted-foreground mt-3 pt-3 border-t flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>register.cacbg.bg:</span>
            {sourceDecls.map((d, i) => (
              <a
                key={i}
                href={d.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
                title={
                  d.fiscalYear != null
                    ? `${t("declaration_year") || "Declaration"} ${d.declarationYear} · ${t("fiscal_year") || "fiscal year"} ${d.fiscalYear}`
                    : `${t("declaration_year") || "Declaration"} ${d.declarationYear}`
                }
              >
                {d.declarationYear}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}
        <div className="text-xs text-muted-foreground mt-3 pt-3 border-t">
          {t("source_declarations") ||
            "Source: property/interest declarations filed with the Bulgarian Court of Audit (Сметна палата). Sitting MPs cannot legally hold management roles, so this list covers ownership stakes only."}
        </div>
      </CardContent>
    </Card>
  );
};
