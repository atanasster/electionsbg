// /subsidies/political — farm recipients where a public figure holds a registry role.
//
// docs/plans/subsidies-hub-v1.md §2.4 and §6. Reads `agri_political_link` (migration
// 163), built on the canonical `person_link_n` gate: person_role(tr|ngo) at
// exact_id/high/manual, held by an active public figure — the same predicate 133's
// loader and 151's place_mp_companies use, so a reader who reaches the same company
// from a governance place page is told the same thing.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// THIS IS A REGISTRY ROLE. NOT OWNERSHIP, NOT CONTROL, NOT WRONGDOING.
//
// 568 of 16,701 recipients — 3.4% — and €184.4m of €11.04bn. The claim the page makes
// is exactly „a person the public knows is recorded by a register in a role at this
// company", which is what the data says and nothing more. Every copy string here is
// written to that limit, because the alternative reading is a serious allegation about
// named people.
//
// The identity behind it is gated upstream rather than graded: `resolve_persons`
// REFUSES a name the Commerce Registry records for more than one person
// (`tr_name_fold_people`, 148), so a shared name produces no row at all rather than a
// „medium confidence" one.
// ═══════════════════════════════════════════════════════════════════════════════════
//
// THE TWO ARMS ARE SHOWN SEPARATELY, and that is the substance rather than a nicety.
// An ЕООД whose manager is an MP and a местна инициативна група whose board includes a
// mayor are different facts: 64 of the 568 are reached ONLY through the association
// arm, and the LEADER local action groups among them are the statutory delivery
// vehicle for rural-development money rather than a business interest.
//
// Note /person/:slug counts the narrower tr-only set (504) by design — there a civic
// board seat renders with no money columns — so the two pages differ by those 64.

import { type FC, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgriScopePicker, AgriScopeFallback } from "./AgriScopeGate";
import { useAgriScope, agriScopedHref } from "@/data/agri/useAgriScope";
import { useAgriHubStats } from "@/data/agri/useAgriHubStats";
import { agriScopeToKey } from "@/data/agri/constants";
import { agriLabel, formatScopeLabel, numberLocale } from "@/data/agri/labels";
import { formatEur, formatEurCompact } from "@/lib/currency";

interface PoliticalRow {
  eik: string;
  name: string;
  oblast: string | null;
  arm: "company" | "association" | "both";
  personCount: string | number;
  people: { slug: string; name: string }[] | null;
  totalEur: number;
}

const ALL_ARMS = "__all__";

export const SubsidiesPoliticalScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const nloc = numberLocale(bg);
  const [params] = useSearchParams();
  // The WHOLE gate, not just { scope, data } — `AgriScopeFallback` below needs
  // it to tell a failed fetch from an unpublished year. Hand-rolling the empty
  // card here (which this page did) says only „за избрания период": it never
  // names the year, never lists the years ДФЗ does publish, and offers no way
  // back to one that works — and it renders a FAILED load as an unpublished
  // year, the four-state defect one file over.
  const gate = useAgriScope();
  const { scope, data } = gate;
  const scopeKey = agriScopeToKey(scope);
  const { data: hub } = useAgriHubStats(scopeKey);
  const [arm, setArm] = useState<string>(ALL_ARMS);

  const filters = useMemo<DbColumnFilter[]>(
    () =>
      arm === ALL_ARMS
        ? []
        : [{ id: "arm", op: "in", value: [arm] } as DbColumnFilter],
    [arm],
  );

  const armLabel = (a: PoliticalRow["arm"]): string =>
    a === "company"
      ? bg
        ? "чрез фирма"
        : "via a company"
      : a === "association"
        ? bg
          ? "чрез сдружение"
          : "via an association"
        : bg
          ? "и двете"
          : "both";

  const columns = useMemo<DataTableColumnDef<PoliticalRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: agriLabel.recipient(bg),
        cell: ({ row }) => (
          <Link
            to={`/farm/${row.original.eik}`}
            className="font-medium hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "people",
        accessorFn: (r) => r.personCount,
        header: bg ? "Публична фигура" : "Public figure",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {(row.original.people ?? []).map((p) => (
              <Link
                key={p.slug}
                to={`/person/${p.slug}`}
                className="text-sm hover:underline"
              >
                {p.name}
              </Link>
            ))}
          </div>
        ),
      },
      {
        id: "arm",
        accessorFn: (r) => r.arm,
        header: bg ? "Връзка" : "Link",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {armLabel(row.original.arm)}
          </span>
        ),
      },
      {
        id: "oblast",
        accessorFn: (r) => r.oblast,
        header: agriLabel.oblast(bg),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.oblast || "—"}
          </span>
        ),
      },
      {
        id: "total_eur",
        accessorFn: (r) => r.totalEur,
        header: bg ? "Субсидии" : "Subsidy",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-medium tabular-nums">
            {formatEur(row.original.totalEur, L)}
          </span>
        ),
      },
    ],
    // `armLabel` is a pure formatter over bg, which is already listed; naming
    // it too would only restate that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bg, L],
  );

  const title = bg
    ? "Субсидии и публични фигури"
    : "Subsidies and public figures";
  const description = bg
    ? "Земеделски получатели, при които публична фигура заема вписана роля в търговския регистър или в регистъра на ЮЛНЦ. Вписана роля — не собственост и не нарушение."
    : "Farm recipients where a public figure holds a role recorded in the Commerce Registry or the non-profit register. A recorded role — not ownership, and not wrongdoing.";

  const scopeLabel = formatScopeLabel(data?.scopeYear, bg);

  const sharePct =
    hub && hub.entityEurExPayer > 0 && hub.politicalEur != null
      ? (Number(hub.politicalEur) / Number(hub.entityEurExPayer)) * 100
      : null;

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="agri_subsidies_nav"
        sectionTo="/subsidies"
        currentKey="subsidies_political_nav"
        className="mt-5"
      />
      <section aria-label={title} className="my-4">
        <p className="mb-2 max-w-3xl text-sm text-muted-foreground">
          {bg
            ? "Тук са земеделските получатели, при които публична фигура е вписана в роля в търговския регистър или в регистъра на ЮЛНЦ. „Публична фигура“ е по-широко от изборна длъжност: освен депутати, министри, кметове, общински съветници и магистрати, обхваща и кандидати на избори, и ръководители на публични институции — училища, детски градини, лечебни заведения, културни институти."
            : "These are the farm recipients where a public figure is recorded in a role in the Commerce Registry or the non-profit register. “Public figure” is broader than elected office: besides MPs, ministers, mayors, councillors and magistrates it covers election candidates and the heads of public institutions — schools, kindergartens, medical centres, cultural institutes."}
        </p>
        {/* The limit of the claim, before any number. */}
        <div className="mb-4 max-w-3xl rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:border-amber-800/50 dark:bg-amber-950/20">
          {bg
            ? "Вписана роля — не собственост, не контрол и не нарушение. Регистърът показва, че лицето е записано в тази роля; нищо повече. Земеделската субсидия се получава по правила за площ и мярка, а не по преценка, така че присъствието в този списък само по себе си не значи нередност."
            : "A recorded role — not ownership, not control, and not wrongdoing. The register shows that the person is entered in that role; nothing more. Farm subsidy is paid by area and measure under published rules rather than by discretion, so appearing in this list is not in itself an irregularity."}
        </div>

        <AgriScopePicker className="mb-3" />

        <AgriScopeFallback gate={gate}>
          <>
            <DashboardSection
              id="subsidies-political-headline"
              title={agriLabel.atAGlance(bg)}
              icon={Users}
              subtitle={scopeLabel}
            >
              <div
                data-og="subsidies-political"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                <StatCard label={bg ? "Получатели" : "Recipients"}>
                  <span className="text-2xl font-bold tabular-nums">
                    {hub?.politicalEiks != null
                      ? Number(hub.politicalEiks).toLocaleString(nloc)
                      : "—"}
                  </span>
                  <div className="text-xs text-muted-foreground">
                    {hub?.entityCountExPayer != null
                      ? bg
                        ? `от ${Number(hub.entityCountExPayer).toLocaleString(nloc)} фирми`
                        : `of ${Number(hub.entityCountExPayer).toLocaleString(nloc)} companies`
                      : ""}
                  </div>
                </StatCard>
                <StatCard label={bg ? "Публични фигури" : "Public figures"}>
                  <span className="text-2xl font-bold tabular-nums">
                    {hub?.politicalPeople != null
                      ? Number(hub.politicalPeople).toLocaleString(nloc)
                      : "—"}
                  </span>
                </StatCard>
                <StatCard
                  label={bg ? "Субсидии" : "Subsidy"}
                  hint={
                    bg
                      ? "Изплатено на тези получатели за периода."
                      : "Paid to these recipients in the period."
                  }
                >
                  <span className="text-xl font-bold tabular-nums">
                    {hub?.politicalEur != null
                      ? formatEurCompact(Number(hub.politicalEur), L)
                      : "—"}
                  </span>
                </StatCard>
                <StatCard
                  label={
                    bg ? "Дял от парите за фирми" : "Share of company money"
                  }
                  hint={
                    bg
                      ? "От сумата за юридически лица, не от общата: плащанията без ЕИК не могат да бъдат свързани с човек изобщо."
                      : "Of the legal-entity money, not of the total: payments with no ЕИК cannot be linked to a person at all."
                  }
                >
                  <span className="text-2xl font-bold tabular-nums">
                    {sharePct != null
                      ? `${sharePct.toLocaleString(nloc, { maximumFractionDigits: 2 })}%`
                      : "—"}
                  </span>
                </StatCard>
              </div>
              {/* The „not computed yet" state, rather than a zero. */}
              {hub && hub.politicalBasisBuilt === false && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {bg
                    ? "Слоят с лица още не е изграден на тази база данни, затова връзките не са изчислени."
                    : "The person layer has not been built on this database, so the links are not computed."}
                </p>
              )}
            </DashboardSection>

            <DashboardSection
              id="subsidies-political-table"
              title={bg ? "Получателите" : "The recipients"}
              icon={Users}
              subtitle={scopeLabel}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {bg ? "Вид връзка" : "Kind of link"}
                </span>
                <Select value={arm} onValueChange={setArm}>
                  <SelectTrigger className="h-8 w-[210px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_ARMS}>
                      {bg ? "Всички" : "All"}
                    </SelectItem>
                    <SelectItem value="company">
                      {bg ? "Чрез фирма" : "Via a company"}
                    </SelectItem>
                    <SelectItem value="association">
                      {bg ? "Чрез сдружение" : "Via an association"}
                    </SelectItem>
                    <SelectItem value="both">
                      {bg ? "И двете" : "Both"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Guarded on the KEY, like the five sibling sub-pages.
                  AgriScopeFallback only renders children when the gate is
                  `ready`, but that is a runtime guarantee the type system
                  cannot see — and this is not type ceremony: `agri_political`
                  is a scope-keyed fan-out, so a request with no `scope_key`
                  returns one row per scope and silently multiplies the money
                  rather than erroring. */}
              {scopeKey !== null && (
                <DbDataTable<PoliticalRow>
                  resource="agri_political"
                  columns={columns}
                  scope={{ col: "scope_key", val: scopeKey }}
                  extraFilters={filters}
                  defaultSort={[{ id: "total_eur", desc: true }]}
                  searchPlaceholder={agriLabel.searchRecipient(bg)}
                />
              )}
              <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
                {bg ? (
                  <>
                    „Чрез сдружение“ е различен вид връзка от „чрез фирма“:
                    местните инициативни групи (МИГ) са сдружения и са
                    официалният път, по който стигат парите за развитие на
                    селските райони, а не бизнес интерес. Затова двете не са
                    слети в един списък. Виж и{" "}
                    <Link
                      to={agriScopedHref("/subsidies/cross-programme", params)}
                      className="text-primary hover:underline"
                    >
                      получателите и по други програми
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    „Via an association“ is a different kind of link from „via a
                    company“: local action groups (LAGs) are associations and
                    are the official route by which rural-development money
                    reaches the ground, not a business interest. That is why the
                    two are not merged. See also{" "}
                    <Link
                      to={agriScopedHref("/subsidies/cross-programme", params)}
                      className="text-primary hover:underline"
                    >
                      recipients across other programmes
                    </Link>
                    .
                  </>
                )}
              </p>
            </DashboardSection>
          </>
        </AgriScopeFallback>
      </section>
    </>
  );
};
