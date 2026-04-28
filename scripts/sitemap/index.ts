import fs from "fs";
import path from "path";
import { ENGLISH_STATIC_PAGES, RouteDef, routeDefs } from "./route_defs";
import { fileURLToPath } from "url";
import { ElectionInfo, PartyInfo, SectionIndex } from "@/data/dataTypes";

type SettlementBundleEntry = { ekatte?: string };
type PollAgency = { id: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectPath = path.resolve(__dirname, "../../");

const electionsFile = path.join(projectPath, "src/data/json/elections.json");
const elections: ElectionInfo[] = JSON.parse(
  fs.readFileSync(electionsFile, "utf-8"),
);
// Use the same latest election as the prerender step to keep URL inventories
// in sync. Fall back to a stable older one if elections.json is empty.
const election = elections[0]?.name ?? "2024_10_27";

const homePage = "https://electionsbg.com";
const today = new Date().toISOString().slice(0, 10);

// Per-segment percent-encode so Cyrillic and spaces (e.g. candidate names)
// produce RFC 3986 compliant URLs. Leading slash is preserved.
const encodeUrlPath = (p: string): string => {
  const lead = p.startsWith("/") ? "/" : "";
  const body = p.replace(/^\//, "");
  return lead + body.split("/").map(encodeURIComponent).join("/");
};

const urlEntry = (url: string, lastmod: string): string => {
  const isHome = url === "index" || url === "/index";
  const loc = isHome ? `${homePage}/` : `${homePage}${encodeUrlPath(url)}`;
  return `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq></url>`;
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
  urlEntry(url, safeFileMod(path.resolve(projectPath, file)));

// Bucket assignment — keep each bucket under the per-file 50,000 URL cap and
// keyed by URL family so search engines refresh independent shards.
const bucketFor = (urlPath: string): string => {
  if (urlPath.startsWith("/section/")) return "sections";
  if (urlPath.startsWith("/sections/")) return "sections";
  if (urlPath.startsWith("/settlement/")) return "settlements";
  if (urlPath.startsWith("/candidate/")) return "candidates";
  if (urlPath.startsWith("/party/")) return "parties";
  if (urlPath.startsWith("/municipality/")) return "regions";
  if (urlPath.startsWith("/reports/")) return "reports";
  if (urlPath.startsWith("/polls")) return "polls";
  if (urlPath.startsWith("/elections/")) return "static";
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
  const partiesFileName = `${projectPath}/public/${election}/cik_parties.json`;
  const data = fs.readFileSync(partiesFileName, "utf-8");
  const parties: PartyInfo[] = JSON.parse(data);
  const lastmod = safeFileMod(partiesFileName);
  for (const party of parties) {
    expandWithSubTabs(
      `${rootUrl}/${routes[0]}${party.nickName}`,
      route.subTabs,
      lastmod,
    );
  }
};

const enumerateSections = (
  route: RouteDef,
  rootUrl: string,
  routes: string[],
) => {
  const idxFile = `${projectPath}/public/${election}/sections_index.json`;
  const idx: SectionIndex[] = JSON.parse(fs.readFileSync(idxFile, "utf-8"));
  const lastmod = safeFileMod(idxFile);
  for (const { section } of idx) {
    expandWithSubTabs(
      `${rootUrl}/${routes[0]}${section}`,
      route.subTabs,
      lastmod,
    );
  }
};

const enumerateEkatteFromBundles = (
  route: RouteDef,
  rootUrl: string,
  routes: string[],
) => {
  const byDir = `${projectPath}/public/${election}/settlements/by`;
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
        today,
      );
    }
  }
};

const enumerateCandidates = (
  route: RouteDef,
  rootUrl: string,
  routes: string[],
) => {
  const publicDir = path.resolve(projectPath, "public");
  const electionDirs = fs
    .readdirSync(publicDir)
    .filter((d) => /^\d{4}_\d{2}_\d{2}$/.test(d));
  const names = new Set<string>();
  for (const ed of electionDirs) {
    const candDir = path.join(publicDir, ed, "candidates");
    if (!fs.existsSync(candDir)) continue;
    for (const n of fs.readdirSync(candDir)) {
      if (n.startsWith(".")) continue;
      names.add(n);
    }
  }
  for (const name of names) {
    expandWithSubTabs(`${rootUrl}/${routes[0]}${name}`, route.subTabs, today);
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

const enumeratePolls = (route: RouteDef, rootUrl: string) => {
  const indexUrl = `${rootUrl}/${route.path}`;
  pushUrl(indexUrl, today);
  const agenciesFile = `${projectPath}/public/polls/agencies.json`;
  if (!fs.existsSync(agenciesFile)) return;
  const agencies: PollAgency[] = JSON.parse(
    fs.readFileSync(agenciesFile, "utf-8"),
  );
  const lastmod = safeFileMod(agenciesFile);
  for (const a of agencies) {
    pushUrl(`${indexUrl}/${a.id}`, lastmod);
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
    if (route.file === "sections-by-ekatte" || route.file === "settlements")
      return enumerateEkatteFromBundles(route, rootUrl, routes);
    if (route.file === "candidates")
      return enumerateCandidates(route, rootUrl, routes);
    if (route.file === "elections-list")
      return enumerateElections(rootUrl, routes);
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
        const lastmod = safeFileMod(fileName);
        expandWithSubTabs(baseUrl, route.subTabs, lastmod);
      }
    }
    return;
  }
  // Static path.
  if (route.file === "polls-index") return enumeratePolls(route, rootUrl);
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
