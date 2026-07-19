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
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  Building2,
  Coins,
  Landmark,
  Users,
  Vote,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { trRoleLabel } from "@/lib/trRole";
import { decodeEntities } from "@/lib/decodeEntities";
import { PersonScreen } from "@/screens/dev/PersonScreen";

type ProfileRole = {
  source: string;
  facet: string;
  sourceLabel: string;
  role: string;
  ref: string;
  place: string | null;
  confidence: string;
};
type ProfileCompany = {
  eik: string;
  name: string | null;
  legalForm: string | null;
  seat: string | null;
  status: string | null;
  roles: string[];
};
export type PersonProfile = {
  slug: string;
  name: string;
  namesakeRisk: number;
  isPublicFigure: boolean;
  facets: string[];
  roles: ProfileRole[];
  companies: ProfileCompany[];
  aliases: string[];
};

type Connections = {
  related: {
    slug: string;
    name: string;
    sharedCount: number;
    companies: { eik: string; name: string | null }[];
  }[];
  disclaimer: string;
};

// "2021_11_14" -> "14.11.2021"; anything else passes through.
const fmtElection = (d: string): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
};

const FACET_ICON: Record<string, typeof Landmark> = {
  politician: Landmark,
  executive: Briefcase,
  magistrate: Landmark,
  company: Building2,
  donor: Coins,
};

const Chip: FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
    {children}
  </span>
);

const Profile: FC<{ p: PersonProfile }> = ({ p }) => {
  const { t } = useTranslation();

  // Person↔person edges (shared company, association-noise-guarded, public-safe) — the
  // §8 Connections surface. Loaded lazily; absent for most people.
  const [conn, setConn] = useState<Connections | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/db/person-connections?slug=${encodeURIComponent(p.slug)}`)
      .then((r) => r.json())
      .then((j: Connections | null) => live && setConn(j))
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

  const offices = p.roles.filter(
    (r) =>
      r.source === "mp" ||
      r.source.startsWith("official") ||
      r.source === "magistrate",
  );
  const candidacies = p.roles.filter((r) => r.source === "candidate");
  const donations = p.roles.filter((r) => r.source === "donor");

  const facetLabel = (f: string): string => {
    const k = `pp_facet_${f}`;
    const s = t(k);
    return s === k ? f : s;
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <MpAvatar name={p.name} mpId={mpId} className="h-16 w-16 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{p.name}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.facets.map((f) => {
              const Icon = FACET_ICON[f];
              return (
                <Chip key={f}>
                  {Icon && <Icon className="h-3 w-3" />}
                  {facetLabel(f)}
                </Chip>
              );
            })}
          </div>
          {p.aliases.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("pp_also_known")}: {p.aliases.join(", ")}
            </p>
          )}
        </div>
      </div>

      {/* Offices held */}
      {offices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4" /> {t("pp_offices")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {offices.map((r) => (
              <div
                key={`${r.source}:${r.ref}:${r.role}`}
                className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0"
              >
                <span className="text-sm">
                  <span className="font-medium">{r.sourceLabel}</span>
                  {/* The role code only adds signal for officials (councillor / mayor /
                      chair); for mp & magistrate the source label already says it. */}
                  {r.source.startsWith("official") &&
                    r.role &&
                    r.role !== "official" && (
                      <span className="text-muted-foreground"> · {r.role}</span>
                    )}
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
      )}

      {/* Companies (TR footprint) */}
      {p.companies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" /> {t("pp_companies")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {p.companies.map((c) => (
              <div
                key={c.eik}
                className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0"
              >
                <span className="min-w-0 text-sm">
                  <Link
                    to={`/company/${c.eik}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {c.name ? decodeEntities(c.name) : c.eik}
                  </Link>
                  {c.legalForm && (
                    <span className="text-muted-foreground">
                      {" "}
                      {c.legalForm}
                    </span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {c.roles.map((r) => trRoleLabel(r, t)).join(", ")}
                  </span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Connected people (§8) — public co-officers via a shared company */}
      {conn && conn.related.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> {t("pp_connections")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {conn.related.map((r) => (
              <div
                key={r.slug}
                className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0"
              >
                <span className="min-w-0 text-sm">
                  <Link
                    to={`/person/${r.slug}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {r.companies
                      .map((c) => (c.name ? decodeEntities(c.name) : c.eik))
                      .join(", ")}
                  </span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Candidacies */}
      {candidacies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Vote className="h-4 w-4" /> {t("pp_candidacies")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {candidacies
              .map((r) => {
                const idx = r.ref.indexOf(":");
                return {
                  election: r.ref.slice(0, idx),
                  slug: r.ref.slice(idx + 1),
                };
              })
              .sort((a, b) => b.election.localeCompare(a.election))
              .map((c) => (
                <Link
                  key={`${c.election}:${c.slug}`}
                  to={`/candidate/${c.slug}`}
                  className="rounded-full border border-border px-2.5 py-0.5 text-xs text-primary hover:bg-muted"
                >
                  {fmtElection(c.election)}
                </Link>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Donations */}
      {donations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4" /> {t("pp_donations")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {donations
              .map((r) => r.ref.split(":")[0])
              .sort((a, b) => b.localeCompare(a))
              .map((election, i) => (
                <div key={`${election}:${i}`} className="text-sm">
                  {t("pp_donated")} · {fmtElection(election)}
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        {t("person_namesake_disclosure")}
      </p>
    </div>
  );
};

export const PersonProfileScreen: FC = () => {
  const { name } = useParams<{ name: string }>();
  const key = name ?? "";
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [state, setState] = useState<"loading" | "hit" | "miss">("loading");

  useEffect(() => {
    let live = true;
    setState("loading");
    fetch(`/api/db/person-profile?slug=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((j: PersonProfile | null) => {
        if (!live) return;
        if (j && j.slug) {
          setProfile(j);
          setState("hit");
        } else setState("miss");
      })
      .catch(() => live && setState("miss"));
    return () => {
      live = false;
    };
  }, [key]);

  if (state === "loading") return null;
  // Legacy name-keyed links (magistrate holdings, connection checks, associates) fall
  // through to the portfolio dashboard so nothing breaks.
  if (state === "miss" || !profile) return <PersonScreen />;
  return <Profile p={profile} />;
};
