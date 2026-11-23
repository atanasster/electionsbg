// НФК results from konkursi.ncf.bg — the fund's electronic competition system,
// where every programme's results have been published since post #755
// (20.11.2026). Before that each класиране was a PDF linked from a news post
// (NCF_RESULTS in ncf_grants.ts); those keep their own parser.
//
// The system's "public results" call returns a PDF, but that PDF EMBEDS the
// whole result as `CompetitionResultDocument.json`: every candidature, its
// points, the amount asked for and the amount proposed, split into the five
// lists the fund uses. So nothing here reads PDF text — it lifts the attached
// file out of the PDF and reads the JSON.
//
// Two things about the API are easy to get wrong:
//   - every call needs `X-CSRF: 1` (and `X-Requested-With`), exactly as the
//     site's own client sends them; without them the server answers a bare 500;
//   - the results document names natural persons as candidates. Only counts
//     and euro sums leave this module — no name is ever written to data/.
//     The cached copy under raw_data/ (gitignored) keeps the whole document.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, "../../raw_data/culture/ncf");

const API = "https://konkursi.ncf.bg/api/competitions";
const HEADERS = {
  Accept: "application/json",
  "X-CSRF": "1",
  "X-Requested-With": "XMLHttpRequest",
};

export interface KonkursiCompetition {
  id: number;
  year: number;
  name: string;
  status: string;
  /** The programme's register code (DEB, DG, KRI, CR …). */
  documentRegisterActivity: string | null;
  budget: number | null;
  /** The sum of the proposed awards, as the system states it. */
  rankingFunding: number | null;
}

interface Candidature {
  documentNumber: string;
  cultureFieldName: string | null;
  projectBudgetNeededFunding: number | null;
  approvedFunding?: number | null;
}

/** The embedded result document. Each list is one outcome. */
export interface KonkursiResultDocument {
  competitionYear: number;
  competitionName: string;
  /** Funded. */
  approvedCandidatures: Candidature[] | null;
  /** Above the points threshold, with a proposed amount, but no money left —
   *  the same thing the PDF класиране calls „резерва". NOT funded. */
  unrankedDueToLackOfFundsCandidature: Candidature[] | null;
  /** Evaluated, below the points threshold. */
  notApprovedForFundingCandidatures: Candidature[] | null;
  /** Failed the eligibility check; never evaluated. */
  notAllowedCandidatures: Candidature[] | null;
  withdrawnCandidatures: Candidature[] | null;
}

/** One evaluated candidature, in the shape ncf_grants.ts aggregates. */
export interface KonkursiRow {
  inNo: string;
  discipline: string;
  requested: number;
  proposed: number;
  reserve: boolean;
}

/** The field names the system uses → the discipline ids grants.json uses.
 *  Programmes that are one discipline (Дигитални изкуства, Цирк) leave the
 *  field empty, and Критика puts its two tracks there; both fall to "other". */
const FIELD_TO_DISCIPLINE: Record<string, string> = {
  Литература: "literature",
  "Екранни изкуства": "screen",
  Музика: "music",
  "Визуални изкуства": "visual",
  Театър: "theatre",
  "Танц и пърформънс": "dance",
  Танц: "dance",
};
export const disciplineOfField = (field: string | null): string =>
  (field && FIELD_TO_DISCIPLINE[field.trim()]) || "other";

/** English names for the programmes the system has run so far. An unknown
 *  programme keeps its Bulgarian name in English too, rather than a guess. */
const PROGRAMME_EN: Record<string, string> = {
  Дебюти: "Debuts",
  "Дигитални изкуства": "Digital arts",
  Критика: "Criticism",
  Цирк: "Circus",
  Мобилност: "Mobility",
  "Превод/Адаптация": "Translation / adaptation",
  "Културно наследство": "Cultural heritage",
  "Любителско изкуство": "Amateur arts",
};
export const programmeEn = (name: string): string =>
  PROGRAMME_EN[name.trim()] ?? name.trim();

const PDF_OBJ = (n: string) =>
  new RegExp(`(?:^|\\s)${n} 0 obj([\\s\\S]*?)endobj`);

/** Pull an embedded file out of a PDF by its attachment name. Reads the
 *  EmbeddedFiles name tree → its filespec → the /EF stream, and inflates it
 *  when the stream is FlateDecode. Returns null when the PDF has no such
 *  attachment, which the caller treats as a format change. */
export const extractEmbeddedFile = (
  pdf: Buffer,
  name: string,
): Buffer | null => {
  // latin1 maps every byte to one char, so string offsets are byte offsets.
  const s = pdf.toString("latin1");
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const spec = new RegExp(`\\(${esc}\\)\\s*(\\d+) 0 R`).exec(s);
  if (!spec) return null;
  const fileSpec = PDF_OBJ(spec[1]).exec(s)?.[1];
  const ef = fileSpec && /\/EF\s*<<\s*\/F\s+(\d+) 0 R/.exec(fileSpec);
  if (!ef) return null;
  const head = new RegExp(
    `(?:^|\\s)${ef[1]} 0 obj([\\s\\S]*?)stream\\r?\\n`,
  ).exec(s);
  if (!head) return null;
  const length = Number(/\/Length\s+(\d+)/.exec(head[1])?.[1]);
  if (!Number.isFinite(length)) return null;
  const start = head.index + head[0].length;
  const raw = pdf.subarray(start, start + length);
  return /\/FlateDecode/.test(head[1]) ? zlib.inflateSync(raw) : raw;
};

/** The evaluated candidatures, plus the two counts that are not evaluated.
 *  `applied` in grants.json is the EVALUATED set — the same population the PDF
 *  класиране sheets list — so ineligible and withdrawn ones are counted apart. */
export const konkursiRows = (
  doc: KonkursiResultDocument,
): { rows: KonkursiRow[]; ineligible: number; withdrawn: number } => {
  const row = (c: Candidature, reserve: boolean, funded: boolean) => ({
    inNo: c.documentNumber,
    discipline: disciplineOfField(c.cultureFieldName),
    requested: c.projectBudgetNeededFunding ?? 0,
    proposed: funded || reserve ? (c.approvedFunding ?? 0) : 0,
    reserve,
  });
  return {
    rows: [
      ...(doc.approvedCandidatures ?? []).map((c) => row(c, false, true)),
      ...(doc.unrankedDueToLackOfFundsCandidature ?? []).map((c) =>
        row(c, true, false),
      ),
      ...(doc.notApprovedForFundingCandidatures ?? []).map((c) =>
        row(c, false, false),
      ),
    ],
    ineligible: (doc.notAllowedCandidatures ?? []).length,
    withdrawn: (doc.withdrawnCandidatures ?? []).length,
  };
};

/** The awards must add up to the total the system states for the competition.
 *  A gap means the lists were read wrong (or the API changed what they hold). */
export const checkFundingTotal = (
  comp: KonkursiCompetition,
  doc: KonkursiResultDocument,
): void => {
  if (comp.rankingFunding == null) return;
  const sum = (doc.approvedCandidatures ?? []).reduce(
    (s, c) => s + (c.approvedFunding ?? 0),
    0,
  );
  if (Math.abs(sum - comp.rankingFunding) > 1)
    throw new Error(
      `НФК konkursi #${comp.id} ${comp.name}: awards sum to €${sum.toFixed(2)} but the system states €${comp.rankingFunding}`,
    );
};

export const resultsUrl = (id: number): string =>
  `${API}/Results/Competitions/${id}/Results/Public`;

const getJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`konkursi.ncf.bg: HTTP ${res.status} ${url}`);
  return (await res.json()) as T;
};

/** Every competition whose results are announced — fetched fresh, falling
 *  back to the last good listing when the system does not answer. */
export const listAnnounced = async (): Promise<KonkursiCompetition[]> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = path.join(CACHE_DIR, "konkursi_competitions.json");
  try {
    const list = await getJson<KonkursiCompetition[]>(
      `${API}/Competitions/?status=withAnnouncedResults&page=1&pageSize=1000&calculateCount=false`,
    );
    if (!Array.isArray(list))
      throw new Error("the competitions listing is not an array");
    fs.writeFileSync(cache, JSON.stringify(list));
    return list;
  } catch (e) {
    if (!fs.existsSync(cache))
      throw new Error(
        `konkursi listing: ${(e as Error).message} (and no cached copy)`,
      );
    console.warn(
      `  ⚠ konkursi listing: ${(e as Error).message} — using the cached copy`,
    );
    return JSON.parse(fs.readFileSync(cache, "utf8")) as KonkursiCompetition[];
  }
};

/** One competition's result document — fetched fresh, cached, and read back
 *  from the cache only when the fetch fails (a result is revised when a
 *  reserve project moves up, so a stale copy is a fallback, never the default). */
export const fetchResultDocument = async (
  id: number,
): Promise<KonkursiResultDocument> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = path.join(CACHE_DIR, `konkursi_${id}.json`);
  try {
    const res = await fetch(resultsUrl(id), {
      headers: HEADERS,
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pdf = Buffer.from(await res.arrayBuffer());
    const json = extractEmbeddedFile(pdf, "CompetitionResultDocument.json");
    if (!json)
      throw new Error(
        "the results PDF carries no CompetitionResultDocument.json — format changed",
      );
    const doc = JSON.parse(
      json.toString("utf8").replace(/^\uFEFF/, ""),
    ) as KonkursiResultDocument;
    fs.writeFileSync(cache, JSON.stringify(doc));
    return doc;
  } catch (e) {
    if (!fs.existsSync(cache))
      throw new Error(
        `konkursi #${id}: ${(e as Error).message} (and no cached copy)`,
      );
    console.warn(
      `  ⚠ konkursi #${id}: ${(e as Error).message} — using the cached copy`,
    );
    return JSON.parse(fs.readFileSync(cache, "utf8")) as KonkursiResultDocument;
  }
};
