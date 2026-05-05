import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Briefcase, ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { useCompanyIndex } from "@/data/parliament/useCompanyIndex";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";

type SortKey = "name" | "mps" | "status";
type SortDir = "asc" | "desc";

const STATUS_CLASSES: Record<string, string> = {
  active:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  in_liquidation:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  bankrupt: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
  ceased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  erased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

export const AllMpCompaniesScreen: FC = () => {
  const { t } = useTranslation();
  const { companies, isLoading } = useCompanyIndex();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("mps");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    const q = query
      .toLowerCase()
      .replace(/["“”„«»]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const result = companies
      .map((c) => {
        // One MP can declare the same company across multiple years and the
        // declarantName casing varies between filings (cacbg writes some years
        // ALL CAPS, others Title Case). Dedup case-insensitively, keeping the
        // first observed display form for each.
        const seen = new Map<string, { name: string; mpId: number | null }>();
        for (const s of c.stakes) {
          const key = s.declarantName.toUpperCase().replace(/\s+/g, " ").trim();
          if (!seen.has(key))
            seen.set(key, { name: s.declarantName, mpId: s.mpId ?? null });
        }
        return { ...c, distinctMps: Array.from(seen.values()) };
      })
      .filter((c) => {
        if (!q) return true;
        const hayParts = [c.displayName, ...c.registeredOffices];
        if (c.tr?.uic) hayParts.push(c.tr.uic);
        for (const s of c.stakes) hayParts.push(s.declarantName);
        const hay = hayParts.join(" ").toLowerCase();
        return hay.includes(q);
      });
    result.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.displayName.localeCompare(b.displayName, "bg", {
          sensitivity: "base",
        });
      } else if (sortKey === "mps") {
        cmp = a.distinctMps.length - b.distinctMps.length;
        if (cmp === 0) cmp = a.displayName.localeCompare(b.displayName, "bg");
      } else {
        // status: active > in_liquidation > ceased > bankrupt > unknown/null
        const order = { active: 4, in_liquidation: 3, ceased: 2, bankrupt: 1 };
        const sa = order[a.tr?.status as keyof typeof order] ?? 0;
        const sb = order[b.tr?.status as keyof typeof order] ?? 0;
        cmp = sa - sb;
        if (cmp === 0) cmp = a.displayName.localeCompare(b.displayName, "bg");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [companies, query, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const sortIndicator = (key: SortKey): string =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <Title description={t("all_companies_description") || ""}>
        {t("all_companies") || "Companies declared by MPs"}
      </Title>

      <div className="flex flex-wrap gap-3 items-center my-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            t("all_companies_search_placeholder") ||
            "Search by name, MP, UIC, or city…"
          }
          className="px-3 py-1.5 rounded border border-border bg-background flex-1 min-w-[260px]"
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length}/{companies.length}{" "}
          {(t("connections_legend_company") || "company").toLowerCase()}
        </span>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          {t("loading") || "Loading…"}
        </div>
      ) : (
        <div className="border rounded">
          <div className="grid grid-cols-[2fr_1fr_auto_auto] gap-2 px-3 py-2 bg-muted/40 text-xs font-semibold border-b">
            <button
              type="button"
              onClick={() => toggleSort("name")}
              className="text-left hover:underline"
            >
              {t("all_companies_col_name") || "Company"}
              {sortIndicator("name")}
            </button>
            <span>{t("all_companies_col_mps") || "Declared by"}</span>
            <button
              type="button"
              onClick={() => toggleSort("mps")}
              className="text-right hover:underline w-12"
            >
              #{sortIndicator("mps")}
            </button>
            <button
              type="button"
              onClick={() => toggleSort("status")}
              className="text-right hover:underline w-24"
            >
              {t("all_companies_col_status") || "Status"}
              {sortIndicator("status")}
            </button>
          </div>
          <div className="divide-y">
            {filtered.map((c, idx) => (
              <div
                // The slug isn't strictly unique across the index — two
                // companies whose names differ only in casing/punctuation can
                // collide on slug. Pair with the array index for a stable key.
                key={`${c.slug}-${idx}`}
                className="grid grid-cols-[2fr_1fr_auto_auto] gap-2 px-3 py-2 items-baseline text-sm hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <Link
                    to={`/mp/company/${encodeURIComponent(c.slug)}`}
                    className="font-medium truncate block hover:underline"
                  >
                    <Briefcase className="inline h-3.5 w-3.5 mr-1 text-muted-foreground -mt-0.5" />
                    {c.displayName}
                  </Link>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.registeredOffices.length > 0 && (
                      <span>{c.registeredOffices.join(" · ")}</span>
                    )}
                    {c.tr?.uic && (
                      <a
                        href={`https://portal.registryagency.bg/CR/en/Reports/VerifiedPersonShortInfo?uic=${c.tr.uic}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {t("tr_eik") || "UIC"} {c.tr.uic}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="min-w-0 text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  {c.distinctMps.slice(0, 3).map((m) => (
                    <span
                      key={m.name}
                      className="inline-flex items-center gap-1 max-w-full"
                    >
                      <MpAvatar
                        name={m.name}
                        mpId={m.mpId ?? undefined}
                        className="h-4 w-4"
                      />
                      <Link
                        to={
                          m.mpId != null
                            ? candidateUrlForMp(m.mpId)
                            : `/candidate/${encodeURIComponent(m.name)}`
                        }
                        className="hover:underline truncate"
                      >
                        {m.name}
                      </Link>
                    </span>
                  ))}
                  {c.distinctMps.length > 3 && (
                    <span>+{c.distinctMps.length - 3}</span>
                  )}
                </div>
                <div className="text-right tabular-nums w-12">
                  {c.distinctMps.length}
                </div>
                <div className="w-24 text-right">
                  {c.tr?.status ? (
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        STATUS_CLASSES[c.tr.status] ?? STATUS_CLASSES.active
                      }`}
                    >
                      {t(`tr_status_${c.tr.status}`) || c.tr.status}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-sm text-muted-foreground text-center">
                {t("no_results") || "No results"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
