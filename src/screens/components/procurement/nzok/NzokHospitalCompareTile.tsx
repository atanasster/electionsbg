// "Сравни две болници" - grounded in our multi-year corpus: pick any two hospitals and
// see their НЗОК hospital-care spend, year-over-year change, and spend-growth
// percentile side by side. The picker lists EVERY matched hospital (all EIKs in
// the latest per-facility report, multi-site companies like ВМА collapsed to one
// entry), and each side reads the same transparent momentum-by-eik endpoint the
// /company/:eik badge uses. Pure UI over the payments list + two per-eik fetches.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Command as CommandPrimitive } from "cmdk";
import { GitCompareArrows, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Button } from "@/components/ui/button";
import {
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatEurCompact } from "@/lib/currency";
import { spendDeltaClass } from "@/lib/spendDelta";
import { decodeEntities } from "@/lib/decodeEntities";
import { useNzokHospitalMomentumByEik } from "@/data/budget/useBudget";
import type { NzokHospitalPaymentsFile } from "@/data/budget/types";

type HospitalOption = { eik: string; name: string; ytd: number };

// Searchable hospital picker — 256 matched hospitals is too many for a plain
// dropdown, so this is a Popover + cmdk combobox (type to filter by name),
// mirroring the CandidatePicker pattern.
const HospitalPicker: FC<{
  value: string;
  options: HospitalOption[];
  ariaLabel: string;
  onChange: (eik: string) => void;
}> = ({ value, options, ariaLabel, onChange }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.eik === value);
  const filtered = useMemo(() => {
    const q = query.toLocaleLowerCase();
    const out: HospitalOption[] = [];
    for (const o of options) {
      if (!q || decodeEntities(o.name).toLocaleLowerCase().includes(q))
        out.push(o);
      if (out.length >= 200) break;
    }
    return out;
  }, [options, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="h-8 w-full justify-between px-2 text-xs font-normal"
        >
          <span className="truncate">
            {selected ? decodeEntities(selected.name) : "—"}
          </span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[240px] p-0"
        align="start"
      >
        <CommandPrimitive shouldFilter={false}>
          <CommandInput
            placeholder={`${t("search")}...`}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{t("no_results")}</CommandEmpty>
            {filtered.map((o) => (
              <CommandPrimitive.Item
                key={o.eik}
                value={o.eik}
                onSelect={() => {
                  onChange(o.eik);
                  setOpen(false);
                  setQuery("");
                }}
                className="cursor-pointer px-2 py-1.5 text-xs aria-selected:bg-accent aria-selected:text-accent-foreground"
              >
                <span className="block min-w-0 truncate">
                  {decodeEntities(o.name)}
                </span>
              </CommandPrimitive.Item>
            ))}
          </CommandList>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
};

// One hospital's compared column. Reads the per-eik momentum endpoint (YoY +
// percentile) and falls back to the trends-row figures while it loads.
const CompareColumn: FC<{
  eik: string;
  name: string;
  fallbackYtd: number;
  lang: string;
  bg: boolean;
}> = ({ eik, name, fallbackYtd, lang, bg }) => {
  const { data: m } = useNzokHospitalMomentumByEik(eik);
  const eur = (v: number) => formatEurCompact(v, lang);
  const ytd = m?.currentYtdEur ?? fallbackYtd;
  return (
    <div className="min-w-0 space-y-1.5">
      <Link
        to={`/company/${eik}`}
        className="block min-w-0 truncate text-sm font-medium text-accent hover:underline"
        title={decodeEntities(name)}
      >
        {decodeEntities(name)}
      </Link>
      <div className="text-xl font-bold tabular-nums">{eur(ytd)}</div>
      <div className="text-[11px] text-muted-foreground">
        {bg ? "изплатено от НЗОК (натрупано)" : "paid by НЗОК (cumulative)"}
      </div>
      {m && (
        <>
          <div className="pt-1 text-xs">
            <span className="text-muted-foreground">
              {bg ? "На годишна база" : "Year-over-year"}:{" "}
            </span>
            <span className={`font-semibold ${spendDeltaClass(m.yoyDelta)}`}>
              {m.yoyDelta > 0 ? "+" : ""}
              {(m.yoyDelta * 100).toLocaleString(lang, {
                maximumFractionDigits: 1,
              })}
              %
            </span>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">
              {bg ? "Темп срещу други" : "Growth vs peers"}:{" "}
            </span>
            <span className="font-semibold">
              {bg
                ? `над ${Math.round(m.percentile * 100)}%`
                : `faster than ${Math.round(m.percentile * 100)}%`}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export const NzokHospitalCompareTile: FC<{
  data: NzokHospitalPaymentsFile;
}> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  // Pickable set: EVERY matched hospital (EIK) in the latest per-facility report.
  // A company can run several ЛЗ facilities (ВМА, Сърце и Мозък) — aggregate them
  // to one entry per EIK (sum the YTD, keep the largest facility's name), so the
  // picker mirrors the per-company momentum-by-eik endpoint. Unmatched facilities
  // (no EIK) are omitted — the endpoint and the /company link both need an EIK.
  const options = useMemo(() => {
    const byEik = new Map<
      string,
      { eik: string; name: string; ytd: number; topFacEur: number }
    >();
    for (const h of data.hospitals) {
      if (!h.eik) continue;
      const cur = byEik.get(h.eik);
      if (!cur) {
        byEik.set(h.eik, {
          eik: h.eik,
          name: h.name,
          ytd: h.cumulativeEur,
          topFacEur: h.cumulativeEur,
        });
      } else {
        cur.ytd += h.cumulativeEur;
        // Label the company by its biggest ЛЗ facility.
        if (h.cumulativeEur > cur.topFacEur) {
          cur.topFacEur = h.cumulativeEur;
          cur.name = h.name;
        }
      }
    }
    return [...byEik.values()]
      .map(({ eik, name, ytd }) => ({ eik, name, ytd }))
      .sort((a, b) => b.ytd - a.ytd);
  }, [data.hospitals]);

  const [aEik, setAEik] = useState<string>(() => options[0]?.eik ?? "");
  const [bEik, setBEik] = useState<string>(() => options[1]?.eik ?? "");

  if (options.length < 2) return null;

  const a = options.find((o) => o.eik === aEik) ?? options[0];
  const b = options.find((o) => o.eik === bEik) ?? options[1];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4" />
          {bg ? "Сравни две болници" : "Compare two hospitals"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <HospitalPicker
            value={a.eik}
            options={options}
            ariaLabel={bg ? "Първа болница" : "First hospital"}
            onChange={setAEik}
          />
          <HospitalPicker
            value={b.eik}
            options={options}
            ariaLabel={bg ? "Втора болница" : "Second hospital"}
            onChange={setBEik}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <CompareColumn
            eik={a.eik}
            name={a.name}
            fallbackYtd={a.ytd}
            lang={lang}
            bg={bg}
          />
          <CompareColumn
            eik={b.eik}
            name={b.name}
            fallbackYtd={b.ytd}
            lang={lang}
            bg={bg}
          />
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Сумите са натрупани плащания за болнична помощ; темпът е спрямо същия период на предходната година, а класирането по темп е сред всички болници с достатъчна база."
            : "Figures are cumulative hospital-care payments; growth is vs the same period a year earlier, and the percentile ranks against all hospitals above a base floor."}
        </p>
      </CardContent>
    </Card>
  );
};
