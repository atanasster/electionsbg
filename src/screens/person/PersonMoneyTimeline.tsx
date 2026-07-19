// The "money vs power" timeline: public contracts won by the person's companies, bucketed by
// which cabinet was in power (person-candidate-merge). EIK-exact via person_money() (082) —
// lazily loaded here so the heavier contracts range-join stays off person_by_slug's hot path.
//
// FRAMING (defamation-safe): this is money the person's COMPANIES won while a cabinet governed
// — a national-timeline overlay, NOT a claim the person directed it. The hint says so.

import { FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";

type Bucket = {
  id: string;
  pm: string;
  parties: string[] | null;
  start: string;
  end: string | null;
  type: string;
  contracts: number;
  eur: number;
};

const fmtYear = (d?: string | null): string =>
  d ? (/^(\d{4})/.exec(d)?.[1] ?? d) : "";

export const PersonMoneyTimeline: FC<{ slug: string }> = ({ slug }) => {
  const { t } = useTranslation();
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/db/person-money?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: Bucket[]) => live && setBuckets(Array.isArray(j) ? j : []))
      .catch(() => live && setBuckets([]));
    return () => {
      live = false;
    };
  }, [slug]);

  if (!buckets || buckets.length === 0) return null;
  const max = Math.max(...buckets.map((b) => b.eur), 1);

  return (
    <DashboardSection
      id="person-money"
      title={t("pp_money_by_cabinet")}
      icon={Landmark}
      subtitle={t("pp_money_by_cabinet_hint")}
    >
      <Card>
        <CardContent className="space-y-3 pt-6">
          {buckets.map((b) => (
            <div key={b.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{b.pm}</span>
                <span className="shrink-0 whitespace-nowrap text-xs font-medium text-foreground">
                  {formatEurCompact(b.eur)}
                  <span className="ml-1 font-normal text-muted-foreground">
                    {t("pp_in_contracts", { count: b.contracts })}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded bg-primary"
                  style={{ width: `${Math.max((b.eur / max) * 100, 2)}%` }}
                />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {fmtYear(b.start)}–{fmtYear(b.end) || "…"}
                {b.parties?.length ? ` · ${b.parties.join(", ")}` : ""}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
