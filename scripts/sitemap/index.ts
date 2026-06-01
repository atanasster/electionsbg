import fs from "fs";
import path from "path";
import { ENGLISH_STATIC_PAGES, RouteDef, routeDefs } from "./route_defs";
import { fileURLToPath } from "url";
import { ElectionInfo, PartyInfo, SectionIndex } from "@/data/dataTypes";

type SettlementBundleEntry = { ekatte?: string };
type PollAgency = { id: string };
type ArticleMeta = { slug: string; updatedAt?: string; draft?: boolean };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectPath = path.resolve(__dirname, "../../");

const electionsFile = path.join(projectPath, "src/data/json/elections.json");
const elections: ElectionInfo[] = JSON.parse(
  fs.readFileSync(electionsFile, "utf-8"),
);
// Local-election cycles live in their own catalogue. Only regular `_mi` cycles
// get dashboard URLs (partials surface contextually, never as a cycle page).
const localElectionsFile = path.join(
  projectPath,
  "src/data/json/local_elections.json",
);
const regularLocalCycles: string[] = (
  JSON.parse(fs.readFileSync(localElectionsFile, "utf-8")) as {
    name: string;
    kind: string;
  }[]
)
  .filter((c) => c.kind === "regular")
  .map((c) => c.name);
// Use the same latest election as the prerender step to keep URL inventories
// in sync. Fall back to a stable older one if elections.json is empty.
const election = elections[0]?.name ?? "2024_10_27";

const homePage = "https://electionsbg.com";
const today = new Date().toISOString().slice(0, 10);
// Election-data URLs (sections, settlements, candidates, parties, reports,
// municipalities) only meaningfully change when a new election is added.
// Using `today` for their lastmod tells crawlers to re-fetch them every
// deploy even when the underlying data is unchanged — a waste of crawl
// budget given there are ~100k such URLs. Use the latest election date
// instead so lastmod stays stable between elections.
const latestElectionDate = election.replace(/_/g, "-");
// For election-data files, prefer the election date over the source-file
// mtime (which moves to today on every prod rebuild). Falls back to the
// file mtime / today for non-election sources.
const electionAwareMod = (file: string): string => {
  if (file.includes(`/${election}/`) || file.includes(`/data/${election}/`)) {
    return latestElectionDate;
  }
  return safeFileMod(file);
};

// Per-segment percent-encode so Cyrillic and spaces (e.g. candidate names)
// produce RFC 3986 compliant URLs. Leading slash is preserved.
const encodeUrlPath = (p: string): string => {
  const lead = p.startsWith("/") ? "/" : "";
  const body = p.replace(/^\//, "");
  return lead + body.split("/").map(encodeURIComponent).join("/");
};

// Google has long-since deprioritised <changefreq> and <priority>; lastmod
// alone is what crawlers act on. Emitting changefreq=monthly across ~130k
// election URLs (which are immutable post-certification) actively misled
// crawl-budget heuristics. Drop it.
const urlEntry = (url: string, lastmod: string): string => {
  const isHome = url === "index" || url === "/index";
  const loc = isHome ? `${homePage}/` : `${homePage}${encodeUrlPath(url)}`;
  return `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
};

const safeFileMod = (file: string): string => {
  try {
    const m = fs.statSync(file).mtime.toISOString().slice(0, 10);
    return m > today ? m : today;
  } catch {
    return today;
  }
};

const routeXML = (url: string, file: string): string =>
  urlEntry(url, electionAwareMod(path.resolve(projectPath, file)));

// Bucket assignment — keep each bucket under the per-file 50,000 URL cap and
// keyed by URL family so search engines refresh independent shards. Strips a
// leading /en/ prefix so EN mirrors land in the same bucket as their BG
// canonicals (and stay sharded by family rather than language).
const bucketFor = (urlPath: string): string => {
  const p = urlPath.replace(/^\/en\//, "/");
  if (p.startsWith("/section/")) return "sections";
  if (p.startsWith("/sections/")) return "sections";
  if (p.startsWith("/settlement/")) return "settlements";
  if (p.startsWith("/candidate/")) return "candidates";
  if (p.startsWith("/party/")) return "parties";
  if (p.startsWith("/municipality/")) return "regions";
  if (p.startsWith("/reports/")) return "reports";
  if (p.startsWith("/polls")) return "polls";
  if (p.startsWith("/votes")) return "votes";
  if (p.startsWith("/parliament/")) return "votes";
  if (p.startsWith("/elections/")) return "static";
  if (p.startsWith("/local/")) return "local";
  if (p.startsWith("/articles")) return "static";
  if (p.startsWith("/budget/ministry/")) return "budget";
  if (p.startsWith("/funds/")) return "funds";
  if (p === "/funds") return "funds";
  return "static";
};

const buckets = new Map<string, string[]>();
const pushUrl = (urlPath: string, lastmod: string) => {
  const b = bucketFor(urlPath);
  const arr = buckets.get(b) ?? [];
  arr.push(urlEntry(urlPath, lastmod));
  buckets.set(b, arr);
};
const pushXml = (urlPath: string, xml: string) => {
  const b = bucketFor(urlPath);
  const arr = buckets.get(b) ?? [];
  arr.push(xml);
  buckets.set(b, arr);
};

const expandWithSubTabs = (
  baseUrl: string,
  subTabs: string[] | undefined,
  lastmod: string,
) => {
  pushUrl(baseUrl, lastmod);
  if (!subTabs) return;
  for (const tab of subTabs) {
    pushUrl(`${baseUrl}/${tab}`, lastmod);
  }
};

const enumerateParties = (
  route: RouteDef,
  rootUrl: string,
  routes: string[],
) => {
  const partiesFileName = `${projectPath}/data/${election}/cik_parties.json`;
  const data = fs.readFileSync(partiesFileName, "utf-8");
  const parties: PartyInfo[] = JSON.parse(data);
  for (const party of parties) {
    expandWithSubTabs(
      `${rootUrl}/${routes[0]}${party.nickName}`,
      route.subTabs,
      latestElectionDate,
    );
  }
};

const enumerateSections = (
  route: RouteDef,
  rootUrl: string,
  routes: string[],
) => {
  const idxFile = `${projectPath}/data/${election}/sections_index.json`;
  const idx: SectionIndex[] = JSON.parse(fs.readFileSync(idxFile, "utf-8"));
  for (const { section } of idx) {
    expandWithSubTabs(
      `${rootUrl}/${routes[0]}${section}`,
      route.subTabs,
      latestElectionDate,
    );
  }
};

const enumerateEkatteFromBundles = (
  route: RouteDef,
  rootUrl: string,
  routes: string[],
) => {
  const byDir = `${projectPath}/data/${election}/settlements/by`;
  const seen = new Set<string>();
  for (const f of fs.readdirSync(byDir)) {
    if (!f.endsWith(".json")) continue;
    const bundle: SettlementBundleEntry[] = JSON.parse(
      fs.readFileSync(path.join(byDir, f), "utf-8"),
    );
    for (const s of bundle) {
      if (!s.ekatte || seen.has(s.ekatte)) continue;
      seen.add(s.ekatte);
      expandWithSubTabs(
        `${rootUrl}/${routes[0]}${s.ekatte}`,
        route.subTabs,
        latestElectionDate,
      );
    }
  }
};

// Governance view — region tier (/governance/region/:oblast). One URL per
// oblast from regions.json (excluding 32 / abroad). Mirrors the parliamentary
// oblast set so every region has a governance sibling. BG + EN — the region
// node is the only place-ladder tier with an /en mirror (the município and
// settlement place nodes stay BG-only).
const enumerateGovernanceRegions = (rootUrl: string, routes: string[]) => {
  const file = `${projectPath}/src/data/json/regions.json`;
  if (!fs.existsSync(file)) return;
  const regions: { oblast: string }[] = JSON.parse(
    fs.readFileSync(file, "utf-8"),
  );
  const lastmod = safeFileMod(file);
  for (const r of regions) {
    if (!r.oblast || r.oblast === "32") continue;
    pushUrl(`${rootUrl}/${routes[0]}${r.oblast}`, lastmod);
    pushUrl(`/en${rootUrl}/${routes[0]}${r.oblast}`, lastmod);
  }
};

// Governance view — município-grain place nodes (/governance/:obshtina). One
// URL per obshtina from municipalities.json (excluding abroad), plus the
// synthetic Sofia-city aggregate (SOF00) which is prerendered but not a row in
// municipalities.json. Settlement-grain place nodes are enumerated separately
// via the shared "settlements" token.
const enumerateGovernanceMunicipalities = (
  rootUrl: string,
  routes: string[],
) => {
  const file = `${projectPath}/data/municipalities.json`;
  if (!fs.existsSync(file)) return;
  const munis: { obshtina: string; oblast?: string }[] = JSON.parse(
    fs.readFileSync(file, "utf-8"),
  );
  const lastmod = safeFileMod(file);
  const seen = new Set<string>();
  for (const m of munis) {
    if (!m.obshtina || m.oblast === "32" || seen.has(m.obshtina)) continue;
    seen.add(m.obshtina);
    pushUrl(`${rootUrl}/${routes[0]}${m.obshtina}`, lastmod);
  }
  if (!seen.has("SOF00")) pushUrl(`${rootUrl}/${routes[0]}SOF00`, lastmod);
};

// Candidate name slugs — the SAME source the prerender uses
// (buildCandidateRoutes reads each election's candidates.json and keys by
// `.name`). Enumerating the candidate *directories* instead would over-list:
// some dirs exist with no candidates.json entry, so the sitemap would point at
// /candidate/<name> URLs that have no prerendered HTML (soft-duplicates).
const collectCandidateNames = (): Set<string> => {
  const dataDir = path.resolve(projectPath, "data");
  const names = new Set<string>();
  if (!fs.existsSync(dataDir)) return names;
  const electionDirs = fs
    .readdirSync(dataDir)
    .filter((d) => /^\d{4}_\d{2}_\d{2}$/.test(d));
  for (const ed of electionDirs) {
    const candFile = path.join(dataDir, ed, "candidates.json");
    if (!fs.existsSync(candFile)) continue;
    let cands: Array<{ name?: string }>;
    try {
      cands = JSON.parse(fs.readFileSync(candFile, "utf-8"));
    } catch {
      continue;
    }
    for (const c of cands) {
      if (c?.name) names.add(c.name);
    }
  }
  return names;
};

// /sections/{ekatte} — the prerender (buildSectionsListRoutes) emits a page
// only for EKATTE codes that actually appear in sections/by-oblast, NOT every
// settlement. Enumerating from the settlement bundles instead (as the shared
// "settlements" token does) over-lists ~1,100 settlements with zero sections +
// 33 diaspora codes → soft-duplicates. Mirror the prerender's source here.
const enumerateSectionsEkatte = (
  route: RouteDef,
  rootUrl: string,
  routes: string[],
) => {
  const byOblastDir = `${projectPath}/data/${election}/sections/by-oblast`;
  if (!fs.existsSync(byOblastDir)) return;
  const seen = new Set<string>();
  for (const f of fs.readdirSync(byOblastDir)) {
    if (!f.endsWith(".json")) continue;
    let data: Record<string, { ekatte?: string }>;
    try {
      data = JSON.parse(fs.readFileSync(path.join(byOblastDir, f), "utf-8"));
    } catch {
      continue;
    }
    for (const sec of Object.values(data)) {
      if (!sec.ekatte || seen.has(sec.ekatte)) continue;
      seen.add(sec.ekatte);
      expandWithSubTabs(
        `${rootUrl}/${routes[0]}${sec.ekatte}`,
        route.subTabs,
        latestElectionDate,
      );
    }
  }
};

const enumerateCandidates = (
  route: RouteDef,
  rootUrl: string,
  routes: string[],
) => {
  for (const name of collectCandidateNames()) {
    expandWithSubTabs(
      `${rootUrl}/${routes[0]}${name}`,
      route.subTabs,
      latestElectionDate,
    );
  }
};

const enumerateBudgetMinistries = (
  route: RouteDef,
  rootUrl: string,
  routes: string[],
) => {
  const dir = `${projectPath}/data/budget/ministries`;
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const idxFile = `${projectPath}/data/budget/index.json`;
  const lastmod = fs.existsSync(idxFile) ? safeFileMod(idxFile) : today;
  for (const f of files) {
    const slug = f.replace(/\.json$/, "");
    pushUrl(`${rootUrl}/${routes[0]}${slug}`, lastmod);
    pushUrl(`/en${rootUrl}/${routes[0]}${slug}`, lastmod);
    void route; // route currently has no sub-tabs; reserved for symmetry.
  }
};

// Local-elections dashboard URLs. Cycles from local_elections.json; regions +
// municipalities from each cycle's data files. BG + EN mirror each (the SPA
// serves /en via the Firebase /en/** rewrite). Region "SOF" is skipped — it
// redirects to the Sofia município page.
const enumerateLocalCycles = (rootUrl: string, routes: string[]) => {
  for (const cycle of regularLocalCycles) {
    const idxFile = `${projectPath}/data/${cycle}/index.json`;
    if (!fs.existsSync(idxFile)) continue;
    const lastmod = safeFileMod(idxFile);
    pushUrl(`${rootUrl}/${routes[0]}${cycle}`, lastmod);
    pushUrl(`${rootUrl}/en/${routes[0]}${cycle}`, lastmod);
  }
};

const enumerateLocalRegions = (rootUrl: string, routes: string[]) => {
  for (const cycle of regularLocalCycles) {
    const rsFile = `${projectPath}/data/${cycle}/regions_summary.json`;
    if (!fs.existsSync(rsFile)) continue;
    const lastmod = safeFileMod(rsFile);
    let regions: { oblast: string }[];
    try {
      regions = JSON.parse(fs.readFileSync(rsFile, "utf-8")).regions ?? [];
    } catch {
      continue;
    }
    for (const r of regions) {
      if (r.oblast === "SOF") continue;
      pushUrl(
        `${rootUrl}/${routes[0]}${cycle}${routes[1]}${r.oblast}`,
        lastmod,
      );
      pushUrl(
        `${rootUrl}/en/${routes[0]}${cycle}${routes[1]}${r.oblast}`,
        lastmod,
      );
    }
  }
};

const enumerateLocalMunicipalities = (rootUrl: string, routes: string[]) => {
  for (const cycle of regularLocalCycles) {
    const idxFile = `${projectPath}/data/${cycle}/index.json`;
    if (!fs.existsSync(idxFile)) continue;
    const lastmod = safeFileMod(idxFile);
    let municipalities: { obshtinaCode: string }[];
    try {
      municipalities =
        JSON.parse(fs.readFileSync(idxFile, "utf-8")).municipalities ?? [];
    } catch {
      continue;
    }
    for (const m of municipalities) {
      pushUrl(
        `${rootUrl}/${routes[0]}${cycle}${routes[1]}${m.obshtinaCode}`,
        lastmod,
      );
      pushUrl(
        `${rootUrl}/en/${routes[0]}${cycle}${routes[1]}${m.obshtinaCode}`,
        lastmod,
      );
    }
  }
};

// Per-official profile page URLs (cabinet, agency heads, regional governors).
// One per file under data/officials/declarations/{slug}.json; the slug is the
// SPA route parameter. The rankings file's mtime is the canonical "lastmod"
// for the whole set since the per-official files are regenerated together.
const enumerateOfficials = (
  route: RouteDef,
  rootUrl: string,
  routes: string[],
) => {
  const dir = `${projectPath}/data/officials/declarations`;
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const rankingsFile = `${projectPath}/data/officials/assets-rankings.json`;
  const lastmod = fs.existsSync(rankingsFile)
    ? safeFileMod(rankingsFile)
    : today;
  for (const f of files) {
    const slug = f.replace(/\.json$/, "");
    pushUrl(`${rootUrl}/${routes[0]}${slug}`, lastmod);
    pushUrl(`/en${rootUrl}/${routes[0]}${slug}`, lastmod);
    void route;
  }
};

// Per-cabinet detail pages — one URL per cabinet in data/governments.json.
// The prerender step (scripts/prerender/routes.ts) ships indexable HTML for
// each /governments/<id> and /en/governments/<id>; this enumerator just
// makes sure those URLs are in sitemap.xml so crawlers don't have to
// discover them via internal links alone.
const enumerateCabinets = (
  _route: RouteDef,
  rootUrl: string,
  routes: string[],
) => {
  const file = `${projectPath}/data/governments.json`;
  if (!fs.existsSync(file)) return;
  let payload: { governments?: Array<{ id: string }> };
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return;
  }
  const cabinets = payload.governments ?? [];
  const lastmod = safeFileMod(file);
  for (const c of cabinets) {
    if (!c.id) continue;
    pushUrl(`${rootUrl}/${routes[0]}${c.id}`, lastmod);
    pushUrl(`/en${rootUrl}/${routes[0]}${c.id}`, lastmod);
  }
};

// /funds/focus/{slug} — one URL per editorial theme listed in
// data/funds/themes.json. The shard build re-runs on every funds ingest, so
// the file's mtime is a reasonable lastmod for the whole set. Themes with
// zero matches are skipped (see FundsFocusTile.tsx — it also hides them).
const enumerateFundsThemes = (rootUrl: string, routes: string[]) => {
  const file = `${projectPath}/data/funds/themes.json`;
  if (!fs.existsSync(file)) return;
  let payload: {
    themes?: Array<{ slug: string; contractCount?: number }>;
  };
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return;
  }
  const themes = payload.themes ?? [];
  const lastmod = safeFileMod(file);
  for (const th of themes) {
    if (!th.slug) continue;
    if (typeof th.contractCount === "number" && th.contractCount === 0)
      continue;
    pushUrl(`${rootUrl}/${routes[0]}${th.slug}`, lastmod);
    pushUrl(`/en${rootUrl}/${routes[0]}${th.slug}`, lastmod);
  }
};

// /funds/programme/{code} — one URL per operational programme that has its
// own summary shard under data/funds/projects/by-program. Each shard's
// mtime is the lastmod for that programme's URL.
const enumerateFundsProgrammes = (rootUrl: string, routes: string[]) => {
  const dir = `${projectPath}/data/funds/projects/by-program`;
  if (!fs.existsSync(dir)) return;
  const summaries = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith("-summary.json"));
  for (const f of summaries) {
    const code = f.replace(/-summary\.json$/, "");
    const lastmod = safeFileMod(path.join(dir, f));
    pushUrl(`${rootUrl}/${routes[0]}${code}`, lastmod);
    pushUrl(`/en${rootUrl}/${routes[0]}${code}`, lastmod);
  }
};

const enumerateProcurementSettlements = (rootUrl: string, routes: string[]) => {
  // One URL per settlement that has at least one local-tier contract on
  // file. Read from by_settlement/index.json which is freshest after every
  // procurement ingest. Skip the synthetic _national.json sibling — that
  // surfaces as a card on the landing, not a standalone page.
  const idxFile = `${projectPath}/data/procurement/by_settlement/index.json`;
  if (!fs.existsSync(idxFile)) return;
  let idx: { settlements?: Array<{ ekatte: string }> };
  try {
    idx = JSON.parse(fs.readFileSync(idxFile, "utf-8"));
  } catch {
    return;
  }
  const lastmod = safeFileMod(idxFile);
  for (const s of idx.settlements ?? []) {
    pushUrl(`${rootUrl}/${routes[0]}${s.ekatte}`, lastmod);
  }
};

const enumerateElections = (rootUrl: string, routes: string[]) => {
  // electionsFile is loaded at module init.
  const lastmod = safeFileMod(electionsFile);
  for (const e of elections) {
    if (!/^\d{4}_\d{2}_\d{2}$/.test(e.name)) continue;
    pushUrl(`${rootUrl}/${routes[0]}${e.name}`, lastmod);
  }
};

const enumerateVotes = (rootUrl: string) => {
  // Roll-call sessions: one URL per voting day. Skip if the index file
  // hasn't been generated yet (fresh clone before any ingest).
  const idxFile = `${projectPath}/data/parliament/votes/index.json`;
  if (!fs.existsSync(idxFile)) return;
  let idx: { sessions?: Array<{ date: string }>; lastDate?: string };
  try {
    idx = JSON.parse(fs.readFileSync(idxFile, "utf-8"));
  } catch {
    return;
  }
  const sessions = idx.sessions ?? [];
  // Use index.json's mtime (refreshed on every ingest) so crawlers learn
  // about new sessions without scanning per-session files.
  const lastmod = safeFileMod(idxFile);
  pushUrl(`${rootUrl}/votes`, lastmod);
  pushUrl(`${rootUrl}/en/votes`, lastmod);
  for (const s of sessions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) continue;
    pushUrl(`${rootUrl}/votes/${s.date}`, s.date);
    pushUrl(`${rootUrl}/en/votes/${s.date}`, s.date);
  }
};

const enumeratePolls = (route: RouteDef, rootUrl: string) => {
  const indexUrl = `${rootUrl}/${route.path}`;
  pushUrl(indexUrl, today);
  const agenciesFile = `${projectPath}/data/polls/agencies.json`;
  if (!fs.existsSync(agenciesFile)) return;
  const agencies: PollAgency[] = JSON.parse(
    fs.readFileSync(agenciesFile, "utf-8"),
  );
  const lastmod = safeFileMod(agenciesFile);
  for (const a of agencies) {
    pushUrl(`${indexUrl}/${a.id}`, lastmod);
  }
};

const articlesFile = `${projectPath}/public/articles/index.json`;
const enumerateArticlesIndex = (rootUrl: string) => {
  // Index page itself — falls back to today if the file is missing so the
  // /articles landing route is still emitted even before any articles ship.
  const lastmod = fs.existsSync(articlesFile)
    ? safeFileMod(articlesFile)
    : today;
  pushUrl(`${rootUrl}/articles`, lastmod);
  // English mirror of the index page.
  pushUrl(`${rootUrl}/en/articles`, lastmod);
};
// Pick the most recent of: per-language markdown mtime, the article's
// `updatedAt` field (if present in index.json), and the article's
// publishedAt. Returned as YYYY-MM-DD.
const articleLastmod = (
  slug: string,
  publishedAt: string | undefined,
  updatedAt: string | undefined,
): string => {
  const candidates: string[] = [];
  for (const lang of ["bg", "en"]) {
    const f = `${projectPath}/public/articles/${slug}-${lang}.md`;
    if (fs.existsSync(f)) {
      candidates.push(fs.statSync(f).mtime.toISOString().slice(0, 10));
    }
  }
  if (updatedAt) candidates.push(updatedAt.slice(0, 10));
  if (publishedAt) candidates.push(publishedAt.slice(0, 10));
  if (!candidates.length) return today;
  return candidates.sort().pop() ?? today;
};
const enumerateArticles = (rootUrl: string, routes: string[]) => {
  if (!fs.existsSync(articlesFile)) return;
  const articles: Array<ArticleMeta & { publishedAt?: string }> = JSON.parse(
    fs.readFileSync(articlesFile, "utf-8"),
  );
  for (const a of articles) {
    if (!a.slug) continue;
    // Drafts never reach the sitemap — they only render on the Vite dev
    // server (see useArticles.ts). Stops Google from discovering them
    // even if a maintainer accidentally publishes the static build.
    if (a.draft) continue;
    const lastmod = articleLastmod(a.slug, a.publishedAt, a.updatedAt);
    // BG (default) URL — emitted under the existing `articles` bucket.
    pushUrl(`${rootUrl}/${routes[0]}${a.slug}`, lastmod);
    // EN mirror — Google needs `/en/articles/{slug}` enumerated to discover
    // the prerendered EN HTML that articleRoutes.ts already emits.
    pushUrl(`${rootUrl}/en/${routes[0]}${a.slug}`, lastmod);
  }
};

const getRoute = (route: RouteDef, rootUrl: string) => {
  if (route.children) {
    for (const r of route.children) getRoute(r, `${rootUrl}/${route.path}`);
    return;
  }
  const routes = route.path.split(":id");
  if (routes.length > 1) {
    if (route.file === "parties")
      return enumerateParties(route, rootUrl, routes);
    if (route.file === "sections-index")
      return enumerateSections(route, rootUrl, routes);
    if (route.file === "sections-by-ekatte")
      return enumerateSectionsEkatte(route, rootUrl, routes);
    if (route.file === "settlements")
      return enumerateEkatteFromBundles(route, rootUrl, routes);
    if (route.file === "governance-regions")
      return enumerateGovernanceRegions(rootUrl, routes);
    if (route.file === "governance-municipalities")
      return enumerateGovernanceMunicipalities(rootUrl, routes);
    if (route.file === "candidates")
      return enumerateCandidates(route, rootUrl, routes);
    if (route.file === "elections-list")
      return enumerateElections(rootUrl, routes);
    if (route.file === "local-cycles")
      return enumerateLocalCycles(rootUrl, routes);
    if (route.file === "local-regions")
      return enumerateLocalRegions(rootUrl, routes);
    if (route.file === "local-municipalities")
      return enumerateLocalMunicipalities(rootUrl, routes);
    if (route.file === "articles-list")
      return enumerateArticles(rootUrl, routes);
    if (route.file === "budget-ministries-list")
      return enumerateBudgetMinistries(route, rootUrl, routes);
    if (route.file === "officials-list")
      return enumerateOfficials(route, rootUrl, routes);
    if (route.file === "cabinets-list")
      return enumerateCabinets(route, rootUrl, routes);
    if (route.file === "funds-themes-list")
      return enumerateFundsThemes(rootUrl, routes);
    if (route.file === "funds-programmes-list")
      return enumerateFundsProgrammes(rootUrl, routes);
    if (route.file === "procurement-settlements-list")
      return enumerateProcurementSettlements(rootUrl, routes);
    // Generic ":id" expansion against a folder of files (e.g. municipalities/by/{id}).
    const folders = route.file?.split(":id");
    if (!folders) throw new Error("Must assign file property: " + route.path);
    const folder = path.resolve(projectPath, folders[0]);
    const files = fs.readdirSync(folder).filter((f) => !f.startsWith("."));
    if (routes[1] === "") {
      for (const f of files) {
        const fileName = path.resolve(folder, f);
        const fileParts = f.split(".");
        const p = routes.join(fileParts[0]);
        const baseUrl = `${rootUrl}/${p}`;
        const lastmod = electionAwareMod(fileName);
        // Oblast 32 (abroad) renders as the diaspora landing (buildDiasporaRoutes)
        // which has NO sub-tabs, so /municipality/32/{parties,recount,…} are not
        // prerendered. Emit the base URL only for it.
        const subTabs = fileParts[0] === "32" ? undefined : route.subTabs;
        expandWithSubTabs(baseUrl, subTabs, lastmod);
      }
    }
    return;
  }
  // Static path.
  if (route.file === "polls-index") return enumeratePolls(route, rootUrl);
  if (route.file === "articles-index") return enumerateArticlesIndex(rootUrl);
  if (route.file === "english-static-pages") {
    for (const slug of ENGLISH_STATIC_PAGES) {
      const enPath = slug ? `/en/${slug}` : `/en`;
      pushUrl(`${rootUrl}${enPath}`, today);
    }
    return;
  }
  if (!route.file) throw new Error("Missing file name: " + route.path);
  // Skip silently if a referenced report file doesn't exist (some reports
  // aren't generated for every election).
  const fileExists = fs.existsSync(path.resolve(projectPath, route.file));
  if (!fileExists) return;
  pushXml(
    `${rootUrl}/${route.path}`,
    routeXML(`${rootUrl}/${route.path}`, route.file),
  );
};

routeDefs(election).forEach((r) => getRoute(r, ""));
enumerateVotes("");

// English mirrors for dynamic party routes — every BG /party/X URL also has
// an EN counterpart at /en/party/X (with the same sub-tabs). Mirrors are
// generated by the prerender step in scripts/prerender/dynamicRoutes.ts.
const enumerateEnglishParties = () => {
  const partiesFileName = `${projectPath}/data/${election}/cik_parties.json`;
  if (!fs.existsSync(partiesFileName)) return;
  const data = fs.readFileSync(partiesFileName, "utf-8");
  const parties: PartyInfo[] = JSON.parse(data);
  const lastmod = safeFileMod(partiesFileName);
  const partySubTabs = [
    "regions",
    "municipalities",
    "settlements",
    "preferences",
    "donors",
    "donors/list",
    "income",
    "expenses",
  ];
  for (const party of parties) {
    expandWithSubTabs(`/en/party/${party.nickName}`, partySubTabs, lastmod);
  }
};
enumerateEnglishParties();

// English mirrors for dynamic candidate routes. Candidates retain their BG
// name as the canonical URL slug (the same encoding used in
// /candidate/{name}); the EN variant just adds the /en/ prefix and gets a
// localized title/description from prerender. Hreflang ties them together.
const enumerateEnglishCandidates = () => {
  for (const name of collectCandidateNames()) {
    pushUrl(`/en/candidate/${name}`, latestElectionDate);
  }
};
enumerateEnglishCandidates();

const xmlHeader = `<?xml version="1.0" encoding="UTF-8"?>`;
const urlsetOpen = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
const urlsetClose = `</urlset>`;

// 50,000 URLs is the per-file Sitemap protocol limit.
const SHARD_LIMIT = 49000;

// Remove any previous shard files so a smaller next run doesn't leave stale
// data behind under sitemap_*_N.xml.
for (const f of fs.readdirSync(`${projectPath}/public`)) {
  if (/^sitemap_/.test(f) && f.endsWith(".xml")) {
    fs.rmSync(`${projectPath}/public/${f}`);
  }
}

const writtenFiles: Array<{ name: string; lastmod: string }> = [];
for (const [bucket, urls] of buckets.entries()) {
  // Shard within a bucket if needed.
  for (let i = 0, shard = 0; i < urls.length; i += SHARD_LIMIT, shard++) {
    const slice = urls.slice(i, i + SHARD_LIMIT);
    const suffix = shard === 0 ? "" : `_${shard + 1}`;
    const fileName = `sitemap_${bucket}${suffix}.xml`;
    const xml = `${xmlHeader}${urlsetOpen}\r\n${slice.join("\r\n")}\r\n${urlsetClose}`;
    fs.writeFileSync(`${projectPath}/public/${fileName}`, xml, "utf-8");
    writtenFiles.push({ name: fileName, lastmod: today });
  }
}

const indexBody = writtenFiles
  .map(
    (f) =>
      `<sitemap><loc>${homePage}/${f.name}</loc><lastmod>${f.lastmod}</lastmod></sitemap>`,
  )
  .join("\r\n");
const indexXml = `${xmlHeader}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\r\n${indexBody}\r\n</sitemapindex>`;
fs.writeFileSync(`${projectPath}/public/sitemap_index.xml`, indexXml, "utf-8");

// Back-compat: keep /sitemap.xml as a thin pointer to the index. Some crawlers
// (and the old robots.txt) still expect this canonical name. We write the same
// sitemap_index content here so a request to /sitemap.xml works without a
// redirect (Firebase Hosting can't redirect dynamically without rules).
fs.writeFileSync(`${projectPath}/public/sitemap.xml`, indexXml, "utf-8");

const totalUrls = Array.from(buckets.values()).reduce(
  (s, a) => s + a.length,
  0,
);
console.log(
  `sitemap: ${totalUrls} URLs across ${writtenFiles.length} sitemap files (election ${election})`,
);
