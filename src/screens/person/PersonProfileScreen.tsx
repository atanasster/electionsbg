// Unified person-identity profile (/person/:key) — the Phase-3 page over the resolved
// person layer (scripts/person/resolve_persons.ts → 082 person_by_slug). It leads with the
// cross-source IDENTITY spine: every office, candidacy, company and donation that resolves
// to ONE person_id, regardless of how each dataset was ingested.
//
// Dispatcher: the param may be a stable person `slug` (new links) OR a bare name (the
// legacy magistrate/TR-graph links into /person/:name). We try the slug profile first; a
// miss falls back to the legacy portfolio screen (PersonScreen) so no inbound link breaks.
// Only active + public-safe roles reach the payload (person_by_slug enforces §3/§6).

import { FC, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PersonProfile, usePersonProfile } from "./usePersonProfile";
import { PersonHeader } from "./PersonHeader";
import { PersonElectoralSection } from "./PersonElectoralSection";
import { PersonMpSections } from "./PersonMpSections";
import { PersonOfficialAssets } from "./PersonOfficialAssets";
import { PersonMoneyTimeline } from "./PersonMoneyTimeline";
import { PersonCompanies } from "./PersonCompanies";
import {
  PersonConnections,
  type PersonConnectionsData,
} from "./PersonConnections";
import { PersonMagistrateHoldingsTile } from "@/screens/components/procurement/PersonMagistrateHoldingsTile";
import { useTranslation } from "react-i18next";
import {
  Coins,
  ExternalLink,
  FileWarning,
  HeartHandshake,
  Landmark,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { trRoleLabel } from "@/lib/trRole";
import { magistrateRoleKey } from "@/lib/magistrateRole";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { PersonScreen } from "@/screens/dev/PersonScreen";
import { useMpAssets } from "@/data/parliament/useMpAssets";

// "2021_11_14" -> "14.11.2021"; anything else passes through.
const fmtElection = (d: string): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
};

// The shared person dashboard body — rendered by /person/:slug and (Phase 5) /candidate/:id.
// Pure render over an already-fetched profile; fetching lives in usePersonProfile so both
// entry routes can share it.
export const PersonDashboard: FC<{ p: PersonProfile }> = ({ p }) => {
  const { t } = useTranslation();

  // Person↔person edges (shared company, association-noise-guarded, public-safe) — the
  // §8 Connections surface. Loaded lazily; absent for most people.
  const [conn, setConn] = useState<PersonConnectionsData | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/db/person-connections?slug=${encodeURIComponent(p.slug)}`)
      .then((r) => r.json())
      .then((j: PersonConnectionsData | null) => live && setConn(j))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [p.slug]);

  // The MP id (for the avatar photo + party ring) from an mp role, else a mp-{id} candidacy.
  const mpId = useMemo(() => {
    const mp = p.roles.find((r) => r.source === "mp");
    if (mp && /^\d+$/.test(mp.ref)) return Number(mp.ref);
    for (const r of p.roles) {
      const m = /:mp-(\d+)$/.exec(r.ref);
      if (m) return Number(m[1]);
    }
    return null;
  }, [p.roles]);

  // Held offices — mp / officials / magistrate / local mayor+councillor. A person can hold
  // the same office across many cycles (e.g. councillor ×5), so dedupe by (source, role,
  // place) to one row.
  const offices = useMemo(() => {
    const held = p.roles.filter(
      (r) =>
        r.source === "mp" ||
        r.source.startsWith("official") ||
        r.source === "magistrate" ||
        r.source === "local",
    );
    // A single seat is often recorded by more than one source — e.g. a municipal councillor
    // shows up in BOTH the local-election results (`local`, carries the place "Ловеч") and the
    // Court-of-Audit officials roster (`official_muni`, place-less). The place-less roster row
    // just restates a role we already show WITH a place, so drop it; the electoral row keeps
    // the richer label + place.
    const placedRoles = new Set(held.filter((r) => r.place).map((r) => r.role));
    const seen = new Set<string>();
    return held.filter((r) => {
      if (
        !r.place &&
        r.source.startsWith("official") &&
        placedRoles.has(r.role)
      )
        return false;
      const k = `${r.source}\t${r.role}\t${r.place ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [p.roles]);
  const candidacies = p.roles.filter((r) => r.source === "candidate");
  const donations = p.roles.filter((r) => r.source === "donor");

  // Candidacy cycles → { election, candidate slug } for the electoral block's cycle selector
  // + its /candidate/:slug/* deep-links. ref is "{election}:{slug}".
  const candidacyCycles = candidacies.map((r) => {
    const i = r.ref.indexOf(":");
    return { election: r.ref.slice(0, i), slug: r.ref.slice(i + 1) };
  });

  // An official's declaration slug = person_role.ref (Court-of-Audit roster slug). Used for
  // the non-MP declared-wealth block (MPs get their assets via PersonMpSections instead).
  const officialSlug = p.roles.find(
    (r) => r.source === "official_exec" || r.source === "official_muni",
  )?.ref;

  // Does the MP register carry declared assets for this person? Same query
  // PersonMpSections/MpAssetsSummary run, deduped by React Query, so it costs
  // nothing extra and both sides agree on which declarations block to show.
  const { rollup: mpAssetRollup } = useMpAssets(p.name);

  // Local office role → localized heading; unknown role codes pass through.
  const roleLabel = (role: string): string => {
    const k = `pp_role_${role}`;
    const s = t(k);
    return s === k ? role : s;
  };

  // Office heading. Local: the role (Кмет / Общински съветник). Magistrate: the SPECIFIC role
  // (Съдия / Прокурор / Следовател / ВСС) inferred from the institution when we can tell — the
  // explicit position field is nearly empty, but the court/office TYPE implies it (99.8% of the
  // ~2.7k with an institution); an unclassifiable one keeps the generic "Магистрати". Everything
  // else uses its source label.
  const officeHeading = (r: {
    source: string;
    role: string;
    place?: string | null;
    sourceLabel: string;
  }): string => {
    if (r.source === "magistrate") {
      const k = magistrateRoleKey(r.place);
      return k ? t(k) : r.sourceLabel;
    }
    // local + officials: the SPECIFIC role (Кмет / Член на кабинета / Зам.-кмет…) is the most
    // informative heading; fall back to the source label (an MP, or an unlabelled role).
    if (r.role && r.role !== "official") {
      const label = roleLabel(r.role);
      if (label !== r.role) return label;
    }
    return r.sourceLabel;
  };

  // Regulator seat code → localized label; unknown codes pass through.
  const seatLabel = (seat: string): string => {
    const k = `pp_reg_seat_${seat}`;
    const s = t(k);
    return s === k ? seat : s;
  };

  // Money-footprint + presence KPIs — only tiles with a value render, so a pure businessman
  // shows money tiles and a councillor shows counts. The dashboard headline (idiom: StatCard).
  const kpis: { key: string; label: string; value: string }[] = [];
  if (p.procuredEur > 0)
    kpis.push({
      key: "procured",
      label: t("pp_procured_total"),
      value: formatEurCompact(p.procuredEur),
    });
  if (p.fundsEur > 0)
    kpis.push({
      key: "funds",
      label: t("pp_funds_total"),
      value: formatEurCompact(p.fundsEur),
    });
  if (p.subsidiesEur > 0)
    kpis.push({
      key: "subsidies",
      label: t("pp_subsidies_total"),
      value: formatEurCompact(p.subsidiesEur),
    });
  if (p.companies.length > 0)
    kpis.push({
      key: "companies",
      label: t("pp_companies"),
      value: String(p.companies.length),
    });

  return (
    <div className="w-full px-3 py-3 space-y-4">
      {/* Header — identity, party badge, compact MP bio */}
      <PersonHeader p={p} mpId={mpId} />

      {/* Money-footprint + presence KPI row */}
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map((k) => (
            <StatCard key={k.key} label={k.label}>
              <div className="text-2xl font-bold text-foreground">
                {k.value}
              </div>
            </StatCard>
          ))}
        </div>
      )}

      {/* Sanctions — a prominent, CITED badge (official government finding, not our claim) */}
      {p.sanctions.length > 0 && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-red-600 dark:text-red-400">
              <ShieldAlert className="h-4 w-4" /> {t("pp_sanctions")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {p.sanctions.map((sx, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium">{sx.program}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {sx.authority} · {sx.date}
                </span>
                <a
                  href={sx.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  {t("pp_sanctions_source")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ДС / COMDOS — a prominent, CITED badge (official Комисия по досиетата finding,
          not our claim), keyed on the решение № + date. Amber accent, distinct from the
          red sanctions tile. */}
      {(p.ds ?? []).length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400">
              <FileWarning className="h-4 w-4" /> {t("pp_ds")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(p.ds ?? []).map((d, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium">
                  {d.category
                    ? `${d.category}${d.pseudonyms.length ? ` „${d.pseudonyms.join("“, „")}“` : ""}`
                    : d.body}
                </span>
                <span className="text-muted-foreground">
                  {d.category ? ` · ${d.body}` : ""} · {t("pp_ds_decision")} №{" "}
                  {d.decisionNo} / {d.decisionDate}
                </span>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  {t("pp_ds_source")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Regulators / independent bodies — the `regulator` "кой решава" facet. A NEUTRAL
          civic-office tile (not an accusation), each seat cited to the body's official page. */}
      {p.regulators.length > 0 && (
        <DashboardSection
          id="person-regulators"
          title={t("pp_regulators")}
          icon={Scale}
        >
          <Card>
            <CardContent className="space-y-2 pt-6">
              {p.regulators.map((rg, i) => (
                <div
                  key={`${rg.body}:${rg.seat}:${i}`}
                  className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0"
                >
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{rg.body}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {seatLabel(rg.seat)}
                    </span>
                    {rg.termStart && (
                      <span className="block text-xs text-muted-foreground">
                        {t("pp_reg_since")} {rg.termStart}
                      </span>
                    )}
                  </span>
                  <a
                    href={rg.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-0.5 text-xs text-primary hover:underline"
                  >
                    {t("pp_reg_source")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </CardContent>
          </Card>
        </DashboardSection>
      )}

      {/* Electoral performance (politician) — PG-fed stat cards, regions, trajectory, with a
          cycle selector; leads the record for a candidate/MP. */}
      <PersonElectoralSection
        slug={p.slug}
        name={p.name}
        candidacies={candidacyCycles}
      />

      {/* MP-only: voting scorecard + roll-call + declared assets (no PG equivalent). */}
      {mpId != null && (
        <PersonMpSections
          name={p.name}
          mpId={mpId}
          hasMoneyTimeline={p.procuredEur > 0}
        />
      )}

      {/* Official's declared assets (Court of Audit). Normally an MP's declarations come from
          PersonMpSections above, so this is the non-MP counterpart — but the two registers are
          separate, and someone can hold an mp id while having filed ONLY in the officials
          register: a minister who stood for parliament without ever taking a seat files as a
          cabinet member, not as an MP. Gating purely on `mpId == null` hid their declarations
          entirely. Fall back whenever the MP side has nothing, so exactly one block renders. */}
      {officialSlug && !mpAssetRollup && (
        <PersonOfficialAssets slug={officialSlug} />
      )}

      {/* Magistrate: the ИВСС declaration (court/position, declared wealth + companies) — the
          judiciary counterpart to the officials' assets block. Name-matched, so it self-hides
          when nothing matches. */}
      {p.roles.some((r) => r.source === "magistrate") && (
        <PersonMagistrateHoldingsTile name={p.name} />
      )}

      {/* Offices held */}
      {offices.length > 0 && (
        <DashboardSection
          id="person-offices"
          title={t("pp_offices")}
          icon={Landmark}
        >
          <Card>
            <CardContent className="space-y-2 pt-6">
              {offices.map((r) => (
                <div
                  key={`${r.source}:${r.ref}:${r.role}`}
                  className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0"
                >
                  {/* The specific role IS the heading now (Кмет / Член на кабинета / Съдия…),
                      so no separate role code is appended. */}
                  <span className="text-sm font-medium">
                    {officeHeading(r)}
                  </span>
                  {r.place && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {r.place}
                    </span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </DashboardSection>
      )}

      {/* Companies (TR registry footprint) with the MP's declared ownership stakes folded in. */}
      <PersonCompanies companies={p.companies} name={p.name} mpId={mpId} />

      {/* Money vs power — the person's company procurement bucketed by cabinet (lazy). */}
      {p.procuredEur > 0 && <PersonMoneyTimeline slug={p.slug} />}

      {/* NGO board seats (ЮЛНЦ) — the civic-board facet, distinct from business companies */}
      {p.ngos.length > 0 && (
        <DashboardSection
          id="person-ngos"
          title={t("pp_ngos")}
          icon={HeartHandshake}
        >
          <Card>
            <CardContent className="space-y-2 pt-6">
              {p.ngos.map((n) => (
                <div
                  key={n.eik}
                  className="border-b border-border/50 pb-2 last:border-0 last:pb-0"
                >
                  <span className="text-sm">
                    <Link
                      to={`/company/${n.eik}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {n.name ? decodeEntities(n.name) : n.eik}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {n.roles.map((r) => trRoleLabel(r, t)).join(", ")}
                    </span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </DashboardSection>
      )}

      {/* Connected people (§8) — the unified connections view (direct + indirect paths). */}
      {conn && <PersonConnections data={conn} />}

      {/* Donations */}
      {donations.length > 0 && (
        <DashboardSection
          id="person-donations"
          title={t("pp_donations")}
          icon={Coins}
        >
          <Card>
            <CardContent className="space-y-1 pt-6">
              {[...new Set(donations.map((r) => r.ref.split(":")[0]))]
                .sort((a, b) => b.localeCompare(a))
                .map((election) => (
                  <div key={election} className="text-sm">
                    {t("pp_donated")} · {fmtElection(election)}
                  </div>
                ))}
            </CardContent>
          </Card>
        </DashboardSection>
      )}
    </div>
  );
};

export const PersonProfileScreen: FC = () => {
  const { name } = useParams<{ name: string }>();
  const profile = usePersonProfile(name ?? "");

  if (profile === undefined) return null;
  // Legacy name-keyed links (magistrate holdings, connection checks, associates) fall
  // through to the portfolio dashboard so nothing breaks.
  if (profile === null) return <PersonScreen />;
  return <PersonDashboard p={profile} />;
};
