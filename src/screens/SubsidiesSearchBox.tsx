// The beneficiary finder on /subsidies — 16,702 ДФЗ recipients with an ЕИК.
//
// THE ONLY SERVER TYPEAHEAD in the whole search feature. Every other group ships
// a pre-folded client index; 16.7k rows is past the point where that is free, so
// this queries per keystroke — debounced 200 ms with an AbortController, the
// AwarderSearch pattern.
//
// It reads the agri_beneficiary rollup, not agri_subsidies: the GROUP-BY form
// over ~2M rows measured 2,152 ms for "агро" and 3 ms against the rollup.
//
// Natural persons are absent by construction — `eik` is NULL for them, and
// /farm/:eik is the only destination, so a row without one could not land.

import { FC, useEffect, useMemo, useState } from "react";
import { Tractor } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import { entityGroup } from "@/screens/components/search/entityGroups";
import { buildEntityIndex, type EntityIndex } from "@/lib/entitySearchIndex";

type Row = {
  eik: string;
  name: string;
  oblast: string | null;
  totalEur: number;
};

export const SubsidiesSearchBox: FC = () => {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) {
      setRows(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/db/agri-search?q=${encodeURIComponent(t)}&limit=8`, {
        signal: ctl.signal,
      })
        .then((r) => r.json() as Promise<Row[]>)
        .then((r) => {
          if (ctl.signal.aborted) return;
          setRows(Array.isArray(r) ? r : []);
          setLoading(false);
        })
        .catch(() => {
          if (!ctl.signal.aborted) {
            setRows([]);
            setLoading(false);
          }
        });
    }, 200);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [term]);

  // The server already ranked and capped, so the "index" is a pass-through:
  // buildEntityIndex still folds it so the shell's own matching does not
  // re-filter the server's answer away.
  const index: EntityIndex | null = useMemo(() => {
    if (!rows) return null;
    return buildEntityIndex(
      rows,
      (r) => ({
        id: r.eik,
        label: r.name,
        sub: r.oblast ?? undefined,
        href: `/farm/${r.eik}`,
      }),
      (r) => [r.name, r.oblast, r.eik],
    );
  }, [rows]);

  const groups = useMemo(
    () => [
      entityGroup("farm", "Земеделски стопани", "Farm beneficiaries", index, {
        loading,
        icon: Tractor,
      }),
    ],
    [index, loading],
  );

  return (
    <SectorEntitySearch
      idPrefix="subsidies-search"
      groups={groups}
      onQueryChange={setTerm}
      title={{
        bg: "Намери земеделски стопанин",
        en: "Find a farm beneficiary",
      }}
      placeholder={{
        bg: "стопанин, фирма или ЕИК…",
        en: "beneficiary, company or EIK…",
      }}
      hint={{
        bg: "Търси по име, област или ЕИК — приема и изписване на латиница. Физическите лица нямат ЕИК и не се търсят.",
        en: "Search by name, province or EIK — Latin-typed queries work too. Natural persons have no EIK and are not searchable.",
      }}
    />
  );
};
