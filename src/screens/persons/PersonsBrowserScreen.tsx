// The global persons browser (/persons) — a server-side paginated/sorted/filtered
// DbDataTable over the whole 56,801-person identity layer (matview person_browse_table,
// migration 120). Plan: docs/plans/persons-browser-v1.md.
//
// Every other person surface on the site is either ONE profile reached by search
// (/person/:slug) or ONE facet ranked by wealth (/officials/assets, /mp-assets). This is
// the first that lets a reader ask a question ACROSS the layer — every councillor in
// Бургас who also runs a company, everyone who has switched parties, which magistrates
// declared a stake. It mirrors ContractsBrowserDbScreen's rhythm so the two browsers read
// as one system.
//
// FILTERING GOES THROUGH THE PADDED CODE SETS, never the display scalar beside them. A
// person holds many roles in many places; `oblast_code` is the representative seat, and
// filtering on it would drop 1,851 people from an oblast they genuinely serve — which
// renders as "no such people" rather than as a narrowed view. Same reasoning for party:
// ?party=gerb means "ever affiliated", which is what a reader means, and which keeps the
// 4,723 party-switchers visible.
//
// THE AVATAR IS PRESENTATIONAL (MpAvatarView, not MpAvatar). photo_url is denormalized
// into the matview precisely so this page never downloads parliament/index.json for a
// face — a 972 KB index for one avatar is a regression this codebase has already fixed
// once (project_mp_avatar_index).

import { FC, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { Breadcrumbs } from "@/ux/Breadcrumbs";
import { MpAvatarView } from "@/screens/components/candidates/MpAvatar";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { usePersonLabels } from "@/lib/personLabels";
import {
  useUrlPersonFilters,
  PERSON_FILTER_ALL,
  codeSetMatch,
} from "@/data/persons/useUrlPersonFilters";
import { usePersonFacets } from "@/data/persons/usePersonFacets";
import {
  PERSON_GROUPS,
  GROUP_COLUMNS,
  groupByKey,
} from "@/data/persons/personGroups";
import { PersonFilterSelect } from "./PersonFilterSelect";
import type { PersonBrowseRow } from "@/data/persons/personBrowseTypes";

export const PersonsBrowserScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const { colorFor, displayNameForId } = useCanonicalParties();
  const { roleLabel } = usePersonLabels();
  const [params] = useSearchParams();

  const {
    facet,
    role,
    party,
    oblast,
    court,
    declaredOnly,
    heldOfficeOnly,
    setFacet,
    setRole,
    setParty,
    obshtina,
    // ?oblast, ?obshtina and ?court are READ here but have no pickers yet — the place/court selectors
    // land in T2, which is also where their vocabularies get solved properly. Faceting
    // `oblast_code` would be both unavailable (runDbFacets only facets FILTERABLE columns,
    // and that one is display-only by design) and misleading (it counts representative
    // seats, while the filter matches every seat, so the dropdown would promise fewer
    // people than clicking it returns). A deep link into either already works.
    setDeclaredOnly,
    setHeldOfficeOnly,
    hasActiveFilters,
    clearFilters,
  } = useUrlPersonFilters();

  // The active filter set. Code-set columns take a SPACE-PADDED, LIKE-escaped value so the
  // engine's ILIKE '%…%' matches a whole token: ' ngo ' can never hit 'ngo_board', and the
  // `_` in 'p_16' / 'chief_architect' is a literal rather than a wildcard.
  // Each dimension's filter fragment, kept SEPARATE so a facet request can leave its own
  // dimension out (otherwise picking "Кмет" collapses the role dropdown to just "Кмет").
  const groupF = useMemo<DbColumnFilter[]>(() => {
    const g = groupByKey(facet);
    return g ? [{ id: g.column, value: true }] : [];
  }, [facet]);
  const roleF = useMemo<DbColumnFilter[]>(
    () =>
      role !== PERSON_FILTER_ALL
        ? [{ id: "role_codes", value: codeSetMatch(role) }]
        : [],
    [role],
  );
  const partyF = useMemo<DbColumnFilter[]>(
    () =>
      party !== PERSON_FILTER_ALL
        ? [{ id: "party_codes", value: codeSetMatch(party) }]
        : [],
    [party],
  );
  const placeF = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    if (oblast !== PERSON_FILTER_ALL)
      f.push({ id: "oblast_codes", value: codeSetMatch(oblast) });
    if (obshtina !== PERSON_FILTER_ALL)
      f.push({ id: "obshtina_code", value: [obshtina] });
    if (court !== PERSON_FILTER_ALL)
      f.push({ id: "place_code", value: [court] });
    return f;
  }, [oblast, obshtina, court]);
  const toggleF = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    if (declaredOnly) f.push({ id: "has_declaration", value: true });
    if (heldOfficeOnly) f.push({ id: "held_office", value: true });
    return f;
  }, [declaredOnly, heldOfficeOnly]);

  const extraFilters = useMemo<DbColumnFilter[]>(
    () => [...groupF, ...roleF, ...partyF, ...placeF, ...toggleF],
    [groupF, roleF, partyF, placeF, toggleF],
  );

  // Dropdown vocabularies. Each EXCLUDES its own dimension so the control it feeds never
  // collapses to the one option already chosen, and none is scoped by the free-text search
  // — the dropdowns describe the corpus, the table describes the query.
  const facets = usePersonFacets(
    useMemo(
      () => ({
        // The group counts are EXACT: the boolean columns counted here are the same ones
        // the filter applies. That is not true of role/party below, which is why those
        // carry no counts.
        groups: {
          columns: GROUP_COLUMNS,
          filters: [...roleF, ...partyF, ...placeF, ...toggleF],
        },
        roles: {
          columns: ["primary_role"],
          filters: [...groupF, ...partyF, ...placeF, ...toggleF],
        },
        parties: {
          columns: ["party_primary"],
          filters: [...groupF, ...roleF, ...placeF, ...toggleF],
        },
      }),
      [groupF, roleF, partyF, placeF, toggleF],
    ),
  );

  // A bool facet answers {true: n, false: m}; the `true` bucket is the group's size.
  const groupOptions = useMemo(
    () =>
      PERSON_GROUPS.map((g) => ({
        value: g.key,
        label: t(g.labelKey, { defaultValue: g.labelBg }),
        count:
          (facets[g.column] ?? []).find((o) => String(o.value) === "true")
            ?.count ?? 0,
      })).filter((o) => o.count > 0),
    [facets, t],
  );

  // NO COUNTS on role/party, deliberately. The facet groups `primary_role` /
  // `party_primary` (the representative seat) while the filter matches `role_codes` /
  // `party_codes` (every seat), so a count here UNDER-promises what clicking returns —
  // measured: Кмет 619 shown vs 921 returned, p_6 940 vs 1,300. A wrong number is worse
  // than none; the exact-count version needs a facet over the padded set, which the engine
  // cannot express today.
  const roleOptions = useMemo(
    () =>
      (facets.primary_role ?? []).map((o) => ({
        value: o.value,
        label: roleLabel(o.value) || o.value,
      })),
    [facets, roleLabel],
  );
  const partyOptions = useMemo(
    () =>
      (facets.party_primary ?? []).map((o) => ({
        value: o.value,
        label: displayNameForId(o.value) || o.value,
      })),
    [facets, displayNameForId],
  );

  const columns = useMemo<DataTableColumnDef<PersonBrowseRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: t("persons_col_name", { defaultValue: "Име" }),
        cell: ({ row }) => {
          const p = row.original;
          return (
            <Link
              to={`/person/${p.slug}`}
              className="flex items-center gap-2 hover:underline"
            >
              <MpAvatarView
                photoUrl={p.photoUrl}
                displayName={p.name}
                ringColor={p.partyPrimary ? colorFor(p.partyPrimary) : null}
                className="h-7 w-7 shrink-0"
              />
              <span className="text-sm font-medium">{p.name}</span>
            </Link>
          );
        },
      },
      {
        id: "primary_role",
        accessorFn: (r) => r.primaryRole,
        header: t("persons_col_role", { defaultValue: "Роля" }),
        cell: ({ row }) => {
          const p = row.original;
          // The representative post, plus how many others this person holds. The count is
          // the browser's whole thesis in one column — one human, many roles — and it is
          // why the table folds person_role instead of listing it.
          const extra = (p.rolesN ?? 1) - 1;
          return (
            <div className="flex flex-wrap items-center gap-1">
              <span className="inline-block whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {roleLabel(p.primaryRole) || p.primaryRole}
              </span>
              {extra > 0 ? (
                <span
                  className="text-xs text-muted-foreground"
                  title={t("persons_more_roles_tip", {
                    defaultValue: "Още {{count}} роли в регистъра",
                    count: extra,
                  })}
                >
                  +{extra}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "party_primary",
        accessorFn: (r) => r.partyPrimary,
        header: t("persons_col_party", { defaultValue: "Партия" }),
        enableSorting: false,
        cell: ({ row }) => {
          const p = row.original;
          if (!p.partyPrimary)
            return <span className="text-xs text-muted-foreground">—</span>;
          const color = colorFor(p.partyPrimary);
          const switcher = (p.partiesN ?? 1) - 1;
          return (
            <div className="flex flex-wrap items-center gap-1">
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
                style={color ? { borderColor: color } : undefined}
              >
                {color ? (
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                ) : null}
                {displayNameForId(p.partyPrimary) || p.partyPrimary}
              </span>
              {switcher > 0 ? (
                <span
                  className="text-xs text-muted-foreground"
                  title={t("persons_more_parties_tip", {
                    defaultValue: "Свързан(а) с още {{count}} партии",
                    count: switcher,
                  })}
                >
                  +{switcher}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "parties_n",
        accessorFn: (r) => r.partiesN ?? null,
        header: t("persons_col_parties_n", { defaultValue: "Партии" }),
        meta: { align: "right" },
        className: "hidden lg:table-cell",
        cell: ({ row }) => (
          <span className="block text-right text-sm tabular-nums">
            {row.original.partiesN ?? "—"}
          </span>
        ),
      },
      {
        // ONE place column, not "Област / Община": place_label already reads as a МИР, an
        // obshtina or a court depending on place_kind, so splitting it would leave two
        // mostly-empty columns.
        id: "place_label",
        accessorFn: (r) => r.placeLabel,
        header: t("persons_col_place", { defaultValue: "Място" }),
        className: "hidden md:table-cell",
        cell: ({ row }) => {
          const p = row.original;
          const label = (isBg ? p.placeLabel : p.placeLabelEn) ?? p.placeLabel;
          return label ? (
            <span className="text-sm">{label}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "latest_declaration_year",
        accessorFn: (r) => r.latestDeclarationYear ?? null,
        header: t("persons_col_declaration", { defaultValue: "Декларация" }),
        className: "hidden sm:table-cell",
        cell: ({ row }) => {
          const p = row.original;
          // THREE distinguishable states, never collapsed into one dash:
          //   a year        — filed, and this is the newest one on record
          //   "подадена"    — filed, but declared nothing of value (090 emits no year)
          //   "—"           — nothing on record at all, which for a sitting official is
          //                   arguably the more newsworthy fact of the two
          if (p.latestDeclarationYear)
            return (
              <span className="text-sm tabular-nums">
                {p.latestDeclarationYear}
              </span>
            );
          if (p.hasDeclaration)
            return (
              <span
                className="text-xs text-muted-foreground"
                title={
                  t("persons_declared_nothing_tip") ||
                  "Подадена декларация без деклариранo имущество със стойност."
                }
              >
                {t("persons_declared_nothing", { defaultValue: "подадена" })}
              </span>
            );
          return <span className="text-xs text-muted-foreground">—</span>;
        },
      },
      {
        id: "roles_n",
        accessorFn: (r) => r.rolesN ?? null,
        header: t("persons_col_roles_n", { defaultValue: "Роли" }),
        meta: { align: "right" },
        className: "hidden lg:table-cell",
        cell: ({ row }) => (
          <span className="block text-right text-sm tabular-nums">
            {row.original.rolesN ?? "—"}
          </span>
        ),
      },
    ],
    [t, roleLabel, colorFor, displayNameForId, isBg],
  );

  return (
    <>
      <Title description="Every person the site can identify across parliament, local government, the courts, the company register and the campaign-finance filings — searchable and filterable.">
        {t("persons_title", { defaultValue: "Хора" })}
      </Title>
      <Breadcrumbs
        items={[
          { label: t("nav_governance"), to: "/governance" },
          { label: t("persons_title", { defaultValue: "Хора" }) },
        ]}
      />

      <section aria-label="persons" className="my-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4 shrink-0" />
          {t("persons_intro") ||
            "Един човек, събран от девет регистъра — парламент, местна власт, съд, Търговски регистър и дарения."}
        </div>

        <DbDataTable<PersonBrowseRow>
          resource="persons"
          extraFilters={extraFilters}
          columns={columns}
          defaultSort={[{ id: "prominence", desc: true }]}
          pageSize={25}
          initialSearch={params.get("q") ?? ""}
          searchPlaceholder={t("persons_search_placeholder", {
            defaultValue: "Търси име или институция…",
          })}
          toolbar={
            <>
              <PersonFilterSelect
                value={facet}
                onChange={setFacet}
                options={groupOptions}
                allLabel={t("persons_filter_all_facets", {
                  defaultValue: "Всички групи",
                })}
                label={t("persons_filter_group_label", {
                  defaultValue: "Група",
                })}
                locale={isBg ? "bg-BG" : "en-GB"}
              />
              <PersonFilterSelect
                value={role}
                onChange={setRole}
                options={roleOptions}
                allLabel={t("persons_filter_all_roles", {
                  defaultValue: "Всички роли",
                })}
                label={t("persons_filter_role_label", { defaultValue: "Роля" })}
              />
              <PersonFilterSelect
                value={party}
                onChange={setParty}
                options={partyOptions}
                allLabel={t("persons_filter_all_parties", {
                  defaultValue: "Всички партии",
                })}
                label={t("persons_filter_party_label", {
                  defaultValue: "Партия",
                })}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={heldOfficeOnly}
                  onChange={(e) => setHeldOfficeOnly(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                {t("persons_filter_held_office", {
                  defaultValue: "само заемали длъжност",
                })}
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={declaredOnly}
                  onChange={(e) => setDeclaredOnly(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                {t("persons_filter_declared", {
                  defaultValue: "само с декларация",
                })}
              </label>
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-primary underline underline-offset-2 hover:no-underline"
                >
                  {t("contracts_clear_filters", {
                    defaultValue: "Изчисти филтрите",
                  })}
                </button>
              ) : null}
            </>
          }
        />
      </section>
    </>
  );
};
