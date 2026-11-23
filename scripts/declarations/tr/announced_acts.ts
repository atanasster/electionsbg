// Announced acts (обявени актове) — the register's index of the DOCUMENTS each company
// has published: ГФО, доклад за дейността, the чл. 38 no-activity declaration, устав,
// покани … Pure extractors over the two sources that carry it
// (docs/plans/tr-gfo-ingest-v1.md §3.1–3.2):
//
//   • the TR daily feed — `Deed > SubDeed[G1_ActAnnouncement] > Statements* > Statement*`,
//     one `$` per act with ActID / ActModeValue / ActModeText / ActYear. ⚠️ Since
//     2026-10-12 the feed no longer carries the ГФО-family containers (StatementsB / BH /
//     BI) — ДВ бр. 92/2026 moved ГФО into a separate processing stream — so the archive
//     before that date is the last feed-based ГФО index there will be.
//   • the CR portal deed body (raw_data/tr/cr_deeds.sqlite) — the same acts rendered as
//     HTML inside `CR_GL_ANNOUNCED_ACTS_L / CR_F_1001_L`, each with a
//     `DocumentAccess/<token>` link. The token is base64url of
//     `<UIC>&e&<32-hex ActID><signature>`, so the ActID is recovered exactly, and the
//     record adds the „Дата на обявяване" the feed mostly leaves blank.
//
// Both sources key the section by the same FieldIdent (ГФО `10019B`, доклад `1001BH`,
// декларация `1001BI`, устав `1001AJ`), so `fieldIdent` is the source-independent
// section key. The act MODE (2 / 60 / 61 …) only exists in the feed; a CR-only act is
// given one by its label at load time (tr_act_mode).
//
// Nothing here touches the network or a database.

/** FieldIdents of the ГФО family: the statements, the activity report, the declaration. */
export const GFO_FAMILY_FIELD_IDENTS = ["10019B", "1001BH", "1001BI"] as const;
/** Act modes of the ГФО family, as the feed numbers them. */
export const GFO_FAMILY_MODES = [2, 60, 61] as const;

export type AnnouncedAct = {
  actId: string;
  uic: string;
  /** Feed ActModeValue; null when only the CR body saw the act. */
  actMode: number | null;
  /** The act's kind as the register names it („Годишен финансов отчет"). */
  actModeText: string;
  /** Section FieldIdent shared by both sources, e.g. "10019B". */
  fieldIdent: string | null;
  /** Free-text description (feed Description / CR link text); null when it only repeats the kind. */
  description: string | null;
  /** The register's own year field (feed ActYear, CR „Година: …г."). */
  actYear: number | null;
  /** Sofia wall-clock „YYYY-MM-DD HH:MM:SS" of the announcement; null when unknown. */
  announcedLocal: string | null;
  erasedPersonalData: boolean | null;
};

type Wrapped = { $?: Record<string, string>; [k: string]: unknown };

const ACT_ID = /^[0-9a-f]{32}$/;

const asArray = (v: unknown): Wrapped[] =>
  Array.isArray(v)
    ? (v.filter((x) => typeof x === "object" && x !== null) as Wrapped[])
    : [];

const cleanText = (s: string | undefined | null): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
};

const parseYear = (s: string | undefined | null): number | null => {
  const m = /^\s*((?:19|20)\d\d)\s*$/.exec(s ?? "");
  return m ? Number(m[1]) : null;
};

/** Feed ActDate is either blank or an ISO-ish local timestamp. */
const feedActDate = (s: string | undefined): string | null => {
  const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)/.exec(s ?? "");
  if (m) return `${m[1]} ${m[2]}`;
  const d = /^(\d{4}-\d\d-\d\d)$/.exec(s ?? "");
  return d ? `${d[1]} 00:00:00` : null;
};

/**
 * Every announced act in one TR daily feed file. An act re-listed by several deeds in
 * one file (it should not be, but the feed is not validated) keeps its first occurrence.
 */
export const extractFeedActs = (json: unknown): AnnouncedAct[] => {
  if (typeof json !== "object" || json === null) return [];
  const msg = asArray((json as { Message?: unknown }).Message)[0];
  const body = asArray(msg?.Body)[0];
  const deeds = asArray(asArray(body?.Deeds)[0]?.Deed);
  const out = new Map<string, AnnouncedAct>();
  for (const deed of deeds) {
    const uic = deed.$?.UIC;
    if (!uic) continue;
    for (const sub of asArray(deed.SubDeed)) {
      if (sub.$?.SubUICType !== "G1_ActAnnouncement") continue;
      for (const [key, val] of Object.entries(sub)) {
        if (!key.startsWith("Statements")) continue;
        const itemKey = key.replace(/^Statements/, "Statement");
        for (const group of asArray(val)) {
          const fieldIdent = group.$?.FieldIdent ?? null;
          for (const item of asArray(group[itemKey])) {
            const a = item.$ ?? {};
            const actId = (a.ActID ?? "").toLowerCase();
            if (!ACT_ID.test(actId) || out.has(actId)) continue;
            const mode = Number(a.ActModeValue);
            const modeText = cleanText(a.ActModeText);
            if (!modeText) continue;
            const desc = cleanText(a.Description);
            out.set(actId, {
              actId,
              uic,
              actMode: Number.isInteger(mode) && mode > 0 ? mode : null,
              actModeText: modeText,
              fieldIdent,
              description: desc && desc !== modeText ? desc : null,
              actYear: parseYear(a.ActYear),
              announcedLocal: feedActDate(a.ActDate),
              erasedPersonalData:
                a.ActWithErasedPersonalData === "1"
                  ? true
                  : a.ActWithErasedPersonalData === "0"
                    ? false
                    : null,
            });
          }
        }
      }
    }
  }
  return [...out.values()];
};

/** Decode a CR `DocumentAccess/<token>` link. null when it is not the known shape. */
export const decodeDocumentAccessToken = (
  token: string,
): { uic: string; actId: string } | null => {
  let raw: Buffer;
  try {
    raw = Buffer.from(token, "base64url");
  } catch {
    return null;
  }
  // `<UIC>&e&<32 hex><binary signature>` — read the ASCII prefix only.
  const head = raw.subarray(0, 64).toString("latin1");
  const m = /^(\d{9}|\d{13})&e&([0-9a-f]{32})/.exec(head);
  return m ? { uic: m[1], actId: m[2] } : null;
};

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const stripTags = (s: string): string =>
  decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** „22.06.2009 г. 18:02:14" → "2009-06-22 18:02:14" (Sofia wall clock). */
export const parseAnnouncedDate = (s: string): string | null => {
  const m =
    /Дата на обявяване:\s*(\d\d)\.(\d\d)\.(\d{4})\s*г\.?\s*(\d\d):(\d\d):(\d\d)/.exec(
      s,
    );
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}` : null;
};

/** One CR_F_1001_L record (one `<p class='field-text'>`) → act, or null. */
export const parseCrActRecord = (
  html: string,
  uic: string,
  fieldIdent: string | null,
): AnnouncedAct | null => {
  const link =
    /<a\s+href='DocumentAccess\/([A-Za-z0-9_-]+)'[^>]*>([\s\S]*?)<\/a>/.exec(
      html,
    );
  if (!link) return null;
  const tok = decodeDocumentAccessToken(link[1]);
  if (!tok || tok.uic !== uic) return null;
  // The kind is the text before the first <br>.
  const kind = stripTags(html.split(/<br\s*\/?>/i)[0] ?? "");
  if (!kind) return null;
  const linkText = stripTags(link[2]);
  const year = /Година:\s*((?:19|20)\d\d)\s*г/.exec(html);
  const text = stripTags(html);
  return {
    actId: tok.actId,
    uic,
    actMode: null,
    actModeText: kind,
    fieldIdent,
    description: linkText && linkText !== kind ? linkText : null,
    actYear: year ? Number(year[1]) : null,
    announcedLocal: parseAnnouncedDate(text),
    erasedPersonalData: /със заличени лични данни/.test(text) ? true : null,
  };
};

/** Every announced act in one captured CR deed body (the raw JSON string). */
export const extractCrActs = (body: string, uic: string): AnnouncedAct[] => {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return [];
  }
  const out = new Map<string, AnnouncedAct>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) {
      for (const x of o) walk(x);
      return;
    }
    if (typeof o !== "object" || o === null) return;
    const r = o as Record<string, unknown>;
    if (r.nameCode === "CR_F_1001_L" && typeof r.htmlData === "string") {
      const fieldIdent = typeof r.fieldIdent === "string" ? r.fieldIdent : null;
      for (const rec of r.htmlData.split(/<hr[^>]*>/i)) {
        const act = parseCrActRecord(rec, uic, fieldIdent);
        if (act && !out.has(act.actId)) out.set(act.actId, act);
      }
      return;
    }
    for (const v of Object.values(r)) walk(v);
  };
  walk(root);
  return [...out.values()];
};

/** True for the ГФО family — the statements, the activity report, the declaration. */
export const isGfoFamily = (a: Pick<AnnouncedAct, "fieldIdent" | "actMode">) =>
  (a.fieldIdent != null &&
    (GFO_FAMILY_FIELD_IDENTS as readonly string[]).includes(a.fieldIdent)) ||
  (a.actMode != null &&
    (GFO_FAMILY_MODES as readonly number[]).includes(a.actMode));

/**
 * The fiscal year a ГФО-family act reports on: the register's own year field, else a
 * four-digit year in its description („Годишен финансов отчет за 2008 г."). Other act
 * kinds get none — a year inside an устав description is not a fiscal year.
 */
export const fiscalYearOf = (a: AnnouncedAct): number | null => {
  if (!isGfoFamily(a)) return null;
  if (a.actYear != null) return a.actYear;
  const m = /(?:^|[^\d])((?:19|20)\d\d)(?:[^\d]|$)/.exec(a.description ?? "");
  return m ? Number(m[1]) : null;
};
