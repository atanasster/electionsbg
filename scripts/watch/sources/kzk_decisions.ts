// КЗК decisions register (reg.cpc.bg, "Решения и определения по ЗОП") — the
// tier-2 MERITS source that sets kzk_appeals.outcome / decision_date.
//
// ⚠️ THIS SOURCE EXISTS BECAUSE ITS ABSENCE WAS THE BUG. The sibling
// `kzk_appeals` watcher fingerprints only the INTAKE register, so when the
// decisions arm froze at 2026-06-25 while complaints stayed current to 07-29,
// the orchestrator was structurally incapable of noticing: no watcher covered
// this page, the skill's only gate was a `count(outcome) >= 2098` floor that
// passes forever, and the one routine that did run (the intake crawl) writes
// outcomes with `COALESCE(existing, EXCLUDED)` and therefore cannot fill one.
// Five weeks, nothing red. See docs/plans/kzk-decisions-freshness-v1.md.
//
// Fingerprint = the current-year "Намерени са общо N" total + a hash of the
// newest act numbers on page 1. It flips when КЗК publishes a ruling.
//
// ⚠️ `meta.newestAct` / `meta.newestDate` ARE LOAD-BEARING, not decoration.
// scripts/db/tests/kzk_decisions.data.test.ts reads them out of the COMMITTED
// state file and asserts the act is present in the `kzk_decisions` table. That
// is what makes the freshness gate exact and offline: it compares our corpus
// against the REGISTER's own newest act rather than against a calendar
// threshold, which would be flaky in exactly the months КЗК is in recess.
//
// Cadence weekly, matching the intake source: acts land ~37-47/month and the
// re-ingest is a headed browser run.
//
// NOTE: reg.cpc.bg is geo-gated (403 from non-BG egress) — this watcher must run
// from a Bulgarian connection, same as the intake source and the CIK one. The
// re-ingest is `npm run kzk:decisions -- --year <YYYY> --apply`, followed by
// `db:load:kzk-decisions:pg` and `kzk:rejoin -- --apply` (the crawl alone changes
// nothing served).

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";
// Share the register URL with the crawler + the store (single source of truth —
// if КЗК moves the register, one side cannot silently keep polling the old URL),
// and the UA with the intake crawler.
import {
  DECISIONS_LIST_URL as PAGE,
  parseRegisterTotal,
} from "../../procurement/kzk_decisions_store";
import { UA as BROWSER_UA } from "../../procurement/kzk_appeals";

// The newest act numbers rendered on page 1. The pager is newest-first, so these
// are the change signal — and act[0] is what the data gate compares against.
//
// Keyed on the act-number TEXT rather than an anchor href: unlike the intake
// register (whose rows link to Complaint.aspx?ID=), the decisions list is not
// known to expose a per-act detail link, so the printed number is the only
// stable identifier. It also happens to be the natural key of `kzk_decisions`,
// which is precisely what the gate needs.
const extractTopActs = (html: string): string[] =>
  Array.from(html.matchAll(/АКТ-\d+-\d{2}\.\d{2}\.\d{4}/g))
    .map((m) => m[0])
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 10);

/** "АКТ-608-25.06.2026" → "2026-06-25". Null when unparseable. */
const actDate = (act: string | undefined): string | null => {
  const m = /-(\d{2})\.(\d{2})\.(\d{4})$/.exec(act ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

export const kzkDecisions: WatchSource = {
  id: "kzk_decisions",
  label: "КЗК decisions register (решения и определения по ЗОП)",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE, {
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "bg-BG,bg" },
    });
    if (!html) throw new Error("empty КЗК decisions page (BG egress required)");
    const total = parseRegisterTotal(html);
    const top = extractTopActs(html);
    // ⚠️ `||`, NOT `&&`. An `&&` guard only fires when BOTH readings fail — so an
    // act-number format change alone would leave `meta.newestAct` null while the
    // fingerprint kept flipping off the total. The T6 gate anchors on newestAct,
    // so its anchor would go dark while the watcher still reported "changed":
    // the same silent blindness this source was written to end, one level in.
    if (total == null || top.length === 0) {
      throw new Error(
        `КЗК decisions page markup not recognised (total=${total ?? "?"}, ` +
          `acts found=${top.length}) — the freshness gate anchors on the newest ` +
          "act number, so a partial read must fail rather than publish a null anchor",
      );
    }
    const value = sha256Short(`${total ?? "?"}|${top.join(",")}`);
    return {
      value,
      detail: `${total ?? "?"} acts this year, newest ${top[0] ?? "—"} (hash ${value})`,
      meta: {
        total: total ?? null,
        newestAct: top[0] ?? null,
        newestDate: actDate(top[0]),
      },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = (prev.meta?.total as number | undefined) ?? null;
    const c = (curr.meta?.total as number | undefined) ?? null;
    if (p != null && c != null && c !== p) {
      return `${c - p > 0 ? "+" : ""}${c - p} КЗК acts (${p} → ${c}); newest ${curr.meta?.newestAct ?? "—"}`;
    }
    return `КЗК decisions changed; newest ${curr.meta?.newestAct ?? "—"}`;
  },
};
