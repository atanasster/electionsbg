// Officials → company cross-reference.
//
// Additive, standalone artifact: links executive + municipal officials to
// companies, two ways —
//   1. declared — the official's own ownership-stake declarations (Table 10/11
//      of the property/interest declaration). High confidence on the person;
//      the company is identified by free-text name, so a UIC is attached only
//      when that name resolves to exactly one Commerce Registry entity.
//   2. tr — a Commerce Registry (TR) officer/owner record whose person name
//      matches the official's. UIC is exact; confidence depends on whether the
//      official's normalised name is unique among all officials (Bulgarian
//      namesakes are common — a shared name means the match is ambiguous).
//
// Output: data/officials/derived/company_links.json. This does NOT touch the
// MP connections graph builder — it is a stepping stone toward folding
// officials into that graph.

import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type {
  MunicipalIndexFile,
  OfficialCompanyLink,
  OfficialCompanyLinksEntry,
  OfficialCompanyLinksFile,
  OfficialDeclaration,
  OfficialIndexFile,
} from "../../src/data/dataTypes";
import { ROOT, normalize } from "../officials/shared";

const OFFICIALS_DIR = path.join(ROOT, "data", "officials");
const SQLITE = path.join(ROOT, "raw_data", "tr", "state.sqlite");
const OUT = path.join(OFFICIALS_DIR, "derived", "company_links.json");

// Bulgarian legal-form tokens stripped when normalising a company name for the
// declared-stake → UIC resolution.
const LEGAL_FORM_RE = /(?:^|\s)(ЕООД|ЕАД|ООД|АД|КДА|КД|СД|ДЗЗД|ЕТ)(?=\s|$)/gu;

const normCompany = (s: string): string =>
  s
    .toUpperCase()
    .replace(/["„“”»«'`]/g, " ")
    .replace(LEGAL_FORM_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

type RosterEntry = {
  slug: string;
  name: string;
  normalizedName: string;
  tier: "executive" | "municipal";
  role: string;
  municipality: string | null;
  declFile: string;
};

// Combine the executive (data/officials/index.json) and municipal
// (data/officials/municipal/index.json) rosters into one list.
const loadRoster = (): RosterEntry[] => {
  const out: RosterEntry[] = [];
  const execPath = path.join(OFFICIALS_DIR, "index.json");
  if (fs.existsSync(execPath)) {
    const idx: OfficialIndexFile = JSON.parse(
      fs.readFileSync(execPath, "utf-8"),
    );
    for (const e of idx.entries) {
      out.push({
        slug: e.slug,
        name: e.name,
        normalizedName: e.normalizedName,
        tier: "executive",
        role: e.category,
        municipality: null,
        declFile: path.join(OFFICIALS_DIR, "declarations", `${e.slug}.json`),
      });
    }
  }
  const muniPath = path.join(OFFICIALS_DIR, "municipal", "index.json");
  if (fs.existsSync(muniPath)) {
    const idx: MunicipalIndexFile = JSON.parse(
      fs.readFileSync(muniPath, "utf-8"),
    );
    for (const e of idx.entries) {
      out.push({
        slug: e.slug,
        name: e.name,
        normalizedName: e.normalizedName,
        tier: "municipal",
        role: e.role,
        municipality: e.municipality,
        declFile: path.join(
          OFFICIALS_DIR,
          "municipal",
          "declarations",
          `${e.slug}.json`,
        ),
      });
    }
  }
  return out;
};

type TrRecord = { uic: string; role: string; share: number | null };

export const buildOfficialsCompanyLinks = ({
  stringify,
}: {
  stringify: (o: unknown) => string;
}): void => {
  const roster = loadRoster();
  if (roster.length === 0) {
    console.log(
      "[officials-links] no officials roster found — run /update-officials first; skipping",
    );
    return;
  }

  // Namesake counts across the combined roster — drives TR-match confidence.
  const namesakeCount = new Map<string, number>();
  for (const r of roster) {
    namesakeCount.set(
      r.normalizedName,
      (namesakeCount.get(r.normalizedName) ?? 0) + 1,
    );
  }

  // TR lookups — built only when the Commerce Registry SQLite is present.
  const trByName = new Map<string, TrRecord[]>();
  const companyNameByUic = new Map<string, string>();
  const uicByCompanyName = new Map<string, Set<string>>();
  let trAvailable = false;

  if (fs.existsSync(SQLITE)) {
    trAvailable = true;
    const db = new DatabaseSync(SQLITE, { readOnly: true });
    db.exec("PRAGMA query_only = ON; PRAGMA cache_size = -64000;");

    for (const row of db
      .prepare(`SELECT uic, name FROM companies`)
      .all() as Array<{ uic: string; name: string | null }>) {
      if (row.name) {
        companyNameByUic.set(row.uic, row.name);
        const key = normCompany(row.name);
        if (key) {
          const set = uicByCompanyName.get(key) ?? new Set<string>();
          set.add(row.uic);
          uicByCompanyName.set(key, set);
        }
      }
    }

    // Current officer/owner records only (erased_at IS NULL) — mirrors the
    // connections-graph TR expansion. Names are re-normalised here with the
    // same `normalize()` the officials roster uses, so the join is consistent
    // regardless of the TR ingest's own name_norm scheme.
    for (const row of db
      .prepare(
        `SELECT uic, role, name, share_percent
           FROM company_persons
          WHERE erased_at IS NULL`,
      )
      .all() as Array<{
      uic: string;
      role: string;
      name: string;
      share_percent: number | null;
    }>) {
      if (!row.name) continue;
      const key = normalize(row.name);
      const arr = trByName.get(key) ?? [];
      arr.push({ uic: row.uic, role: row.role, share: row.share_percent });
      trByName.set(key, arr);
    }
    db.close();
  } else {
    console.log(
      `[officials-links] no TR SQLite at ${SQLITE} — declared links only`,
    );
  }

  const byOfficial: Record<string, OfficialCompanyLinksEntry> = {};
  let total = 0;
  let declaredLinks = 0;
  let trLinks = 0;
  let lowConfidenceLinks = 0;

  for (const r of roster) {
    const links: OfficialCompanyLink[] = [];
    const nCount = namesakeCount.get(r.normalizedName) ?? 1;

    // 1. Declared ownership stakes — from the latest declaration on file.
    if (fs.existsSync(r.declFile)) {
      const decls: OfficialDeclaration[] = JSON.parse(
        fs.readFileSync(r.declFile, "utf-8"),
      );
      const latest = decls[0];
      for (const stake of latest?.ownershipStakes ?? []) {
        let uic: string | null = null;
        if (stake.companyName) {
          const matches = uicByCompanyName.get(normCompany(stake.companyName));
          if (matches && matches.size === 1) uic = [...matches][0];
        }
        links.push({
          uic,
          companyName: stake.companyName,
          source: "declared",
          trRole: null,
          shareSize: stake.shareSize,
          valueEur: stake.valueEur,
          confidence: "high",
          nameNorm: r.normalizedName,
          namesakeCount: nCount,
        });
        declaredLinks++;
      }
    }

    // 2. TR officer/owner records matched by normalised name.
    for (const rec of trByName.get(r.normalizedName) ?? []) {
      links.push({
        uic: rec.uic,
        companyName: companyNameByUic.get(rec.uic) ?? null,
        source: "tr",
        trRole: rec.role,
        shareSize: rec.share != null ? String(rec.share) : null,
        valueEur: null,
        confidence: nCount === 1 ? "high" : "low",
        nameNorm: r.normalizedName,
        namesakeCount: nCount,
      });
      trLinks++;
      if (nCount > 1) lowConfidenceLinks++;
    }

    if (links.length === 0) continue;
    total += links.length;
    byOfficial[r.slug] = {
      slug: r.slug,
      name: r.name,
      tier: r.tier,
      role: r.role,
      municipality: r.municipality,
      links,
    };
  }

  const payload: OfficialCompanyLinksFile = {
    generatedAt: new Date().toISOString(),
    total,
    officialsWithLinks: Object.keys(byOfficial).length,
    declaredLinks,
    trLinks,
    lowConfidenceLinks,
    byOfficial,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, stringify(payload) + "\n", "utf-8");

  console.log(
    `[officials-links] ${total} link(s) for ${payload.officialsWithLinks}/${roster.length} officials` +
      ` — ${declaredLinks} declared, ${trLinks} TR` +
      `${trAvailable ? "" : " (TR skipped)"}` +
      `, ${lowConfidenceLinks} low-confidence (namesake) → ${path.relative(ROOT, OUT)}`,
  );
};
