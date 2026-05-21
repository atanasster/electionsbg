// Business-connections section for the official profile page. Reads the
// per-official subgraph (official-connections/{slug}.json) and renders the
// official's company links plus the MPs and other officials who share one of
// those companies. Renders nothing when the official has no connections.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Network } from "lucide-react";
import type {
  ConnectionsCompanyNode,
  ConnectionsMpNode,
  ConnectionsNode,
  ConnectionsOfficialNode,
} from "@/data/dataTypes";
import { useOfficialConnections } from "@/data/officials/useOfficialConnections";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";

export const OfficialConnectionsSection: FC<{ slug: string }> = ({ slug }) => {
  const { t } = useTranslation();
  const { subgraph } = useOfficialConnections(slug);

  const view = useMemo(() => {
    if (!subgraph) return null;
    const hub = subgraph.officialNodeId;
    const byId = new Map<string, ConnectionsNode>();
    for (const n of subgraph.nodes) byId.set(n.id, n);

    // 1-hop: companies the official is directly linked to. One company can
    // carry several edges (e.g. a declared stake AND a TR manager role) —
    // collapse them into a single row with the distinct roles joined.
    const companyMap = new Map<
      string,
      { node: ConnectionsCompanyNode; roles: Set<string> }
    >();
    const companyIds = new Set<string>();
    for (const e of subgraph.edges) {
      if (e.source !== hub) continue;
      const c = byId.get(e.target);
      if (c?.type !== "company") continue;
      let m = companyMap.get(c.id);
      if (!m) {
        m = { node: c, roles: new Set<string>() };
        companyMap.set(c.id, m);
      }
      m.roles.add(e.role.replace(/_/g, " "));
      companyIds.add(c.id);
    }
    const companies = [...companyMap.values()].map((m) => ({
      node: m.node,
      role: [...m.roles].join(", "),
    }));

    // 2-hop: MPs and officials sharing one of those companies.
    const mps = new Map<string, ConnectionsMpNode>();
    const officials = new Map<string, ConnectionsOfficialNode>();
    for (const e of subgraph.edges) {
      const companyEnd = companyIds.has(e.source)
        ? e.source
        : companyIds.has(e.target)
          ? e.target
          : null;
      if (!companyEnd) continue;
      const otherEnd = e.source === companyEnd ? e.target : e.source;
      if (otherEnd === hub) continue;
      const other = byId.get(otherEnd);
      if (other?.type === "mp") mps.set(other.id, other);
      else if (other?.type === "official") officials.set(other.id, other);
    }

    return {
      companies: companies.sort((a, b) =>
        a.node.label.localeCompare(b.node.label, "bg"),
      ),
      mps: [...mps.values()].sort((a, b) =>
        a.label.localeCompare(b.label, "bg"),
      ),
      officials: [...officials.values()].sort((a, b) =>
        a.label.localeCompare(b.label, "bg"),
      ),
    };
  }, [subgraph]);

  if (!view || view.companies.length === 0) return null;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Network className="h-4 w-4" />
          {t("official_connections_title") || "Business connections"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("official_connections_note") ||
            "Companies this official is tied to via declared stakes or the Commerce Registry, and the MPs and officials who share those companies. Name-only Commerce Registry matches are not corroborated."}
        </p>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
          {t("official_connections_companies") || "Companies"} (
          {view.companies.length})
        </h3>
        <ul className="divide-y text-sm">
          {view.companies.map(({ node, role }) => (
            <li
              key={node.id}
              className="flex items-center justify-between gap-3 py-1.5"
            >
              {node.slug ? (
                <Link
                  to={`/mp/company/${node.slug}`}
                  className="text-primary hover:underline truncate"
                >
                  {node.label}
                </Link>
              ) : (
                <span className="truncate">{node.label}</span>
              )}
              <span className="text-xs text-muted-foreground shrink-0">
                {role}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {view.mps.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            {t("official_connections_mps") || "Shares companies with MPs"} (
            {view.mps.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {view.mps.map((m) => (
              <Link
                key={m.id}
                to={candidateUrlForMp(m.mpId)}
                className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent"
              >
                {m.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {view.officials.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            {t("official_connections_officials") ||
              "Shares companies with officials"}{" "}
            ({view.officials.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {view.officials.map((o) => (
              <Link
                key={o.id}
                to={`/officials/${o.slug}`}
                className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent"
              >
                {o.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
};
