// /connections — the unified connections graph, on the PG graph engine (P4.1). Renders the live
// down-sampled PUBLIC-figure bridge graph from /api/db/graph-global (graph_payloads, migrations
// 128/129) — a person↔company graph where money lives on the company node. Replaces the retired static
// person↔person connections*.json pipeline. Plan: docs/plans/connections-engine-v1.md §P4.1.
//
// Sections: hero stats · the facet×facet / party×party bridge matrix · the orbital graph (facet-
// coloured, BFS path-finder, node-click → graph-ego drill-in with a Tier-V private toggle) · the
// strongest person↔person connections (derived: pairs sharing a bridge company) · top people/companies.

import { FC, useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, Users, Network, Loader2 } from "lucide-react";
import { Title } from "@/ux/Title";
import { DeclarationsBreadcrumb } from "@/screens/components/DeclarationsBreadcrumb";
import { Card, CardContent } from "@/ux/Card";
import { StatCard } from "@/screens/dashboard/StatCard";
import { PartyBadge } from "@/screens/components/PartyBadge";
import { decodeEntities } from "@/lib/decodeEntities";
import { formatEurCompact } from "@/lib/currency";
import { useGraphGlobal } from "@/data/parliament/useGraphGlobal";
import { useGraphEgo } from "@/data/parliament/useGraphEgo";
import { GraphCanvas } from "@/screens/components/connections/GraphCanvas";
import {
  blobToView,
  blobStats,
  buildMatrixLookup,
  offDiagonalMax,
  facetAxes,
  partyAxes,
  facetColor,
  partyColor,
  blobStrongestPairs,
  blobTopPeople,
  blobTopCompanies,
  bfsPath,
  pathEdgeKey,
  hiddenNodeIds,
  FACET_ORDER,
  FACET_COLOR,
  type GraphViewNode,
  type GraphGlobalBlob,
} from "@/data/parliament/graphBlob";

// ── Facet label (bilingual via i18n keys connections_facet_<facet>). ──────────
const useFacetLabel = () => {
  const { t } = useTranslation();
  return (facet: string): string => t(`connections_facet_${facet}`) || facet;
};

// Compact EUR formatter bound to the active locale.
const useMoney = () => {
  const { i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";
  return (n: number): string => formatEurCompact(n, locale);
};

// ── The bridge matrix heatmap (facet×facet or party×party). Cell brightness is log-scaled. Cells are
// non-interactive (read-only counts) — the pair context is in the cell's aria-label/title. ──────────
const Heatmap: FC<{
  axes: string[];
  get: (a: string, b: string) => number;
  label: (a: string) => string;
  color: (a: string) => string;
  /** Optional. When given, a non-empty cell becomes a button that focuses the graph below
   *  on those two groups. Facet mode only — the graph filters by FACET, so a party-axis
   *  cell has nothing to hand it, and a click that silently did nothing would be worse than
   *  a cell that is plainly static. */
  onPick?: (a: string, b: string) => void;
}> = ({ axes, get, label, color, onPick }) => {
  const { t } = useTranslation();
  // THE COLOUR SCALE IGNORES THE DIAGONAL — see offDiagonalMax in graphBlob.ts for why,
  // and graphBlob.test.ts for the cases that hold it.
  const scaleMax = useMemo(() => offDiagonalMax(axes, get), [axes, get]);

  // CLAMPED, so the diagonal cannot produce t01 > 1 and an out-of-range alpha. Today the
  // `self` branch short-circuits before the value is used, which makes that safe by
  // ORDERING rather than by construction — one reordered ternary away from an invalid
  // rgba(). Політici↔Політici is 1,068 against an off-diagonal max of 358, so the
  // unclamped value really does reach 1.9.
  const bright = (n: number): number =>
    scaleMax <= 0 ? 0 : Math.min(1, Math.log(n + 1) / Math.log(scaleMax + 1));

  if (axes.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th />
            {/* LOWER TRIANGLE, DIAGONAL INCLUDED. `cellKey` canonicalises on `a <= b`, so
                `get` is symmetric BY CONSTRUCTION and the upper half was provably the same
                numbers mirrored — half the cells carried no information.
                This does NOT make the table narrower: every column still holds its own
                diagonal cell, so the column count is unchanged and the larger cells make it
                wider than before. The gain is that a reader is not asked to notice that the
                two halves match.
                Dropping the diagonal along with the mirror would have deleted the self-ties
                entirely, and „колко е свързана групата вътре в себе си" is worth reading
                even though it is not a bridge. It stays, in neutral ink and out of the
                scale. */}
            {axes.map((a) => (
              <th key={a} className="p-1 align-bottom">
                {/* min-h, NOT a fixed h-20. „Публичен сектор" is ~105px of vertical text at
                    this size and the box was 80px, so it rendered as „Публичен се". Letting
                    the content set the height fixes every label, not just today's longest. */}
                <div className="mx-auto flex min-h-[5rem] w-6 items-end justify-center">
                  <span
                    className="whitespace-nowrap"
                    style={{
                      writingMode: "vertical-rl",
                      transform: "rotate(180deg)",
                    }}
                  >
                    <span
                      className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                      style={{ background: color(a) }}
                    />
                    {label(a)}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {axes.map((row, rowIndex) => (
            <tr key={row}>
              <th className="whitespace-nowrap pr-2 text-right font-medium">
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: color(row) }}
                />
                {label(row)}
              </th>
              {axes.map((col, colIndex) => {
                if (colIndex > rowIndex) return <td key={col} />;
                const n = get(row, col);
                const self = row === col;
                const t01 = bright(n);

                // A DIFFERENT SENTENCE for a self-tie. „Политици ↔ Политици: 1068" is
                // exactly the reading the grey ink exists to prevent, and a screen-reader
                // user got it on the largest number in the table.
                const lbl = self
                  ? t("connections_matrix_cell_self", { group: label(row), n })
                  : t("connections_matrix_cell_bridge", {
                      a: label(row),
                      b: label(col),
                      n,
                    });
                const clickable = !!onPick && n > 0;
                // A button when it does something, a plain image when it does not. Giving
                // every cell a button role and having a third of them do nothing is the
                // affordance version of the caption this page already had to fix.
                const Cell = clickable ? "button" : "div";
                return (
                  <td key={col} className="p-0">
                    <Cell
                      {...(clickable
                        ? {
                            type: "button" as const,
                            onClick: () => onPick(row, col),
                            // The diagonal picks ONE group, so it cannot promise two. The
                            // first draft appended „покажи тези групи" to a label that had
                            // just said „не е мост".
                            "aria-label": t(
                              self
                                ? "connections_matrix_cell_action_self"
                                : "connections_matrix_cell_action",
                              { detail: lbl },
                            ),
                          }
                        : {
                            role: "img",
                            "aria-label": n > 0 ? lbl : undefined,
                          })}
                      title={n > 0 ? lbl : undefined}
                      className={`flex h-11 w-11 items-center justify-center rounded-sm text-xs tabular-nums ${
                        clickable
                          ? // focus-visible:ring, NOT an outline-transparent hover trick.
                            // The first draft overrode the UA focus ring at author
                            // specificity and revealed it only on hover, so ten new tab
                            // stops had no keyboard indicator at all.
                            "cursor-pointer ring-offset-background transition-shadow hover:ring-2 hover:ring-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                          : ""
                      } ${
                        self
                          ? "text-muted-foreground"
                          : // 0.7, NOT 0.45. The threshold was calibrated against the old
                            // diagonal-inclusive denominator; rescaling to the off-diagonal
                            // max lifts every cross-group cell's t01, so 0.45 now flips
                            // white onto ~50%-alpha blue at roughly 2:1 contrast. 0.7 maps
                            // to alpha ≈ 0.64, which is where white becomes the readable
                            // choice.
                            n > 0 && t01 > 0.7
                            ? "text-white"
                            : "text-foreground"
                      }`}
                      style={{
                        // The diagonal is drawn in NEUTRAL ink rather than on the scale.
                        // It is still a number worth reading — how tied together one group
                        // is internally — but it is not the quantity this chart ranks, and
                        // colouring it on the same ramp invites reading it as the biggest
                        // bridge.
                        background: self
                          ? "hsl(var(--muted))"
                          : n === 0
                            ? "transparent"
                            : `rgba(37,99,235,${0.14 + t01 * 0.72})`,
                      }}
                    >
                      {n > 0 ? n : ""}
                    </Cell>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── A node search/picker for the path-finder (From / To). Filters the drawn nodes by label. ─────────
const NodePicker: FC<{
  placeholder: string;
  nodes: GraphViewNode[];
  value: GraphViewNode | null;
  onPick: (n: GraphViewNode | null) => void;
}> = ({ placeholder, nodes, value, onPick }) => {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return nodes
      .filter((n) => n.label.toLowerCase().includes(term))
      .slice(0, 8);
  }, [q, nodes]);
  if (value)
    return (
      <div className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: value.color }}
        />
        <span className="truncate">{decodeEntities(value.label)}</span>
        <button
          type="button"
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            onPick(null);
            setQ("");
          }}
        >
          ✕
        </button>
      </div>
    );
  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border px-2 py-1 text-sm"
      />
      {matches.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow">
          {matches.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onPick(n);
                  setQ("");
                }}
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: n.color }}
                />
                <span className="truncate">{decodeEntities(n.label)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── The ego drill-in: the selected person's own company star, from /api/db/graph-ego, with a Tier-V
// private-owner toggle. Names only the subject — never a third party. ───────────────────────────────
const EgoPanel: FC<{ node: GraphViewNode; onClose: () => void }> = ({
  node,
  onClose,
}) => {
  const { t } = useTranslation();
  const money = useMoney();
  const [includePrivate, setIncludePrivate] = useState(false);
  const { ego, isLoading, isError } = useGraphEgo(
    node.slug ?? null,
    includePrivate,
    { enabled: node.kind === "person" },
  );
  return (
    <Card className="mt-3">
      <CardContent className="space-y-3 pt-5 text-sm">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: node.color }}
          />
          <Link
            to={`/person/${node.slug}`}
            className="font-semibold hover:underline"
          >
            {decodeEntities(node.label)}
          </Link>
          {node.party && (
            <PartyBadge
              label={node.party}
              color={node.partyColor}
              className="px-1 text-[9px]"
            />
          )}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includePrivate}
              onChange={(e) => setIncludePrivate(e.target.checked)}
            />
            {t("connections_include_private")}
          </label>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("connections_find_loading")}
          </div>
        ) : isError ? (
          <p className="text-destructive">{t("connections_error")}</p>
        ) : !ego || ego.companies.length === 0 ? (
          <p className="text-muted-foreground">{t("connections_ego_empty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {ego.companies.map((c) => (
              <li key={c.eik} className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <Link
                  to={`/company/${c.eik}`}
                  className="truncate hover:underline"
                >
                  {c.name ? decodeEntities(c.name) : c.eik}
                </Link>
                {c.money > 0 && (
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                    {money(c.money)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {ego?.disclaimer && (
          <p className="border-t pt-2 text-xs text-muted-foreground">
            {ego.disclaimer}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export const ConnectionsScreen: FC = () => {
  const { t } = useTranslation();
  const facetLabel = useFacetLabel();
  const { blob, isLoading, isError } = useGraphGlobal();

  const [matrixMode, setMatrixMode] = useState<"facet" | "party">("facet");
  const [hiddenFacets, setHiddenFacets] = useState<Set<string>>(new Set());
  // CLICKING A CELL FOCUSES THE GRAPH ON THOSE TWO GROUPS. It does NOT open a list of the
  // companies behind the number, and that is a deliberate limit rather than a first cut:
  // the matrix is computed server-side over all 1,823 bridge companies while the blob ships
  // a 150-company sample, so a client-side list could not reproduce the cell. Measured, the
  // gap is not marginal — executive↔politician is 358 in the matrix and 24 in the blob, and
  // magistrate↔executive is 8 against ZERO. Three of the ten cells would have shown a number
  // and opened an empty list, which is the same defect as a card that states a count and
  // lands somewhere that cannot name it.
  //
  // Reuses the facet filter the legend already drives, so the resulting state is visible and
  // clearable in the chips rather than being a hidden mode.
  const [selected, setSelected] = useState<GraphViewNode | null>(null);
  const [from, setFrom] = useState<GraphViewNode | null>(null);
  const [to, setTo] = useState<GraphViewNode | null>(null);

  // Declared AFTER the three setters it closes over — a useCallback dep array naming a
  // `const` above its declaration is a TDZ ReferenceError at render, not a lint nit.
  const focusPair = useCallback(
    (a: string, b: string) => {
      const next = new Set(
        FACET_ORDER.filter((f) => f !== "company" && f !== a && f !== b),
      );
      setHiddenFacets((prev) => {
        // TOGGLES. Replacing unconditionally left no way back from the matrix: re-clicking
        // the active cell did nothing, and recovery meant finding the right legend chips.
        const same =
          prev.size === next.size && [...next].every((f) => prev.has(f));
        return same ? new Set() : next;
      });
      // The path-finder is cleared with the filter. bfsPath skips blocked nodes, so an
      // endpoint in a facet this click just hid made the trail vanish while From and To
      // still named both people — the page said „няма път" when what changed was the view.
      setFrom(null);
      setTo(null);
      setSelected(null);
    },
    [setFrom, setTo, setSelected],
  );

  const view = useMemo(() => (blob ? blobToView(blob) : null), [blob]);
  // Hidden person nodes — shared by the BFS (blocked) and the canvas (draw), so the path can never
  // route through a node the canvas does not draw.
  const blocked = useMemo(
    () => (view ? hiddenNodeIds(view, hiddenFacets) : new Set<string>()),
    [view, hiddenFacets],
  );

  // BFS path highlight (over the SAME facet-filtered graph the canvas renders).
  const { pathIds, pathEdges } = useMemo(() => {
    const ids = new Set<string>();
    const edges = new Set<string>();
    if (view && from && to) {
      const trail = bfsPath(view, from.id, to.id, blocked);
      if (trail) {
        for (const id of trail) ids.add(id);
        for (let i = 1; i < trail.length; i++) {
          edges.add(pathEdgeKey(trail[i - 1], trail[i]));
          edges.add(pathEdgeKey(trail[i], trail[i - 1]));
        }
      }
    }
    return { pathIds: ids, pathEdges: edges };
  }, [view, from, to, blocked]);

  const pairs = useMemo(
    () => (blob ? blobStrongestPairs(blob, 24) : []),
    [blob],
  );
  const topPeople = useMemo(
    () => (blob ? blobTopPeople(blob, 12) : []),
    [blob],
  );
  const topCompanies = useMemo(
    () => (blob ? blobTopCompanies(blob, 12) : []),
    [blob],
  );

  const toggleFacet = (f: string) =>
    setHiddenFacets((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  return (
    <div className="w-full">
      <Title description="Person–company connections graph (public figures)">
        {t("connections_title")}
      </Title>
      <DeclarationsBreadcrumb
        currentKey="connections_link_label"
        className="mt-5"
      />

      {isLoading && !blob ? (
        <div className="my-10 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("connections_find_loading")}
        </div>
      ) : isError ? (
        <p className="my-10 text-center text-destructive">
          {t("connections_error")}
        </p>
      ) : !blob || !view ? (
        <p className="my-10 text-center text-muted-foreground">
          {t("connections_find_empty")}
        </p>
      ) : (
        <ConnectionsBody
          blob={blob}
          view={view}
          facetLabel={facetLabel}
          matrixMode={matrixMode}
          setMatrixMode={setMatrixMode}
          hiddenFacets={hiddenFacets}
          toggleFacet={toggleFacet}
          showOnlyFacets={focusPair}
          selected={selected}
          setSelected={setSelected}
          from={from}
          setFrom={setFrom}
          to={to}
          setTo={setTo}
          pathIds={pathIds}
          pathEdges={pathEdges}
          blocked={blocked}
          pairs={pairs}
          topPeople={topPeople}
          topCompanies={topCompanies}
        />
      )}
    </div>
  );
};

// Body extracted so the loading/empty guards keep the hook order stable in the parent.
const ConnectionsBody: FC<{
  blob: GraphGlobalBlob;
  view: ReturnType<typeof blobToView>;
  facetLabel: (f: string) => string;
  matrixMode: "facet" | "party";
  setMatrixMode: (m: "facet" | "party") => void;
  hiddenFacets: Set<string>;
  toggleFacet: (f: string) => void;
  showOnlyFacets: (a: string, b: string) => void;
  selected: GraphViewNode | null;
  setSelected: (n: GraphViewNode | null) => void;
  from: GraphViewNode | null;
  setFrom: (n: GraphViewNode | null) => void;
  to: GraphViewNode | null;
  setTo: (n: GraphViewNode | null) => void;
  pathIds: Set<string>;
  pathEdges: Set<string>;
  blocked: Set<string>;
  pairs: ReturnType<typeof blobStrongestPairs>;
  topPeople: ReturnType<typeof blobTopPeople>;
  topCompanies: ReturnType<typeof blobTopCompanies>;
}> = ({
  blob,
  view,
  facetLabel,
  matrixMode,
  setMatrixMode,
  hiddenFacets,
  toggleFacet,
  showOnlyFacets,
  selected,
  setSelected,
  from,
  setFrom,
  to,
  setTo,
  pathIds,
  pathEdges,
  blocked,
  pairs,
  topPeople,
  topCompanies,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("bg") ? "bg-BG" : "en-GB";
  const graphRef = useRef<HTMLDivElement>(null);
  const [pickedPair, setPickedPair] = useState<[string, string] | null>(null);
  // The state change is the parent's (it owns hiddenFacets); the scroll is ours, because the
  // graph card is here. Without it the click filters a graph that is off-screen and the cell
  // appears to do nothing.
  // THE RIGHT EMPTINESS, and my first attempt measured the wrong one. Filtering to
  // magistrate+executive leaves 205 people drawn, so a node count is never zero — what is
  // missing is a COMPANY joining the two groups. The cell says 8 and the sample holds none,
  // so the reader gets two clouds and no line between them unless the page says why.
  const pairHasNoDrawnLink = useMemo(() => {
    if (!view || !pickedPair) return false;
    const [a, b] = pickedPair;
    if (a === b) return false;
    const facetOf = new Map(
      view.nodes
        .filter((n) => n.kind === "person")
        .map((n) => [n.id, n.facet ?? ""]),
    );
    const sides = new Map<string, Set<string>>();
    for (const e of view.edges) {
      const f = facetOf.get(e.source) ?? facetOf.get(e.target);
      const company = facetOf.has(e.source) ? e.target : e.source;
      const person = facetOf.has(e.source) ? e.source : e.target;
      if (f === undefined || blocked.has(person)) continue;
      const set = sides.get(company) ?? new Set<string>();
      set.add(facetOf.get(person) ?? "");
      sides.set(company, set);
    }
    for (const set of sides.values())
      if (set.has(a) && set.has(b)) return false;
    return true;
  }, [view, blocked, pickedPair]);

  const pickPair = useCallback(
    (a: string, b: string) => {
      showOnlyFacets(a, b);
      setPickedPair((prev) =>
        prev && prev[0] === a && prev[1] === b ? null : [a, b],
      );
      graphRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [showOnlyFacets],
  );
  const stats = blobStats(blob);
  const money = useMoney();
  const facetM = useMemo(() => buildMatrixLookup(blob.matrix), [blob]);
  const partyM = useMemo(() => buildMatrixLookup(blob.partyMatrix), [blob]);
  const fAxes = useMemo(() => facetAxes(blob), [blob]);
  const pAxes = useMemo(() => partyAxes(blob).slice(0, 12), [blob]);
  // Pickers offer only VISIBLE people (not hidden by a facet toggle) so an unrenderable endpoint can't
  // be chosen. Memoized (FINDING-010) so the NodePicker match memo isn't invalidated each render.
  const people = useMemo(
    () => view.nodes.filter((n) => n.kind === "person" && !blocked.has(n.id)),
    [view, blocked],
  );

  return (
    <div className="space-y-4">
      {/* Hero */}
      <Card className="mt-4">
        <CardContent className="pt-5 text-sm">
          <p>{t("connections_intro")}</p>
        </CardContent>
      </Card>

      {/* The three figures, as cards rather than as one run-on sentence — the shape every
          other dashboard on the site uses. „150 мостови фирми (от 1823)" in particular was
          a bare parenthesis: the hint now says what the 1,823 are. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t("connections_kpi_figures")}>
          <span className="text-lg font-bold tabular-nums md:text-xl">
            {stats.publicFigures.toLocaleString(locale)}
          </span>
        </StatCard>
        <StatCard
          label={t("connections_kpi_bridges")}
          hint={t("connections_hero_bridge_hint", {
            total: stats.bridgeCompaniesTotal.toLocaleString(locale),
          })}
        >
          <span className="text-lg font-bold tabular-nums md:text-xl">
            {stats.bridgeCompanies.toLocaleString(locale)}
          </span>
          <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
            {t("connections_hero_of")}{" "}
            {stats.bridgeCompaniesTotal.toLocaleString(locale)}
          </span>
        </StatCard>
        <StatCard label={t("connections_kpi_edges")}>
          <span className="text-lg font-bold tabular-nums md:text-xl">
            {stats.edges.toLocaleString(locale)}
          </span>
        </StatCard>
      </div>

      {/* Matrix */}
      <Card>
        <CardContent className="pt-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-semibold">
              {t("connections_matrix_title")}
            </span>
            <div className="ml-auto flex rounded-md border text-xs">
              <button
                type="button"
                onClick={() => setMatrixMode("facet")}
                className={`px-2 py-1 ${matrixMode === "facet" ? "bg-primary text-primary-foreground" : ""}`}
              >
                {t("connections_matrix_by_facet")}
              </button>
              <button
                type="button"
                onClick={() => setMatrixMode("party")}
                className={`px-2 py-1 ${matrixMode === "party" ? "bg-primary text-primary-foreground" : ""}`}
              >
                {t("connections_matrix_by_party")}
              </button>
            </div>
          </div>
          {matrixMode === "facet" ? (
            <Heatmap
              axes={fAxes}
              get={facetM.get}
              label={facetLabel}
              color={(a) => facetColor(a)}
              onPick={pickPair}
            />
          ) : pAxes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("connections_find_empty")}
            </p>
          ) : (
            <Heatmap
              axes={pAxes}
              get={partyM.get}
              label={(a) => a}
              color={(a) => partyColor(blob, a)}
            />
          )}
          {/* PER MODE. One caption sat outside the branch and read „Връзки
              депутат↔депутат по партии" under BOTH — so the role matrix, which is
              facet↔facet across all 354 public figures, was captioned as an MP-by-party
              chart. It also said „кликнете върху клетка за детайли" while the cells carry
              no handler at all; the instruction is gone rather than made true, because a
              per-cell drill-down is a feature and not a caption fix. */}
          <p className="mt-2 text-xs text-muted-foreground">
            {matrixMode === "facet"
              ? t("connections_matrix_caption_facet")
              : t("connections_matrix_caption_party")}
          </p>
          {/* The click affordance is spelled out ONLY where it exists — facet mode. It also
              names the gap between the two numbers a reader is about to see: the cell is the
              full corpus, the graph is a 150-company sample, and without saying so the
              filtered graph reads as a contradiction of the cell that opened it. */}
          {matrixMode === "facet" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("connections_matrix_pick_hint")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Graph */}
      <Card ref={graphRef}>
        <CardContent className="pt-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Network className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">
              {t("connections_graph_title")}
            </span>
            {/* Legend / facet toggles */}
            <div className="flex flex-wrap gap-2">
              {FACET_ORDER.filter((f) => f !== "company").map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFacet(f)}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                    hiddenFacets.has(f) ? "opacity-40" : ""
                  }`}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: FACET_COLOR[f] }}
                  />
                  {facetLabel(f)}
                </button>
              ))}
            </div>
          </div>

          {/* Path-finder */}
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <NodePicker
              placeholder={t("connections_find_from")}
              nodes={people}
              value={from}
              onPick={setFrom}
            />
            <NodePicker
              placeholder={t("connections_find_to")}
              nodes={people}
              value={to}
              onPick={setTo}
            />
          </div>
          {from && to && pathIds.size === 0 && (
            <p className="mb-2 text-xs text-amber-600">
              {t("connections_find_no_path")}
            </p>
          )}

          {/* EMPTY STATE. A facet filter can leave nothing drawn, and the matrix click is
              the likeliest way in: the graph is a 150-of-1,823 sample, so a pair with a real
              number in the matrix can have zero drawn nodes — magistrate↔executive is 8 in
              the cell and 0 here. Without this the click scrolls the reader to a blank
              canvas, which reads as a broken chart rather than as a thin sample. */}
          {pairHasNoDrawnLink ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              {t("connections_graph_empty_filter")}
            </p>
          ) : null}

          <GraphCanvas
            view={view}
            selectedId={selected?.id ?? null}
            pathIds={pathIds}
            pathEdges={pathEdges}
            hiddenFacets={hiddenFacets}
            onSelect={(n) => setSelected(n && n.kind === "person" ? n : null)}
          />

          {selected && selected.kind === "person" && (
            <EgoPanel node={selected} onClose={() => setSelected(null)} />
          )}
        </CardContent>
      </Card>

      {/* Strongest connections */}
      {pairs.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <div className="mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">
                {t("connections_strongest")}
              </span>
            </div>
            <ul className="space-y-2 text-sm">
              {pairs.map((p) => (
                <li
                  key={`${p.a.id}-${p.b.id}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/50 pb-2 last:border-0 last:pb-0"
                >
                  <Link
                    to={`/person/${p.a.slug}`}
                    className="font-medium hover:underline"
                  >
                    {decodeEntities(p.a.name ?? p.a.slug)}
                  </Link>
                  {p.a.party && (
                    <PartyBadge
                      label={p.a.party}
                      color={p.a.partyColor}
                      className="px-1 text-[9px]"
                    />
                  )}
                  <span className="text-muted-foreground">↔</span>
                  <Link
                    to={`/person/${p.b.slug}`}
                    className="font-medium hover:underline"
                  >
                    {decodeEntities(p.b.name ?? p.b.slug)}
                  </Link>
                  {p.b.party && (
                    <PartyBadge
                      label={p.b.party}
                      color={p.b.partyColor}
                      className="px-1 text-[9px]"
                    />
                  )}
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" />
                    {p.shared.length}
                    {p.sharedMoney > 0 && (
                      <span className="tabular-nums">
                        · {money(p.sharedMoney)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Rankings */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <div className="mb-2 text-sm font-semibold">
              {t("connections_top_people")}
            </div>
            <ul className="space-y-1.5 text-sm">
              {topPeople.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: facetColor(p.facet) }}
                  />
                  <Link
                    to={`/person/${p.slug}`}
                    className="truncate hover:underline"
                  >
                    {decodeEntities(p.name ?? p.slug)}
                  </Link>
                  {p.money > 0 && (
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                      {money(p.money)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="mb-2 text-sm font-semibold">
              {t("connections_top_companies")}
            </div>
            <ul className="space-y-1.5 text-sm">
              {topCompanies.map((c) => (
                <li key={c.eik} className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Link
                    to={`/company/${c.eik}`}
                    className="truncate hover:underline"
                  >
                    {c.name ? decodeEntities(c.name) : c.eik}
                  </Link>
                  {c.money > 0 && (
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                      {money(c.money)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
