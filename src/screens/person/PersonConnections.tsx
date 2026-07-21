// The unified §8 connections surface (person-candidate-merge follow-up): the ONE connections
// view, on the person layer. Replaces the legacy name-keyed /candidate/:id/connections graph —
// this one is EIK-exact (person_id, no "съвпадение по име" ambiguity) and covers every public
// person, not just MP↔MP. It shows the PATH, like the old graph did:
//   • DIRECT  — A ─(shared company)─ B
//   • INDIRECT — A → C1 → partner → C2 → B (rare: the small-company noise guard is strict).
// The stricter guard means fewer, higher-confidence ties than the old graph — the deliberate
// precision-over-recall trade for a defamation-sensitive claim.

import { FC, Fragment } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users, Building2, ArrowRight } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { PartyBadge } from "@/screens/components/PartyBadge";
import { decodeEntities } from "@/lib/decodeEntities";
import { initials } from "@/lib/utils";

type ConnCompany = { eik: string; name: string | null };
type Direct = {
  slug: string;
  name: string;
  party: string | null;
  partyColor: string | null;
  sharedCount: number;
  companies: ConnCompany[];
};
type Indirect = {
  slug: string;
  name: string;
  party: string | null;
  partyColor: string | null;
  partnerSlug: string;
  partnerName: string;
  c1: ConnCompany;
  c2: ConnCompany;
};
export type PersonConnectionsData = {
  subject: { slug: string; name: string };
  related: Direct[];
  indirect?: Indirect[];
  disclaimer: string;
};

// A person node in a path: avatar + name, linking to their profile.
const PersonNode: FC<{
  slug?: string;
  name: string;
  party?: string | null;
  partyColor?: string | null;
  bold?: boolean;
}> = ({ slug, name, party, partyColor, bold }) => {
  const inner = (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <Avatar className="h-5 w-5">
        <AvatarFallback className="text-[8px] font-semibold text-muted-foreground">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <span className={bold ? "font-semibold" : "font-medium"}>{name}</span>
      {party && (
        <PartyBadge
          label={party}
          color={partyColor}
          className="px-1 text-[9px] font-medium"
        />
      )}
    </span>
  );
  return slug ? (
    <Link to={`/person/${slug}`} className="hover:underline">
      {inner}
    </Link>
  ) : (
    inner
  );
};

// A company node in a path: building icon + name, linking to /company/:eik.
const CompanyNode: FC<{ c: ConnCompany }> = ({ c }) => (
  <Link
    to={`/company/${c.eik}`}
    className="inline-flex items-center gap-1 align-middle text-muted-foreground hover:text-primary hover:underline"
  >
    <Building2 className="h-3.5 w-3.5 shrink-0" />
    <span>{c.name ? decodeEntities(c.name) : c.eik}</span>
  </Link>
);

const Sep = () => (
  <ArrowRight
    className="mx-1 inline h-3.5 w-3.5 shrink-0 align-middle text-muted-foreground/50"
    aria-hidden
  />
);

export const PersonConnections: FC<{ data: PersonConnectionsData }> = ({
  data,
}) => {
  const { t } = useTranslation();
  const direct = data.related ?? [];
  const indirect = data.indirect ?? [];
  if (direct.length === 0 && indirect.length === 0) return null;
  const subj = data.subject;

  return (
    <DashboardSection
      id="person-connections"
      title={t("pp_connections")}
      icon={Users}
    >
      <Card>
        <CardContent className="space-y-4 pt-6 text-sm">
          {direct.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("pp_conn_direct")}
                <span className="ml-1 font-normal normal-case">
                  ({direct.length})
                </span>
              </div>
              <ul className="space-y-2">
                {direct.map((r) => (
                  <li
                    key={r.slug}
                    className="flex flex-wrap items-center gap-y-1 border-b border-border/50 pb-2 last:border-0 last:pb-0"
                  >
                    <PersonNode slug={subj.slug} name={subj.name} bold />
                    <Sep />
                    <CompanyNode c={r.companies[0]} />
                    {r.sharedCount > 1 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        +{r.sharedCount - 1}
                      </span>
                    )}
                    <Sep />
                    <PersonNode
                      slug={r.slug}
                      name={r.name}
                      party={r.party}
                      partyColor={r.partyColor}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {indirect.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("pp_conn_indirect")}
                <span className="ml-1 font-normal normal-case">
                  ({indirect.length})
                </span>
              </div>
              <ul className="space-y-2">
                {indirect.map((r) => (
                  <li
                    key={`${r.slug}-${r.partnerSlug}`}
                    className="flex flex-wrap items-center gap-y-1 border-b border-border/50 pb-2 last:border-0 last:pb-0"
                  >
                    <PersonNode slug={subj.slug} name={subj.name} bold />
                    <Sep />
                    <CompanyNode c={r.c1} />
                    <Sep />
                    <PersonNode slug={r.partnerSlug} name={r.partnerName} />
                    <Sep />
                    <CompanyNode c={r.c2} />
                    <Sep />
                    <PersonNode
                      slug={r.slug}
                      name={r.name}
                      party={r.party}
                      partyColor={r.partyColor}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Fragment>
            <p className="border-t pt-3 text-xs text-muted-foreground">
              {data.disclaimer}
            </p>
          </Fragment>
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
