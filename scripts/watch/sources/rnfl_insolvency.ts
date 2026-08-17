// РНФЛ — Регистър на физическите лица в несъстоятелност (личен фалит), Агенция по
// вписванията. ЗНФЛ took effect 2026-08-03 and the register went live the same day,
// EMPTY. Plan: docs/plans/rnfl-insolvency-v1.md.
//
// This watcher exists to answer ONE question — "has the register become something we
// can honestly aggregate yet?" — because nothing about it is ingestible today:
//
//   * it is empty (a filing needs a qualifying debt overdue 12 months, then a court
//     proceeding), and
//   * it has NO list, search or export endpoint. Every read route under /RNFL/api is a
//     LOOKUP keyed by file number, act id, or a personal identifier, so the register can
//     answer "is THIS person bankrupt?" and not "who is bankrupt?". Enumerating it would
//     mean brute-forcing the file-number space of a register of private individuals'
//     bankruptcies, which the plan refuses (§2).
//
// So this source ingests nothing and maps to NO skill. A flip means an operator reads
// the plan's §T2 and decides — the same "curated register, human in the loop" character
// as ofac_sanctions / comdos_ds / regulator_rosters, which is why it is registered
// beside them.
//
// NEVER add a probe against /RNFL/api/Reports/ObjectType/{t}/Ident/{ident}/... . That
// route takes a personal identifier (ЕГН); we do not hold one, must not acquire one, and
// a lookup-by-ЕГН crawl is exactly the compilation of personal data the plan forbids
// (§4). The probes below are deliberately identifier-free.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const PORTAL = "https://portal.registryagency.bg";

export const RNFL_URLS = {
  // The human landing page the report links to. Also the control for the statistics
  // probe below — see the redirect note there.
  home: `${PORTAL}/home-rnfl`,

  // PRIMARY signal, and the plan's T2 trigger. The portal's other three registers each
  // have a statistics page (/statistic-cr, /statistic-croz, /statistic-pr — all 200);
  // this one 404s. When the agency turns it on, that page is both the honest aggregate
  // source and a signal the AGENCY controls rather than one we inferred.
  statistics: `${PORTAL}/statistic-rnfl`,

  // ADVISORY signal only — see the caveat in describe(). One file number, never a
  // range: a range is the enumeration the plan rejects.
  deed: `${PORTAL}/RNFL/api/Reports/1/Deed`,

  // Schema signal: the register's own dictionaries. Public, identifier-free, and the
  // court dimension T2 would aggregate by.
  nomenclatures: [
    `${PORTAL}/RNFL/api/Nomenclatures/courts`,
    `${PORTAL}/RNFL/api/Nomenclatures/actTypes`,
  ],
} as const;

// A weekly courtesy probe against a brand-new public service: one retry, not the
// default three.
const PROBE = { retries: 1 } as const;

// A delimiter outside the value alphabet, so two different dictionaries can never fold
// to one string. A space would NOT do: court labels contain them routinely.
// NUL is written as an escape, never as a literal control byte in the source.
const SEP = "\u0000";

interface Nomenclature {
  code?: string;
  label?: string;
}

// Fold EVERY code:label pair, sorted — robust to the server reordering its
// dictionaries, and flipping on a genuine schema change. Deliberately NOT deduplicated
// (unlike comdos_ds): a duplicate entry appearing upstream is itself a schema event and
// should move the hash. A malformed body throws rather than folding junk — see the
// degrade note on fingerprint().
const foldNomenclature = (url: string, body: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`non-JSON nomenclature from ${url}: ${body.slice(0, 80)}`);
  }
  if (!Array.isArray(parsed))
    throw new Error(`nomenclature from ${url} is not an array`);
  return (parsed as unknown[])
    .map((entry) => {
      if (entry == null || typeof entry !== "object")
        throw new Error(
          `nomenclature from ${url} has a non-object entry: ${String(entry)}`,
        );
      const { code, label } = entry as Nomenclature;
      return `${code ?? ""}:${label ?? ""}`;
    })
    .sort()
    .join("|");
};

// 204 (today), 404, and an empty JSON envelope all mean "no such file". Only a body
// with actual content means the register holds a record at this file number. The
// envelope case is not contrived: a controller that starts returning `Ok(result)` with
// an empty result instead of `NoContent()` would otherwise flip every not-found lookup
// into "the register has entries" while it is still empty.
const deedHasRecord = (body: string | null): boolean => {
  if (body == null || body.trim() === "") return false;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed == null) return false;
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (typeof parsed === "object") return Object.keys(parsed).length > 0;
  } catch {
    // Non-JSON body — fall through and treat it as content.
  }
  return true;
};

export const rnflInsolvency: WatchSource = {
  id: "rnfl_insolvency",
  label: "Регистър на физическите лица в несъстоятелност (РНФЛ)",
  url: RNFL_URLS.home,
  // Weekly, not daily: nothing is expected for weeks and this is a courtesy request to
  // a service that opened on 2026-08-03.
  cadence: "weekly",
  // Genuinely event-driven — types.ts's own example, "a register that changes when
  // someone files something". Exempt from the cadence sampling invariant, and honestly
  // so rather than to silence it: there is no publication period to sample against.
  publishes: "irregular",

  // A failed probe THROWS rather than degrading to a sentinel. The runner reports the
  // source as `error` and leaves its previous state intact (see scripts/watch/index.ts),
  // so a transient outage costs one week of detection latency and produces NO false
  // "changed" line. A sentinel would be worse here, not better: comdos_ds can use one
  // because its upstream is unreachable from our egress ALWAYS, so "manual" is a stable
  // value — this portal answers a plain curl, so a sentinel would flip the fingerprint
  // on the way into an outage and again on the way back out.
  async fingerprint(): Promise<Fingerprint> {
    // Sequential, not parallel — a handful of requests, spaced by their own latency.
    const stats = await fetchText(RNFL_URLS.statistics, {
      ...PROBE,
      allow404: true,
    });

    // A 2xx is not proof the aggregate exists. fetchText follows redirects and exposes
    // neither the final URL nor the status, so a 302 back to /home-rnfl — or a "coming
    // soon" placeholder — would otherwise read as a live statistics page, which is the
    // one line that tells an operator to start building a table. Compare against the
    // landing page, and only once the URL answers at all: in the 404 state this watcher
    // will spend most of its life in, the control costs nothing.
    const home = stats == null ? null : await fetchText(RNFL_URLS.home, PROBE);
    const looksLikeHome = stats != null && home != null && stats === home;
    const statistics = stats == null || looksLikeHome ? "absent" : "present";
    // Carried in meta, never in `value` — a content hash there would flap on every edit
    // once the page is live. Here it lets an operator tell a 400-byte redirect landing
    // from a real statistics page before acting on the trigger.
    const statsBytes = stats?.length ?? 0;
    const statsHash = stats == null ? null : sha256Short(stats);

    const deed = await fetchText(RNFL_URLS.deed, { ...PROBE, allow404: true });
    const register = deedHasRecord(deed) ? "non-empty" : "empty";

    const folds: string[] = [];
    for (const url of RNFL_URLS.nomenclatures) {
      let body: string | null;
      try {
        body = await fetchText(url, PROBE);
      } catch (e) {
        // Still a throw — a sentinel would flip the fingerprint into and out of the
        // outage. But name what the earlier probes already established, so a week of
        // latency is not also a week of silence about the PRIMARY signal.
        throw new Error(
          `${url} unreachable (${e instanceof Error ? e.message : String(e)}); ` +
            `probed before it: stats:${statistics} register:${register}`,
        );
      }
      if (body == null) throw new Error(`no nomenclature body from ${url}`);
      folds.push(`${url}${SEP}${foldNomenclature(url, body)}`);
    }
    const schema = sha256Short(folds.join(SEP));

    const statsLabel =
      statistics === "present"
        ? `публикувана (${statsBytes}B)`
        : looksLikeHome
          ? `няма (URL-ът връща landing page, ${statsBytes}B)`
          : "няма";

    return {
      value: `stats:${statistics} register:${register} schema:${schema}`,
      detail:
        `статистика: ${statsLabel} · ` +
        `дело №1: ${register === "empty" ? "няма запис" : "ИМА запис"} · ` +
        `номенклатури ${schema}`,
      meta: { statistics, statsBytes, statsHash, register, schema },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const before = (prev?.meta ?? {}) as Record<string, unknown>;
    const now = (curr.meta ?? {}) as Record<string, unknown>;
    const notes: string[] = [];

    if (before.statistics === "absent" && now.statistics === "present")
      notes.push(
        "/statistic-rnfl е ЖИВА — официалната агрегация вече съществува (T2 trigger)",
      );
    if (before.statistics === "present" && now.statistics === "absent")
      notes.push("/statistic-rnfl изчезна (404) — беше публикувана преди това");
    // Advisory, in BOTH directions: these can only fire if file numbers are sequential
    // from 1, which is UNVERIFIED. The probe may stay silent for ever while the register
    // fills — never read its silence as "still empty". /statistic-rnfl is the signal to
    // trust.
    if (before.register === "empty" && now.register === "non-empty")
      notes.push("дело №1 вече връща запис — регистърът има вписвания");
    if (before.register === "non-empty" && now.register === "empty")
      notes.push(
        "дело №1 вече НЕ връща запис — или вписването отпадна, или endpoint-ът смени поведение",
      );
    if (
      typeof before.schema === "string" &&
      typeof now.schema === "string" &&
      before.schema !== now.schema
    )
      notes.push("номенклатурите (съдилища / видове актове) се промениха");

    const head = notes.length > 0 ? notes.join("; ") : curr.detail;
    return `${head} — виж docs/plans/rnfl-insolvency-v1.md T2 (няма скрипт за ингест)`;
  },
};
