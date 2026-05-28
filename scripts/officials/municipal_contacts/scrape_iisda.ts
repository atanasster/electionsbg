// Scrape mayor + deputy-mayor email addresses from the
// iisda.government.bg "Кметове на общини" registry.
//
// The registry uses an xajax-based pagination that's awkward to drive
// programmatically. The detail-page URLs are predictable
// (/ras/governing_bodies/governing_body/<id>) and mayor IDs sit in a
// contiguous block around 4400..4920, so we scan that range, filter
// pages whose body contains "Кмет на община", and extract every
// person-block on the page (mayor + Заместници section) — each carries
// a role label, full name, and `mailto:` email.
//
// Run: `npx tsx scripts/officials/municipal_contacts/scrape_iisda.ts`
// Writes: data/officials/municipal_contacts/index.json
//
// Polite scrape: serial requests with a 200 ms delay between them
// (~2 minutes for the full ~520-ID range).

import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "..",
);

const OUT_FILE = path.join(
  PROJECT_ROOT,
  "data/officials/municipal_contacts/index.json",
);
const MUNICIPALITIES_FILE = path.join(PROJECT_ROOT, "data/municipalities.json");

const ID_RANGE_START = 4400;
const ID_RANGE_END = 4950;
const POLITE_DELAY_MS = 200;
const UA = "Mozilla/5.0 (compatible; electionsbg-officials/1.0)";
const CACHE_DIR = path.resolve(PROJECT_ROOT, "raw_data/officials/iisda_mayors");

const fetchText = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
};

// Disk-cache each detail page so iteration on the parser doesn't re-hit
// the iisda server. Files in raw_data/officials/iisda_mayors/<id>.html;
// blank file = known-404 (so we don't re-fetch missing IDs).
const fetchTextCached = async (id: number): Promise<string | null> => {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${id}.html`);
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file, "utf-8");
    return buf.length > 0 ? buf : null;
  }
  const html = await fetchText(
    `https://iisda.government.bg/ras/governing_bodies/governing_body/${id}`,
  );
  fs.writeFileSync(file, html ?? "");
  await sleep(POLITE_DELAY_MS);
  return html;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type MunicipalityInfo = {
  obshtina: string;
  name: string;
  oblast: string;
};

// Detail page header is:
//   <a href="/ras/adm_structures/organigram/...">Общинска администрация - <Name></a>
// The list page also carries an oblast (", Варна") but the detail page
// does not. We extract the município name only here and disambiguate
// same-name municípios via the email domain or first-match fallback.
const parseRegistryHeader = (html: string): { municipality: string } | null => {
  const m = html.match(
    /Общинска\s+администрация\s*[-–—]\s*([^<,]+?)\s*(?:,\s*[^<]+)?<\/a>/,
  );
  if (!m) return null;
  return { municipality: m[1].trim() };
};

type PersonRole = "mayor" | "deputy_mayor" | "other";

type Person = {
  role: PersonRole;
  /** Verbatim role label, e.g. "Кмет на община" or "Заместник-кмет". */
  roleRaw: string;
  /** Full name as it appears on the page. */
  name: string;
  email: string;
};

const roleSlug = (raw: string): PersonRole => {
  if (/Заместник[\s-]?кмет/iu.test(raw)) return "deputy_mayor";
  if (/Кмет\s+на\s+(?:община|район|кметство)/iu.test(raw)) return "mayor";
  return "other";
};

// Walk every <li class="level-1"> block in the document and pull
// (role, name, email) out of each. The page renders one such block per
// person: top text node carries the role label, the name lives in a
// <span class="li-sub-text-name">, and the email is the first
// `mailto:` href inside the block. Blocks that don't carry all three
// (e.g. the "Степен на разпоредител с бюджет" block) are skipped.
const extractPeople = (html: string): Person[] => {
  const out: Person[] = [];
  const re =
    /<li class="level-1">([\s\S]*?)<\/li>\s*(?=<li class="level-1"|<\/ul>)/g;
  for (const m of html.matchAll(re)) {
    const block = m[1];
    // Role: first non-empty text inside <div class="level-1-content">
    // up to the first <br>. Strip tags + collapse whitespace.
    const roleMatch = block.match(
      /<div class="level-1-content">([\s\S]*?)<br\s*\/?>/,
    );
    const roleRaw = roleMatch
      ? roleMatch[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : "";
    const nameMatch = block.match(
      /<span class="li-sub-text-name">\s*([^<]+?)\s*<\/span>/,
    );
    const emailMatch = block.match(
      /href="mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"/,
    );
    if (!roleRaw || !nameMatch || !emailMatch) continue;
    out.push({
      role: roleSlug(roleRaw),
      roleRaw,
      name: nameMatch[1].normalize("NFC").replace(/\s+/g, " ").trim(),
      email: emailMatch[1],
    });
  }
  return out;
};

const normName = (s: string): string =>
  s
    .normalize("NFC")
    .replace(/[ёѐ]/g, "е")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// Manual name → obshtina-code overrides for cases that don't normalise
// to a unique municipalities.json entry:
//   - "Добричка" is the rural município around Dobrich city — stored as
//     "Добрич-селска" in municipalities.json.
//   - "Столична община" is Sofia city, which doesn't have a single obshtina
//     code in municipalities.json (the 24 районы S2302..S2524 cover it);
//     we map it to the synthetic SOF00 aggregate that the hook then
//     fans out to районы on lookup.
const MANUAL_ALIASES: Record<string, string> = {
  добричка: "DOB15",
  "столична община": "SOF00",
};

const main = async () => {
  const munis = JSON.parse(
    fs.readFileSync(MUNICIPALITIES_FILE, "utf-8"),
  ) as MunicipalityInfo[];
  // Build a "muni-name (normalised)" → obshtina-code map. Same-name
  // ambiguities (e.g. multiple Беловидин) require disambiguating by oblast.
  const byName = new Map<string, MunicipalityInfo[]>();
  for (const m of munis) {
    const key = normName(m.name);
    const arr = byName.get(key) ?? [];
    arr.push(m);
    byName.set(key, arr);
  }
  // Oblast 3-letter code → BG name. Built lazily by scanning oblast codes
  // we see; not strictly needed but useful for ambiguity tie-break.
  // (Empty placeholder — we use the iisda oblast string directly.)

  type OfficialEntry = {
    role: PersonRole;
    roleRaw: string;
    name: string;
    email: string;
  };
  const out: Record<
    string,
    {
      phone?: string;
      email?: string;
      mayor?: string;
      iisda_id: number;
      officials?: OfficialEntry[];
    }
  > = {};
  let scanned = 0;
  let mayorsFound = 0;
  let matched = 0;
  const unmatched: Array<{ id: number; muni: string; oblast: string }> = [];

  for (let id = ID_RANGE_START; id <= ID_RANGE_END; id++) {
    scanned++;
    const html = await fetchTextCached(id);
    if (html) {
      // Only municipality-mayor pages.
      if (
        /Кмет\s+на\s+община/.test(html) &&
        /Общинска\s+администрация/.test(html)
      ) {
        mayorsFound++;
        const header = parseRegistryHeader(html);
        const people = extractPeople(html);
        const mayorPerson = people.find((p) => p.role === "mayor") ?? null;
        const email = mayorPerson?.email;
        const mayor = mayorPerson?.name;
        if (header) {
          const key = normName(header.municipality);
          const candidates = byName.get(key) ?? [];
          let code: string | undefined;
          // Manual overrides win first — these are the names that don't
          // resolve cleanly via the auto name-match.
          if (MANUAL_ALIASES[key]) {
            code = MANUAL_ALIASES[key];
          } else if (candidates.length === 1) {
            code = candidates[0].obshtina;
          } else if (candidates.length > 1 && email) {
            // Disambiguate by email domain. Most BG municípios use
            // <name>.bg or obshtina-<name>.bg; the right município is
            // usually the one whose obshtina-code 3-letter prefix
            // matches the email domain.
            const domain = email.split("@")[1]?.toLowerCase() ?? "";
            code =
              candidates.find((c) =>
                domain.includes(c.obshtina.slice(0, 3).toLowerCase()),
              )?.obshtina ?? candidates[0].obshtina;
          } else if (candidates.length > 1) {
            code = candidates[0].obshtina;
          }
          if (code) {
            matched++;
            const officials: OfficialEntry[] = people
              .filter((p) => p.role !== "other")
              .map((p) => ({
                role: p.role,
                roleRaw: p.roleRaw,
                name: p.name,
                email: p.email,
              }));
            out[code] = {
              email,
              mayor,
              iisda_id: id,
              officials: officials.length > 0 ? officials : undefined,
            };
          } else {
            unmatched.push({
              id,
              muni: header.municipality,
              oblast: "",
            });
          }
        } else {
          unmatched.push({
            id,
            muni: "(header missing)",
            oblast: "",
          });
        }
      }
    }
    if (scanned % 50 === 0) {
      console.log(
        `  scanned ${scanned}/${ID_RANGE_END - ID_RANGE_START + 1} · mayors=${mayorsFound} · matched=${matched}`,
      );
    }
  }

  const file = {
    source: "iisda.government.bg (Административен регистър)",
    sourceUrl:
      "https://iisda.government.bg/ras/governing_bodies/gb_municipality_administrations",
    indexName:
      "Municipal officials contacts (mayor + deputy mayors; email only — iisda doesn't publish phone/website here)",
    scrapedAt: new Date().toISOString(),
    contactsByObshtina: out,
    note: `Scraped ${mayorsFound} mayor detail pages from iisda's ID range ${ID_RANGE_START}–${ID_RANGE_END}; matched ${matched} to municipalities.json. ${unmatched.length} unmatched (likely name-ambiguity edge cases — see scrape log).`,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(file, null, 2) + "\n");
  console.log(
    `\nDone. Wrote ${OUT_FILE} — ${matched}/${mayorsFound} mayors matched, ${unmatched.length} unmatched.`,
  );
  if (unmatched.length > 0 && unmatched.length <= 20) {
    console.log("Unmatched:");
    for (const u of unmatched)
      console.log(`  id=${u.id} ${u.muni} (${u.oblast})`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
