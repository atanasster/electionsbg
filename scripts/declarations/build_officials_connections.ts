// Officials ↔ MP / peer bridge.
//
// Additive layer on top of the officials → company cross-reference: joins
// data/officials/derived/company_links.json against the MP companies-index
// (data/parliament/companies-index.json) on company UIC, to surface — per
// official — which MPs and which other officials they share a company with.
//
// This does NOT touch the MP connections-graph builder. It is the additive
// alternative to folding officials into connections.json as first-class
// nodes; the full graph generalisation remains a separate, deferred phase.
//
// Output: data/officials/derived/connections.json.

import fs from "fs";
import path from "path";
import type { CompaniesIndexFile } from "./build_company_index";
import type {
  OfficialBridgeCompany,
  OfficialCompanyLinksFile,
  OfficialConnectionsEntry,
  OfficialConnectionsFile,
  OfficialMpConnection,
  OfficialPeerConnection,
} from "../../src/data/dataTypes";
import { ROOT, normalize } from "../officials/shared";

const COMPANY_LINKS = path.join(
  ROOT,
  "data",
  "officials",
  "derived",
  "company_links.json",
);
const COMPANIES_INDEX = path.join(
  ROOT,
  "data",
  "parliament",
  "companies-index.json",
);
const OUT = path.join(ROOT, "data", "officials", "derived", "connections.json");

// Skip official↔official pairing for a company whose officer list is
// implausibly large — that is namesake pollution, not a real board, and it
// would otherwise create an O(n²) burst of low-value pairs.
const PEER_FANOUT_LIMIT = 25;

export const buildOfficialsConnections = ({
  stringify,
}: {
  stringify: (o: unknown) => string;
}): void => {
  if (!fs.existsSync(COMPANY_LINKS)) {
    console.log(
      "[officials-connections] no company_links.json — run the cross-reference first; skipping",
    );
    return;
  }
  if (!fs.existsSync(COMPANIES_INDEX)) {
    console.log(
      "[officials-connections] no companies-index.json — run /update-connections first; skipping",
    );
    return;
  }

  const links: OfficialCompanyLinksFile = JSON.parse(
    fs.readFileSync(COMPANY_LINKS, "utf-8"),
  );
  const companiesIndex: CompaniesIndexFile = JSON.parse(
    fs.readFileSync(COMPANIES_INDEX, "utf-8"),
  );

  // MP side: company UIC → the (deduped) MPs tied to that company.
  type MpRef = { mpId: number; mpName: string; mpNameNorm: string };
  const mpByUic = new Map<string, MpRef[]>();
  for (const company of companiesIndex.companies) {
    const uic = company.tr?.uic;
    if (!uic || !company.mpRoles?.length) continue;
    const seen = new Set<number>();
    const mps: MpRef[] = [];
    for (const r of company.mpRoles) {
      if (seen.has(r.mpId)) continue;
      seen.add(r.mpId);
      mps.push({
        mpId: r.mpId,
        mpName: r.mpName,
        mpNameNorm: normalize(r.mpName),
      });
    }
    mpByUic.set(uic, mps);
  }

  // Officials side: per official, the UICs they touch (best confidence +
  // a company name); and the reverse index UIC → officials.
  type UicInfo = { confidence: "high" | "low"; companyName: string | null };
  const officialUics = new Map<string, Map<string, UicInfo>>();
  const officialsByUic = new Map<string, string[]>();
  // slug → the official's normalised name, used to drop "self-match" edges:
  // a minister who is also a sitting MP would otherwise connect to himself,
  // and two officials sharing a name link a company only by that shared name.
  const nameNormBySlug = new Map<string, string>();

  for (const [slug, entry] of Object.entries(links.byOfficial)) {
    nameNormBySlug.set(slug, entry.links[0]?.nameNorm ?? "");
    const uicMap = new Map<string, UicInfo>();
    for (const link of entry.links) {
      if (!link.uic) continue;
      const prev = uicMap.get(link.uic);
      if (!prev) {
        uicMap.set(link.uic, {
          confidence: link.confidence,
          companyName: link.companyName,
        });
      } else {
        if (link.confidence === "high") prev.confidence = "high";
        if (!prev.companyName && link.companyName) {
          prev.companyName = link.companyName;
        }
      }
    }
    if (uicMap.size === 0) continue;
    officialUics.set(slug, uicMap);
    for (const uic of uicMap.keys()) {
      const arr = officialsByUic.get(uic) ?? [];
      arr.push(slug);
      officialsByUic.set(uic, arr);
    }
  }

  const byOfficial: Record<string, OfficialConnectionsEntry> = {};
  let officialMpEdges = 0;
  let officialPeerEdges = 0;
  let selfMatchDrops = 0;
  let samenamePeerDrops = 0;

  for (const [slug, uicMap] of officialUics) {
    const entry = links.byOfficial[slug];
    const officialNameNorm = nameNormBySlug.get(slug) ?? "";
    const mpAgg = new Map<
      number,
      {
        mpName: string;
        companies: Map<string, OfficialBridgeCompany>;
        anyHigh: boolean;
      }
    >();
    const peerAgg = new Map<
      string,
      { companies: Map<string, OfficialBridgeCompany>; anyHigh: boolean }
    >();

    for (const [uic, info] of uicMap) {
      const company: OfficialBridgeCompany = {
        uic,
        companyName: info.companyName,
      };

      for (const mp of mpByUic.get(uic) ?? []) {
        // Same normalised name ⇒ almost certainly the same person (an official
        // who is also a sitting MP) — an identity, not a connection.
        if (officialNameNorm && mp.mpNameNorm === officialNameNorm) {
          selfMatchDrops++;
          continue;
        }
        let agg = mpAgg.get(mp.mpId);
        if (!agg) {
          agg = { mpName: mp.mpName, companies: new Map(), anyHigh: false };
          mpAgg.set(mp.mpId, agg);
        }
        agg.companies.set(uic, company);
        if (info.confidence === "high") agg.anyHigh = true;
      }

      const peers = officialsByUic.get(uic) ?? [];
      if (peers.length <= PEER_FANOUT_LIMIT) {
        for (const otherSlug of peers) {
          if (otherSlug === slug) continue;
          // Same normalised name ⇒ the two officials matched this company by
          // the identical name — namesake noise, not a real shared company.
          if (
            officialNameNorm &&
            nameNormBySlug.get(otherSlug) === officialNameNorm
          ) {
            samenamePeerDrops++;
            continue;
          }
          let agg = peerAgg.get(otherSlug);
          if (!agg) {
            agg = { companies: new Map(), anyHigh: false };
            peerAgg.set(otherSlug, agg);
          }
          agg.companies.set(uic, company);
          if (info.confidence === "high") agg.anyHigh = true;
        }
      }
    }

    const mpConnections: OfficialMpConnection[] = [...mpAgg.entries()]
      .map(([mpId, a]) => ({
        mpId,
        mpName: a.mpName,
        sharedCompanies: [...a.companies.values()],
        confidence: (a.anyHigh ? "high" : "low") as "high" | "low",
      }))
      .sort(
        (x, y) =>
          y.sharedCompanies.length - x.sharedCompanies.length ||
          x.mpName.localeCompare(y.mpName, "bg"),
      );

    const peerConnections: OfficialPeerConnection[] = [...peerAgg.entries()]
      .map(([otherSlug, a]) => {
        const other = links.byOfficial[otherSlug];
        return {
          slug: otherSlug,
          name: other.name,
          tier: other.tier,
          role: other.role,
          sharedCompanies: [...a.companies.values()],
          confidence: (a.anyHigh ? "high" : "low") as "high" | "low",
        };
      })
      .sort(
        (x, y) =>
          y.sharedCompanies.length - x.sharedCompanies.length ||
          x.name.localeCompare(y.name, "bg"),
      );

    if (mpConnections.length === 0 && peerConnections.length === 0) continue;
    officialMpEdges += mpConnections.length;
    officialPeerEdges += peerConnections.length;
    byOfficial[slug] = {
      slug,
      name: entry.name,
      tier: entry.tier,
      role: entry.role,
      municipality: entry.municipality,
      mpConnections,
      peerConnections,
    };
  }

  const payload: OfficialConnectionsFile = {
    generatedAt: new Date().toISOString(),
    total: Object.keys(byOfficial).length,
    officialMpEdges,
    officialPeerEdges,
    byOfficial,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, stringify(payload) + "\n", "utf-8");

  console.log(
    `[officials-connections] ${payload.total} officials connected` +
      ` — ${officialMpEdges} official↔MP, ${officialPeerEdges} official↔official` +
      ` (dropped ${selfMatchDrops} self-match + ${samenamePeerDrops} same-name edges)` +
      ` → ${path.relative(ROOT, OUT)}`,
  );
};
