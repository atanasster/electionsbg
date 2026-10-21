// Regulator rosters — the `regulator` "кой решава" facet on the person layer (plan §5 T1).
// The upstream is the curated register data/person/regulators.json: the current members of
// Bulgaria's independent / regulatory bodies (Конституционен съд, Сметна палата, КФН, БНБ
// УС, СЕМ, КЗК, Омбудсман…). There is NO unified feed — each body publishes its own roster
// on its own site — so this is a MANUALLY-CURATED register, like transparency_cpi and
// wiki_governments: an operator hand-verifies each seat against the official page.
//
// This watcher is a lightweight, best-effort REVIEW TRIGGER for the flagship body — it
// fingerprints the Constitutional Court's roster. When a judge rotates out (the 3-year
// cadence) or the chair changes, it flips and reminds the operator to re-check ALL bodies in
// data/person/regulators.json and re-run the resolver (`update-persons`). It cannot detect a
// change on the other bodies on its own — those are covered by the periodic manual review
// the header of the register documents.
//
// ⚠️ IT FINGERPRINTS THE NAMES, NOT THE PAGE. It used to hash /bg/composition, whose roster
// is an IMAGE: the markup around it flipped on cosmetic edits and asked for a review of a
// composition that had not moved (2026-10-20: same 12 judges, same chair). /bg/judges lists
// every judge as text with their seat, so the fingerprint is the (name, seat) set and the
// report names who joined or left.
//
// Downstream: a "changed" signal means review data/person/regulators.json (update-persons).

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const PAGE = "https://www.constcourt.bg/bg/judges";

export type Judge = { name: string; seat: string };

const SEAT_RE = /^(Председател|Заместник-председател|Съдия)$/;

/** Each judge on /bg/judges is a name line followed by a seat line. */
export const parseJudges = (html: string): Judge[] => {
  const lines = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const judges: Judge[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!SEAT_RE.test(lines[i])) continue;
    const name = lines[i - 1];
    if (/^[А-Я][а-я]+(?:[ -][А-Я][а-я]+){1,3}$/.test(name))
      judges.push({ name, seat: lines[i] });
  }
  return judges;
};

const key = (j: Judge) => `${j.name}|${j.seat}`;

export const regulatorRosters: WatchSource = {
  id: "regulator_rosters",
  label: "Регулатори / независими органи — състави (regulator facet)",
  url: PAGE,
  cadence: "monthly",
  async fingerprint(): Promise<Fingerprint> {
    let html: string;
    try {
      html = (await fetchText(PAGE)) ?? "";
    } catch {
      html = "";
    }
    if (!html) {
      // Upstream transiently unreachable — the register is curated manually anyway, so a
      // stable sentinel avoids a false "changed" flip (mirrors comdos_ds).
      return {
        value: "manual",
        detail:
          "constcourt.bg unreachable — data/person/regulators.json curated manually",
      };
    }
    const judges = parseJudges(html);
    // The court has 12 seats. Far fewer means the layout moved, not the court — say so
    // rather than reporting a roster nobody can recognise.
    if (judges.length < 8)
      return {
        value: "unparsed",
        detail: `constcourt.bg/bg/judges: ${judges.length} judge(s) parsed — layout changed, review data/person/regulators.json by hand`,
        meta: { judges },
      };
    const keys = judges.map(key).sort();
    const chair = judges.find((j) => j.seat === "Председател")?.name ?? "—";
    return {
      value: sha256Short(keys.join(",")),
      detail: `Конституционен съд — ${judges.length} съдии, председател ${chair}`,
      meta: { judges },
    };
  },
  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev || prev.fingerprint === curr.value)
      return `${curr.detail} — update-persons`;
    const before = prev.meta?.judges as Judge[] | undefined;
    const now = curr.meta?.judges as Judge[] | undefined;
    // The first run after the switch from page hashing has no roster to compare against.
    if (!before || !now)
      return `${curr.detail} — fingerprint switched to the judges list; no roster change implied`;
    const was = new Set(before.map(key));
    const is = new Set(now.map(key));
    const joined = now.filter((j) => !was.has(key(j))).map(key);
    const left = before.filter((j) => !is.has(key(j))).map(key);
    return `съставът на Конституционния съд се промени: +[${joined.join("; ")}] −[${left.join("; ")}] — прегледай data/person/regulators.json (update-persons)`;
  },
};
