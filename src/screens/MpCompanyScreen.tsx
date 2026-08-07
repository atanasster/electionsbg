import { FC, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  ExternalLink,
  MapPin,
  ArrowRightLeft,
  Building2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useCompanyIndex,
  type CompanyIndexStake,
  type CompanyMpRole,
  type CompanyStakeEntry,
} from "@/data/parliament/useCompanyIndex";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { ConfidenceBadge } from "@/screens/components/connections/ConfidenceBadge";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import type { TrCompanyOfficer } from "@/data/dataTypes";
import { formatEur } from "@/lib/currency";

/** What a `table: "11"` row means depends on which form it came from, and the
 * two readings are not close: on the ASSET form the share was transferred to
 * somebody, on the ИНТЕРЕСИ forms the role was held in the twelve months
 * before taking office and not since. Labelling a directorship "transferred"
 * describes a share sale that never happened. */
const isShareKind = (stake: CompanyIndexStake): boolean =>
  (stake.stakeKind ?? "share") === "share";

const StakeIcon: FC<{ held: boolean; share: boolean }> = ({ held, share }) =>
  !held && share ? (
    <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
  ) : share ? (
    <Briefcase className="h-4 w-4 text-muted-foreground" />
  ) : (
    <Users className="h-4 w-4 text-muted-foreground" />
  );

const STATUS_CLASSES: Record<string, string> = {
  active:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  in_liquidation:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  bankrupt: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
  ceased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  erased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

const StatusBadge: FC<{ status: string }> = ({ status }) => {
  const { t } = useTranslation();
  const cls = STATUS_CLASSES[status] ?? STATUS_CLASSES.active;
  const label = t(`tr_status_${status}`) || status;
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
};

const trRoleLabel = (role: string, t: (k: string) => string): string => {
  const key = `tr_role_${role}`;
  const translated = t(key);
  return translated && translated !== key ? translated : role;
};

const OfficerRow: FC<{ officer: TrCompanyOfficer }> = ({ officer }) => {
  const { t } = useTranslation();
  const isMp = officer.matchedMpId != null;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 items-center py-2 border-b last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-1.5">
          {isMp && <MpAvatar mpId={officer.matchedMpId} name={officer.name} />}
          {isMp && officer.matchedMpId != null ? (
            <Link
              to={candidateUrlForMp(officer.matchedMpId)}
              className="hover:underline"
            >
              {officer.name}
            </Link>
          ) : (
            officer.name
          )}
          {isMp && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary">
              <ShieldCheck className="h-2.5 w-2.5" />
              {t("tr_is_mp") || "MP"}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {trRoleLabel(officer.role, t)}
          {officer.positionLabel ? ` · ${officer.positionLabel}` : ""}
        </div>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        {officer.sharePercent != null && (
          <div className="font-mono">{officer.sharePercent}%</div>
        )}
        {officer.addedAt && <div>{officer.addedAt.slice(0, 10)}</div>}
      </div>
    </div>
  );
};

/** One MP's one relationship with this company, however many filings declared
 * it. A standing relationship is re-declared on EVERY entry into office, and
 * the same filing can list it in both the held-now and the held-before table,
 * so the raw stake list carries the same fact two to four times over with
 * nothing on screen to tell the copies apart — Ивайло Мирчев's seat on the ДА
 * България board appeared twice under one identical "Декларация 2021" caption,
 * once for the 45th National Assembly and once for the 46th. Grouping keeps
 * every filing reachable through `filings` rather than dropping any. */
type StakeGroup = {
  mpId: number;
  declarantName: string;
  share: boolean;
  /** True when at least one filing declares it as still held (table 10). A
   * group that is `false` was only ever declared in the past tense. */
  held: boolean;
  shareSize: string | null;
  valueEur: number | null;
  legalBasis: string | null;
  fundsOrigin: string | null;
  institution: string;
  /** Every filing that declared this relationship, newest first. The
   * institution rides along per filing because a re-declaration usually
   * happens on entering a DIFFERENT body — Мирчев's two 2021 filings are the
   * 45th and the 46th National Assembly, so two source links otherwise label
   * themselves "2021" with nothing to tell them apart. */
  filings: { year: number; institution: string; sourceUrl: string }[];
};

/** One source link per (year, body), newest first. Entering and leaving a
 * mandate each triggers a filing, so one unchanged holding produces up to
 * four documents a year — Димитър Аврамов's 50% carries fifteen, eight of
 * them labelled "2021", which is a wall of identical links that helps nobody
 * verify anything. Collapsing on the BODY as well as the year is what keeps
 * the distinction that matters: Мирчев's two 2021 filings are the 45th and
 * the 46th National Assembly and both stay. */
const onePerYearAndBody = (
  filings: StakeGroup["filings"],
): StakeGroup["filings"] => {
  const seen = new Set<string>();
  return filings.filter((f) => {
    const key = `${f.year}|${f.institution}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Distinct relationships, not distinct filings. Two DIFFERENT holdings in the
 * same company by the same MP — a different declared size — stay separate rows.
 *
 * The key is deliberately the size alone, not size + value + legal basis:
 * those three drift between filings of the SAME holding (an unpriced интереси
 * filing next to a valued asset one, a legal basis typed in only some years),
 * and folding them into the key splits one holding into a row per variant.
 * Димитър Аврамов's single 50% of Гала-инвест-холдинг arrives as 28 stake rows
 * across five years; on the value+basis key that is still four rows of the
 * same 50%. Each varying field is instead taken from the most recent filing
 * that declared one, so a year where the declarant left the value blank does
 * not erase a figure they gave before. */
const groupStakes = (stakes: CompanyStakeEntry[]): StakeGroup[] => {
  const map = new Map<string, StakeGroup>();
  // Newest first, so "the first non-null wins" IS "the most recent wins".
  const ordered = [...stakes].sort(
    (a, b) => b.declarationYear - a.declarationYear,
  );
  for (const e of ordered) {
    const share = isShareKind(e.stake);
    const key = [
      e.mpId,
      share,
      (e.stake.shareSize ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
    ].join("|");
    const held = e.stake.table === "10";
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        mpId: e.mpId,
        declarantName: e.declarantName,
        share,
        held,
        shareSize: e.stake.shareSize,
        valueEur: e.stake.valueEur,
        legalBasis: e.stake.legalBasis,
        fundsOrigin: e.stake.fundsOrigin,
        institution: e.institution,
        filings: [
          {
            year: e.declarationYear,
            institution: e.institution,
            sourceUrl: e.sourceUrl,
          },
        ],
      });
      continue;
    }
    // Held-now anywhere wins: a relationship declared as current in any
    // filing is current, whatever an earlier past-tense row said.
    if (held) existing.held = true;
    existing.valueEur ??= e.stake.valueEur;
    existing.legalBasis ??= e.stake.legalBasis;
    existing.fundsOrigin ??= e.stake.fundsOrigin;
    if (!existing.filings.some((f) => f.sourceUrl === e.sourceUrl)) {
      existing.filings.push({
        year: e.declarationYear,
        institution: e.institution,
        sourceUrl: e.sourceUrl,
      });
    }
  }
  for (const g of map.values()) {
    g.filings.sort((a, b) => b.year - a.year);
    g.filings = onePerYearAndBody(g.filings);
  }
  // Still-held first, then most recent filing, then name.
  return Array.from(map.values()).sort((a, b) => {
    if (a.held !== b.held) return a.held ? -1 : 1;
    const ay = a.filings[0]?.year ?? 0;
    const by = b.filings[0]?.year ?? 0;
    if (ay !== by) return by - ay;
    return a.declarantName.localeCompare(b.declarantName, "bg", {
      sensitivity: "base",
    });
  });
};

/** The distinct years a group was declared in, newest first — "2023, 2021"
 * rather than one row per filing. */
const groupYears = (g: StakeGroup): number[] =>
  Array.from(new Set(g.filings.map((f) => f.year)));

/** One MP, all the TR roles they hold at this company. `mpRoles` carries one
 * row per (mpId, role) — a manager who is also the sole owner arrives as two —
 * so the page groups them the way the candidate page groups by company. */
type MpRoleGroup = {
  mpId: number;
  mpName: string;
  roles: string[];
  /** Any role still open. Only `false` when every one of them was erased. */
  isCurrent: boolean;
  confidence: "high" | "medium";
};

const groupRolesByMp = (roles: CompanyMpRole[]): MpRoleGroup[] => {
  const map = new Map<number, MpRoleGroup>();
  for (const r of roles) {
    const existing = map.get(r.mpId);
    if (!existing) {
      map.set(r.mpId, {
        mpId: r.mpId,
        mpName: r.mpName,
        roles: [r.role],
        isCurrent: r.isCurrent,
        confidence: r.confidence,
      });
      continue;
    }
    if (!existing.roles.includes(r.role)) existing.roles.push(r.role);
    if (r.isCurrent) existing.isCurrent = true;
    if (r.confidence === "high") existing.confidence = "high";
  }
  // Current roles first, then by name — a former manager shouldn't outrank a
  // sitting one just because their file was read first.
  return Array.from(map.values()).sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return a.mpName.localeCompare(b.mpName, "bg", { sensitivity: "base" });
  });
};

const MpRoleRow: FC<{ group: MpRoleGroup }> = ({ group }) => {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 items-center py-2 border-b last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-1.5">
          <MpAvatar mpId={group.mpId} name={group.mpName} />
          <Link
            to={candidateUrlForMp(group.mpId)}
            className="hover:underline truncate"
          >
            {group.mpName}
          </Link>
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary shrink-0">
            <ShieldCheck className="h-2.5 w-2.5" />
            {t("tr_is_mp") || "MP"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {group.roles.map((r) => trRoleLabel(r, t)).join(", ")}
          {!group.isCurrent && (
            <> {` · ${t("company_conn_former") || "former"}`}</>
          )}
        </div>
      </div>
      <div className="shrink-0">
        <ConfidenceBadge confidence={group.confidence} />
      </div>
    </div>
  );
};

const StakeGroupRow: FC<{ group: StakeGroup }> = ({ group }) => {
  const { t, i18n } = useTranslation();
  const years = groupYears(group);
  return (
    <div className="grid grid-cols-[auto_auto_1fr_auto] gap-3 items-center py-3 border-b last:border-b-0">
      <StakeIcon held={group.held} share={group.share} />
      <MpAvatar name={group.declarantName} mpId={group.mpId} />
      <div className="min-w-0">
        <Link
          to={
            group.mpId != null
              ? candidateUrlForMp(group.mpId)
              : `/candidate/${encodeURIComponent(group.declarantName)}`
          }
          className="text-sm font-medium hover:underline truncate block"
        >
          {group.declarantName}
        </Link>
        <div className="text-xs text-muted-foreground">
          {group.institution}
          {" · "}
          {t("declaration_year") || "Declaration"} {years.join(", ")}
          {!group.held && (
            <>
              {" · "}
              {group.share
                ? t("stake_transferred") || "transferred"
                : t("stake_role_before_office") || "before taking office"}
            </>
          )}
        </div>
        {group.legalBasis && (
          <div className="text-xs text-muted-foreground">
            {group.legalBasis}
            {group.fundsOrigin ? ` · ${group.fundsOrigin}` : ""}
          </div>
        )}
      </div>
      <div className="text-right text-sm">
        {/* Monospace suits a quantity ("50%", "40лв.") and fights a job
         * title, which is prose — mono letter-spaces the shouted role
         * labels so hard that two rows of the same list stop looking like
         * the same column. */}
        {group.shareSize && (
          <div className={group.share ? "font-mono text-xs" : "text-xs"}>
            {group.shareSize}
          </div>
        )}
        {group.valueEur != null && (
          <div className="text-xs text-muted-foreground">
            {formatEur(group.valueEur, i18n.language)}
          </div>
        )}
        {/* One link per filing — grouping must not cost a source. A single
         * filing keeps the plain "source" label it always had. */}
        <div className="flex flex-wrap justify-end gap-x-2">
          {group.filings.map((f) => (
            <a
              key={f.sourceUrl}
              href={f.sourceUrl}
              target="_blank"
              rel="noreferrer"
              title={`${f.institution} · ${f.year}`}
              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              {group.filings.length > 1 ? f.year : t("source") || "source"}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

export const MpCompanyScreen: FC = () => {
  const { t } = useTranslation();
  const { slug: rawSlug } = useParams();
  const slug = rawSlug ? decodeURIComponent(rawSlug) : "";
  const { bySlug, isLoading } = useCompanyIndex();

  const company = useMemo(
    () => (slug ? bySlug.get(slug) : undefined),
    [bySlug, slug],
  );
  const mpRoleGroups = useMemo(
    () => groupRolesByMp(company?.mpRoles ?? []),
    [company],
  );
  const stakeGroups = useMemo(
    () => groupStakes(company?.stakes ?? []),
    [company],
  );
  // Split by what the row IS. A directorship is not a shareholding, and the
  // two carry different footnotes — the money one and the ЗПК one.
  const declaredShares = useMemo(
    () => stakeGroups.filter((g) => g.share),
    [stakeGroups],
  );
  const declaredRoles = useMemo(
    () => stakeGroups.filter((g) => !g.share),
    [stakeGroups],
  );

  if (isLoading) {
    return (
      <div className="w-full px-4 md:px-8 py-6 text-sm text-muted-foreground">
        {t("loading") || "Loading…"}
      </div>
    );
  }

  if (!company) {
    return (
      <div className="w-full px-4 md:px-8 py-6">
        <Title description="Company not found">
          {t("company_not_found") || "Company not found"}
        </Title>
        <p className="text-sm text-muted-foreground">{slug}</p>
      </div>
    );
  }

  const tr = company.tr;

  return (
    <div className="w-full px-4 md:px-8">
      <Title description={`MP-declared company: ${company.displayName}`}>
        {company.displayName}
      </Title>

      {tr && (
        <Card className="my-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <Building2 className="h-4 w-4" />
              <span>{t("tr_commerce_registry") || "Commerce Registry"}</span>
              <StatusBadge status={tr.status} />
              <a
                href={`https://portal.registryagency.bg/CR/en/Reports/VerifiedPersonShortInfo?uic=${tr.uic}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
              >
                {t("tr_eik") || "UIC"} {tr.uic}
                <ExternalLink className="h-3 w-3" />
              </a>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tr.seat && (
              <div className="flex items-start gap-1.5 text-sm text-muted-foreground mb-4">
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{tr.seat}</span>
              </div>
            )}

            {tr.currentOfficers.length > 0 && (
              <div className="mb-4">
                <div className="text-sm font-semibold mb-1 flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {t("tr_current_officers") || "Current officers"}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({tr.currentOfficers.length})
                  </span>
                </div>
                {tr.currentOfficers.map((o, i) => (
                  <OfficerRow key={`o-${i}`} officer={o} />
                ))}
              </div>
            )}

            {tr.currentOwners.length > 0 && (
              <div>
                <div className="text-sm font-semibold mb-1 flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5" />
                  {t("tr_current_owners") || "Current owners"}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({tr.currentOwners.length})
                  </span>
                </div>
                {tr.currentOwners.map((o, i) => (
                  <OfficerRow key={`p-${i}`} officer={o} />
                ))}
              </div>
            )}

            {/* MP↔company roles matched out of the Commerce Registry. Most
             * entries on this page have ONLY these: the per-officer TR rows
             * above are absent for ~71% of companies (see the officer-coverage
             * ceiling), so without this block the page reads "nobody here"
             * while the tile that linked to it names an MP and their role. */}
            {mpRoleGroups.length > 0 && (
              <div
                className={
                  tr.currentOfficers.length > 0 || tr.currentOwners.length > 0
                    ? "mt-4"
                    : undefined
                }
              >
                <div className="text-sm font-semibold mb-1 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t("company_mps_via_tr") || "MPs in the Commerce Registry"}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({mpRoleGroups.length})
                  </span>
                </div>
                {mpRoleGroups.map((g) => (
                  <MpRoleRow key={g.mpId} group={g} />
                ))}
                <div className="text-xs text-muted-foreground mt-2">
                  {t("company_mps_via_tr_note") ||
                    "Matched by name against Commerce Registry officer and owner records — a shared name is not proof of the same person. Both currently held and historical roles are listed."}
                </div>
              </div>
            )}

            {tr.currentOfficers.length === 0 &&
              tr.currentOwners.length === 0 &&
              mpRoleGroups.length === 0 && (
                <div className="text-sm text-muted-foreground italic">
                  {t("tr_no_current_records") ||
                    "No currently-active officers or owners on file."}
                </div>
              )}

            {tr.lastUpdated && (
              <div className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                {t("tr_last_updated") || "Last updated"}{" "}
                {tr.lastUpdated.slice(0, 10)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Declared SHAREHOLDINGS. Suppressed when there are none AND the TR
       * card is carrying the seat — an empty "(0)" card whose only content is
       * a footnote about a list that isn't there reads as missing data. Roles
       * get their own card below: they used to render here, so a party or an
       * NGO board seat was published under a heading that said "дялове". */}
      {(declaredShares.length > 0 || (!tr && declaredRoles.length === 0)) && (
        <Card className="my-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              {t("company_stakes_held_by_mps") || "Stakes declared by MPs"} (
              {declaredShares.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {company.registeredOffices.length > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
                <MapPin className="h-3.5 w-3.5" />
                <span>{company.registeredOffices.join(" · ")}</span>
              </div>
            )}

            <div>
              {declaredShares.map((g) => (
                <StakeGroupRow
                  key={`${g.mpId}-${g.shareSize}-${g.valueEur}-${g.filings[0]?.sourceUrl}`}
                  group={g}
                />
              ))}
            </div>

            <div className="text-xs text-muted-foreground mt-4 pt-3 border-t">
              {t("source_declarations") ||
                "Source: property and interest declarations filed with the Bulgarian Court of Audit (Сметна палата). This list covers declared ownership stakes."}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Declared MANAGEMENT ROLES — the интереси forms. Filed by executive
       * and municipal officials as well as MPs, which is why they exist at
       * all: ЗПК чл. 35 bars a sitting MP from holding one. */}
      {declaredRoles.length > 0 && (
        <Card className="my-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              {t("company_roles_declared") || "Management roles declared"} (
              {declaredRoles.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {declaredShares.length === 0 &&
              company.registeredOffices.length > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>{company.registeredOffices.join(" · ")}</span>
                </div>
              )}

            <div>
              {declaredRoles.map((g) => (
                <StakeGroupRow
                  key={`${g.mpId}-${g.shareSize}-${g.valueEur}-${g.filings[0]?.sourceUrl}`}
                  group={g}
                />
              ))}
            </div>

            <div className="text-xs text-muted-foreground mt-4 pt-3 border-t">
              {t("company_roles_declared_note") ||
                "Source: interest declarations filed with the Bulgarian Court of Audit (Сметна палата). A management role is not an ownership stake — none of these rows says the declarant holds any share of this organisation."}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
